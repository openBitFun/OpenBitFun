# Unified client architecture: one UI, one protocol, display-only frontend

Status: adopted (2026-11). The native NSH app is the desktop client; the Tauri desktop shell and the React
desktop UI were retired (wave 4 sunset, below). This document is the owner for the target shape; per-phase
status lives in the phase tables.

## Goals

1. **The desktop is a native NSH app.** The OpenBitFun desktop client renders the NSH TSX UI (`src/nsh-ui`) in a
   native window (AppKit on macOS; Win32 and GTK next) and runs the existing Rust backend in the same process.
   No WebView, no browser shell, no Tauri event loop at runtime. The reasons are memory, CPU and jank in long
   and parallel sessions.
2. **One UI for every client.** The same TSX code renders the desktop, phones (NSH iOS/Android packages or a
   browser) and browsers (NSH web target). Layout is responsive; there is no second mobile UI.
3. **The frontend only displays.** Business rules, defaults, validation, projections, routing and persistence
   semantics live in the backend. The frontend renders view models and forwards user intents. Two clients
   showing the same state must show the same thing because neither computed it.
4. **Remote control is "one more frontend".** A phone, a browser or another desktop connects to a backend over
   the same protocol the local UI uses. Relays are dumb pipes; nothing re-wraps, re-projects or throttles the
   payload, so streaming is identical locally and remotely.

## The backend protocol (OBP)

The backend exposes one service, `BackendService` (`src/apps/desktop/src/backend_protocol`), to every client:

- `dispatch(command, args) -> Result<json, error>`: `command` is the product command name (the command
  names, kept as the stable vocabulary), `args` exactly what `invoke` sends.
- An ordered event stream: each event `{seq, event, payload}`, `seq` strictly increasing per backend process,
  payloads byte-identical to the historical Tauri events. A bounded replay buffer lets a client resume after its
  last `seq`; a gap beyond the buffer is repaired by re-hydrating through ordinary commands (session turns, the
  interaction mailbox, an active-turn snapshot).
- Multiple concurrent subscribers, each with its own cursor and optional subscription filter (session ids,
  catalog, terminals). Filters reduce what is sent; they never change payloads.

Transports carry this unchanged:

| Pipe | Used by | Notes |
|---|---|---|
| In-process | Native desktop host (`src/apps/desktop-nsh`) | NSH native module `openbitfun/native`: `Backend.invoke`, `Backend.nextEvents`, `Backend.ready` |
| WebSocket, loopback | Browser on the same machine | JSON-RPC 2.0; `hello` carries protocol version, capabilities, registry digest, `last_seq` |
| WebSocket, LAN | Phone/browser on the same network | Direct; pairing QR pins the backend certificate and key; no internet needed |
| Relay tunnel | Any client, anywhere | The relay forwards opaque frames between same-account devices; end-to-end encryption uses the existing device X25519 keys |
| Device mesh (EasyTier) | Another desktop of the same account, anywhere; a phone that joined the account mesh with the EasyTier app | TLS WebSocket to the device's mesh virtual IP; P2P with relay fallback; `account-device` handshake with the device X25519 keys, or a `paired-client` QR credential for a phone browser (wave 4, below) |

The backend serves the UI bundle (NSH web target) on its listener, so a browser or phone opening the backend
URL gets the same UI that then connects to `/obp`.

### Scopes and controller-local commands

Each connection is bound to a scope: `owner` (in-process, or loopback with a per-launch token and Origin check),
`account-device` (same-account device key handshake), `paired-client` (revocable QR credential) or `observer`
(read-only). The Product Operation Registry (`remote_surface/table.rs`) decides per command: `Proxied` runs for any
authorized scope; `ControllerLocal` / `OperatorOnly` run only for `owner`. The registry gains an event stance so
account, window and updater events never leave the owner scope.

A client that has a local backend (a desktop controlling another desktop) routes `ControllerLocal` commands to its
own backend and everything else to the selected device's backend. A phone or browser has no local backend, so
controller-local features are hidden by capability, not faked.

### Backpressure

Per-connection byte credit with client `ack{seq}`. When a slow connection falls behind, consecutive text/thinking
chunks of one session round are merged; past a byte bound the server sends `backend://events-dropped` with the
first available `seq` and the client re-hydrates. The runtime is never blocked by a client.

### WebSocket transport (phase 3, implemented)

Owner: `src/apps/desktop/src/backend_protocol/ws` (server), `src/nsh-ui/src/webSocketConnection.ts` (client).
The native host starts it in `start_native_backend`. `OPENBITFUN_OBP_LISTENER=off` disables it; `OPENBITFUN_OBP_PORT` /
`OPENBITFUN_OBP_LAN_PORT` override the preferred ports (47610 / 47611, ephemeral when taken).

- **Listeners.** Loopback `http://127.0.0.1:<port>` always; LAN `https://0.0.0.0:<port>` only while the user
  enables it in Devices (persisted). Both serve the NSH web bundle at `/` (`pnpm run desktop-nsh:web`, found via
  `OPENBITFUN_WEB_UI_DIR`, `Contents/Resources/nsh-web`, `nsh-web/` next to the executable, or the dev output) with
  `index.html` carrying `#nsh-params` `{obp: {url, path, protocol}}`, precompressed files, immutable caching for
  content-hashed names, and the CSP `script-src 'self' 'wasm-unsafe-eval'` plus `frame-ancestors 'none'`.
  Without a bundle `/` explains how to build one.
- **Framing.** JSON-RPC 2.0 text frames on `/obp`: `hello {protocol, client, lastSeq, instanceId, ack,
  creditBytes}` → `{protocol, scope, capabilities, registryDigest, backend {version, platform, instanceId,
  dataDir (owner only)}, lastSeq, creditBytes}`; `call {command, args}` → the command's JSON (errors: `-32000`
  with the backend's own text and `data.kind` `command`/`unsupported`, `-32003` scope refusal, `-32002` hello
  required, `-32005` protocol mismatch, `-32603` command panic); `ack {seq}` notification; server `event`
  notifications `{seq, event, payload}`. A cursor from another backend process (`instanceId` mismatch) or from the
  future gets `backend://events-dropped {reason: "backend_restarted"}`.
- **Scopes.** `owner`: loopback, `Host` must be a loopback name (DNS rebinding), `Origin` must be the listener's
  own, and the per-launch token (`<data>/obp/owner-token`, 0600, removed at shutdown) presented as
  `Authorization: Bearer` or as the HttpOnly cookie the `/?token=` launch link sets. `paired-client`: LAN only;
  `/pair?code=` (browsers, cookie) or `POST /obp/pair` (native clients, bearer) redeems a one-time code (5 min)
  for a revocable credential stored as SHA-256 in `<data>/obp/paired-clients.json`; the QR carries
  `https://<lan>/pair?code=…#fp=sha256:…`, the fingerprint of the self-signed certificate kept in
  `<data>/obp/lan-identity.json`. Revocation closes live connections (close code 4003). `/obp/session` tells a
  page whether it holds a session (browsers cannot read a refused upgrade).
- **Allowlist.** Non-owner scopes run only registry rows with `PeerStance::Proxied`; owner-only events are the
  registry's `event_stance` prefixes (`account://`, `window://`, `tray://`, updater, `peer-host-invoke://`, ...).
  The `obp_*` Devices commands are `ControllerLocal`.
- **Backpressure.** A client that sends `ack: true` gets a byte window (default 1 MiB, clamped 64 KiB–16 MiB),
  checked per event; a stalled client whose unread backlog passes 8 MiB is skipped to the newest event with
  `events-dropped {reason: "slow_client"}`. Batches read while behind merge consecutive `agentic://text-chunk`
  events of one stream (the merged event keeps the last `seq`). At most 64 calls run per connection.
- **Client.** `servedBackend.ts` installs `webSocketConnection.ts` and the browser-tab shell when the page has
  `#nsh-params`; it reconnects with backoff, resumes after `lastSeq`, fails in-flight calls loudly, and
  `backendResync.ts` re-reads sessions, the open transcript, permission prompts and the question mailbox on
  `events-dropped`.

Remaining after phase 3 (wave 4 delivered the relay tunnel as the device mesh and Peer Device Mode on OBP, below): retiring `mobile-web` and
the embedded LAN relay (both still served), a native NSH mobile client that pins the QR fingerprint (browsers
show the self-signed warning; the user compares the fingerprint).

### Device mesh: OBP between account devices over EasyTier (wave 4, implemented)

New clients connect the devices of one account through an [EasyTier](https://github.com/EasyTier/EasyTier)
network instead of the old relay transport. The relay server stays the account's device directory (names,
X25519 public keys); it carries no mesh traffic.

- **Sidecar.** The official `easytier-core`/`easytier-cli` v2.6.4 binaries (LGPL-3.0, separate executables,
  `scripts/fetch-easytier.mjs` pins the archive SHA-256; packaged in `Contents/Resources/bin` or `bin/`)
  run as a hidden child process (`openbitfun-mesh-service::sidecar`): no TUN, no root, DHCP virtual IP,
  hostname = account device id, loopback-only SOCKS5 and RPC portal, inbound virtual TCP admitted only to
  the OBP mesh ports 47612-47619, restart with backoff, stopped on sign-out and quit, a stale sidecar of a
  crashed run is reaped. Config (with the network secret) is written 0600 under `<data>/mesh`.
- **Credentials.** `POST https://remote.openbitfun.com/mesh/v1/credentials` (`relay-service::mesh_issuer`,
  deployed as `openbitfun-mesh-issuer`, `deploy/easytier`) verifies the OpenBitFun identity access token and
  returns `{networkName: "obf-" + HMAC(key, accountId), networkSecret, peers, easytierVersion}`: every
  device of the account gets the same network, nobody else can derive it, the issuer stores nothing.
  Clients cache the document per account (0600) and use it while the issuer is unreachable; a 404 answers
  an explicit `mesh_unsupported` state. The shared node (`openbitfun-relay`) relays only `obf-*` networks.
- **Listener.** `ObpServer::start_mesh` binds the first free port of 47612-47619 on loopback (no-TUN
  EasyTier delivers inbound mesh TCP there), TLS with the backend's self-signed identity, routes `/obp`
  and `/obp/mesh/info` only. The upgrade carries `Authorization: ObpMesh <proof>` plus device, target,
  time and nonce headers; the proof is HMAC over both device ids, the TLS certificate fingerprint the
  client saw, the time and the nonce, keyed from the device pair key (`device_crypto::derive_message_key`
  of the directory keys). The `101` returns the server's proof. Nonces are single-use, clocks may differ
  by 120 s, browser `Origin`s are refused. The connection scope is `account-device`: registry `Proxied`
  commands only, owner-only events (now including `mesh://`) withheld, the same credit/ack, coalescing
  and resume as every OBP connection; `hello` adds the `mesh_v1` capability.
- **Discovery and API.** EasyTier's route table is the presence list (hostname = device id, virtual IP,
  p2p or relayed, latency); `/obp/mesh/info` (unauthenticated, no secrets) advertises device id, OBP
  protocol, capabilities (`obp_v1`, `mesh_v1`) and the certificate fingerprint. Owner commands
  `mesh_status` and `mesh_list_devices` (`ControllerLocal`) and the `mesh://status-changed` event
  expose them; `crate::mesh::connect_device(device_id, options)` returns an authenticated
  `MeshObpConnection` (`call`, `next_event` with ack-on-take backpressure, resume via `lastSeq`), which
  Peer Device Mode, Detached Dispatch and IM bots use (next section).
- **Controls.** `OPENBITFUN_MESH=off` disables it; `OPENBITFUN_MESH_API_URL` points at another issuer;
  `OPENBITFUN_EASYTIER_DIR` at other binaries; `OPENBITFUN_MESH_DISABLE_P2P=1` forces relaying.

### Peer Device Mode, dispatch, bots and phones over the mesh (wave 4, implemented)

New-version devices no longer use the old relay transport (`account_device_rpc`, relay `rpc-call`,
`machine-event`, `HostStream`) between each other. Older devices keep it, negotiated per device; hosts keep
serving it for older peers and clients.

- **Peer Device Mode** ([peer-device-mode.md](peer-device-mode.md#obp-over-the-device-mesh-new-hosts)). A
  device in the account mesh whose listener advertises `obp_v1` + `mesh_v1` is driven over OBP: the
  controller's backend holds the authenticated link (`mesh/peer_link.rs`; `peer_link_connect`, `peer_link_call`,
  `peer_link_events` long poll with the peer's own `seq` and resume, `peer_link_disconnect`, all
  `ControllerLocal`), and the NSH bridge makes it the surface's data backend: registry `ControllerLocal`
  commands and owner-only events stay local, everything else is the peer's, unchanged and live. Chosen over a
  UI-side socket because the device handshake key stays in the backend; the extra hop is in-process. The hello
  adds `hostCapabilities` (the registry's peer-host list) for feature gates. A device on the mesh is never sent
  to the relay, also while the mesh cannot reach it (reported instead); devices never seen on the mesh, and
  hosts that run no mesh (older Tauri desktops, CLI), keep the relay path. The banner and Devices say which path is in use.
- **Detached Dispatch and IM bots.** The `account-device` scope also runs `dispatch_target_*` and
  `obp_remote_command` (a bot `RemoteCommand`), advertised as `dispatch_target_v1` / `remote_command_v1`.
  Controllers go through the `remote_connect::mesh_route` port (desktop implementation `mesh/route.rs`): a mesh
  device with the capability gets OBP (errors are reported, never retried over the relay); older targets keep
  the relay RPC with the same agent-identity translation.
- **Phones and browsers anywhere** (Devices > Use on phone). Same network: the LAN listener and its pairing QR.
  Anywhere: the phone joins the account mesh with the official EasyTier app (Android: the EasyTier GUI APK from
  GitHub releases; iOS/iPadOS 16+: the EasyTier app on the App Store, not offered in mainland China), using the
  network name, secret and peer `mesh_phone_join_info` shows (secret revealed on demand, never logged), then
  scans a mesh pairing QR (`obp_create_pairing {via: "mesh"}`). The mesh listener serves the UI bundle and the
  `paired-client` routes to requests without the device handshake (own cookie, same pairing store and
  revocation as the LAN). Browsers show the self-signed certificate warning once; the user compares the
  fingerprint. Neither path uses `mobile-web` or the relay: `mobile-web` and the relay pairing stay only for
  older hosts and the OpenBitFun-Mobile native clients (compat), and Devices labels that section so.

| Client | Same network | Anywhere |
|---|---|---|
| Android phone | Any browser + LAN QR | EasyTier app, then browser + mesh QR |
| iPhone / iPad (16+) | Safari + LAN QR | EasyTier App Store app (not in mainland China), then Safari + mesh QR |
| Another computer's browser | LAN URL / QR link | Only if that computer runs EasyTier in the account mesh |
| Another OpenBitFun desktop (native) | Peer Device Mode over the mesh | Peer Device Mode over the mesh |
| Older OpenBitFun host or client | Legacy relay / `mobile-web` | Legacy relay / `mobile-web` |

### Native desktop host: host adapters and the shell channel (phase 1, wave 4)

The backend dispatcher is generated from the `backend_commands!` list in `src/apps/desktop/src/lib.rs`
(`scripts/generate-desktop-native-dispatch.mjs`): every `// @backend-command` handler gets a typed arm, and a
command that works on the host or its UI shell rather than typed arguments is a host adapter
(`backend_protocol/native_commands/`, registered as `backend_protocol::native_commands::<command>`, same argument
and response shapes older clients send). An unknown name answers `unsupported_in_native_host: <command>`; a
retired one adds its registry reason.

- **Shell channel.** Window, tray, notifications, clipboard, the login item and the app lifecycle belong to the
  NSH shell, not to the backend library. The backend asks the shell: `host://shell-request {id, op, args}`
  (owner-only event stance), answered by `host_shell_respond`; the shell announces its operations once with
  `host_shell_attach` (`src/nsh-ui/src/nshShellRequests.ts`, `src/apps/desktop/src/host/shell.rs`). A shell that
  never attached, or does not offer an operation, gets an immediate `unsupported_in_native_host` error, never a
  hung request. Both commands are `ControllerLocal`.
- **Updater.** The native app keeps OpenBitFun's own channel instead of NSH's package updater: same
  `latest-v1.json` manifests and mirror, same minisign release key (`TAURI_UPDATER_PUBKEY`, compiled into the
  backend as `OPENBITFUN_NATIVE_UPDATER_PUBKEY`), same staged `pending.json` semantics and event
  (`openbitfun-update-progress`, now owner-only). Release artifact: `OpenBitFun-nsh_<version>_<arch>.app.tar.gz`
  plus its `.sig` (`pnpm run desktop-nsh:package:mac -- --updater-archive`), listed as
  `platforms["darwin-<arch>-nsh"] = { url, signature }` (native updater) and `platforms["darwin-<arch>"]` (the
  bridge: an installed Tauri build installs the same signed archive through its `Contents/MacOS/openbitfun-desktop`
  link and restarts into the native runner; same identifier and key). Only an archive with
  `Contents/MacOS/<runner>` and `Contents/Resources/nsh/bundle.nshc` is staged, so an old Tauri package never
  replaces a native install. The cache is `app-updates-nsh`. Install replaces the bundle and asks the shell to
  restart. Windows and Linux report that in-place install is not available yet; their manifests carry no
  `platforms` key, so installed Tauri builds there report that no package exists, and the native zip/tarball are
  manual downloads listed in `manual_installers`.
- **Embedded browser.** Pages are NSH `WebView`s in the UI process, kept alive by `BrowserPageLayer` (the
  Browser scene places the presented page over its viewport; other pages, such as an agent's, stay mounted off
  screen). The backend keeps the target registry of `api::browser_api` and owns every agent-facing semantic
  (`native_browser.rs`): target ownership by conversation, navigation waits fed by page-load reports, and the
  CDP-shaped primitives of `BrowserActions` translated by `openbitfun_webdriver::actuated` onto shell
  operations `browser.{create,navigate,reload,inject,evaluate,input,state,setBounds,close}`. Clicks and the four
  special keys use NSH `sendInput` (trusted) while the page is on screen, synthetic DOM events otherwise; text is
  inserted through the DOM (trusted typing lands key by key after the call returns). Scripts with a result run
  injected and post their envelope back through `window.nsh.postMessage` with a per-request nonce, because NSH
  0.6's `WebViewRef.evaluate` never answers on macOS (every call times out, `1 + 1` included). Not available: screenshots/previews (no snapshot API), cookies
  (`Network.getCookies`/`setCookie`, page scripts cannot see HttpOnly cookies), CDP-only `DOM.*`. A browser tab
  shows the Browser scene's unsupported state (only the native shell holds web views the
  backend can drive). `browser-webview-page-load` is owner-only.
- **MiniApp windows.** The native host claims the MiniApp host lease without waiting, starts the local MiniApp
  IPC endpoint and launches the same lightweight shell sidecar (`openbitfun-miniapp-shell`, bundled next to the
  runner; still a Tauri app of its own), so a Space runs with the full bridge. In-product tabs are refused
  (`kind: tab`), and when another host (an older Tauri desktop) already owns the profile's lease the native host
  says so. Agent MiniApp automation (`miniapp_web_host`) drives independent windows through their agent bridge.

| Commands | Native host |
|---|---|
| `send_system_notification`, `set_tray_unread_count`, `initialize_tray_after_startup`, `show_main_window`, `hide_main_window_after_close_request`, `minimize_to_tray`, `toggle_main_window_fullscreen`, `quit_app`, `restart_app` | Adapter over the shell channel |
| `get_clipboard_files`, `get_clipboard_image`, `write_clipboard_image` | Adapter over the shell channel (NSH `Clipboard`); `write_clipboard_image` takes `{png: base64}` or bytes |
| Launch at login (product-control option `desktop-lifecycle:launch-at-login`) | Shell channel (`Application.launchAtLogin`) |
| `open_html_file_in_browser` | Adapter (system opener) |
| `check_for_updates`, `download_update`, `get_pending_update`, `install_pending_update`, `install_update` | Adapter (native update channel above) |
| `miniapp_presentation` | Adapter (independent windows); `miniapp_ai_chat` now takes `HostHandle` and runs natively |
| `browser_webview_{create,navigate,reload,eval,set_bounds}`, `browser_get_url` | Adapter over the shell channel (embedded browser below) |
| `browser_webview_capture_preview` | Adapter answering its explicit `{status: "unsupported"}` shape: NSH 0.6 has no web view snapshot API (agent `Page.captureScreenshot` fails with the same reason) |
| `browser_webview_report_page_load` (new, `ControllerLocal`) | Native: the NSH web views report `started`/`finished`/`failed` |
| `confirm_frontend_update`, `frontend_update_candidate_{ready,failed}`, `get_frontend_update_status`, `rollback_frontend_update` | Retired (WebView frontend hot update; the native UI bundle ships inside the app bundle) |
| `debug_{open,close}_devtools`, `debug_devtools_available`, `debug_element_picked` | Retired (WebView devtools and element inspector) |
| `show/hide/resize_agent_companion_desktop_pet`, `load_agent_companion_pet_spritesheet`, `desktop_card_*` (7) | Retired (transparent always-on-top Tauri windows; Settings › General says so) |
| `miniapp_market_capture_window`, `miniapp_market_submit_installed`, `miniapp_render_slide_page`, `market_image_load`, `local_file_download` | Retired (they captured, rendered or saved through the Tauri WebView) |
| `resolve_browser_dropped_file_paths`, `set_file_drop_preview_target`, `set_macos_edit_menu_mode`, `set_main_window_transient_geometry`, `startup_window_control`, `webdriver_bridge_result` | Retired (the NSH shell owns drag and drop, menus and window geometry; the embedded WebDriver is gone) |

Runners: `openbitfun-nsh` runs on macOS (`nsh-macos-app`), Windows (`nsh-windows-app`, WebView2) and Linux
(`nsh-linux-app`, GTK 4 / WebKitGTK 6) with the same backend library and module; packaging is
`pnpm run desktop-nsh:package:{mac,windows,linux}` and CI compiles the Windows and Linux runners
(`desktop-nsh-runners` in `ci.yml`). The folder picker is AppKit-only so far; elsewhere the UI refuses
"Open folder" with its explicit message.

### Tauri sunset (wave 4)

The desktop product builds, runs, packages and ships only as the native NSH app.

- **Removed.** The Tauri desktop shell: `tauri`/`tauri-plugin-*`/`tauri-build` from `openbitfun-desktop`, the
  `openbitfun-desktop` executable, `tauri*.conf.json`, `capabilities/`, window chrome, tray, menu bar, window
  state, webview recovery, the frontend asset protocol and hot update (`frontend_workbench`), desktop cards and
  the pet windows, the embedded WebDriver (only `openbitfun_webdriver::actuated` remains), the Tauri transport
  adapter, the Tauri updater path (`tauri-plugin-updater`; the native updater remains), the `#[tauri::command]`
  layer (now `// @backend-command` + `backend_commands!`), the React desktop UI (`src/web-ui`) and its audits,
  and the WebDriver E2E suite (replaced by `tests/e2e/native/smoke.mjs` and the NSH UI suite). 33 commands that
  only the Tauri shell could run are `retired(...)` registry rows: older clients get
  `unsupported_in_native_host: <command> (retired: <reason>)`, peers get the stable retirement refusal.
- **Still Tauri, on purpose.** The MiniApp window sidecar (`src/apps/miniapp-shell`, a separate executable the
  native host launches for independent MiniApp windows), Data Tools (`src/apps/data-tools`) and the installer
  (`OpenBitFun-Installer`). The root `[patch]` entries for tao/wry/tauri-runtime stay for them.
- **Packages (wave 5).** The three packaging scripts share `scripts/desktop-nsh-package-common.mjs` and bundle
  what the Tauri bundle carried: the pinned Flashgrep workspace search daemon (`flashgrep/`, macOS
  `Contents/Resources/flashgrep/`) and the DeepSeek Harness profile (`resources/dsh-profile`), at the paths the
  backend resolvers read. `--product-config` threads a product definition through packaging: bundle and window
  name, bundle identifier and NSH app id (projected into the bundle's `nsh/app.json`), the legacy executable name
  (`binaryName`: the macOS bridge link and the Windows runner, `openbitfun-desktop.exe`), declared icons, and the
  backend's compile-time product id and data namespace in a product-scoped target dir. `OpenBitFun-Installer`
  installs the native Windows package directory (runner, backend DLL, `nsh\`, resources) under the same
  executable name, so shortcuts, the uninstall entry and Tauri-era installs keep working; obsolete Tauri files the
  previous install owned are removed. Release builds use the `release` profile (thin LTO, stripped runner and
  backend).
- **Upgrade path.** User data is shared: `PathManager` resolves the same config, profile, session and log roots
  (`dirs::config_dir()/<namespace>`, `~/.<namespace>`) as before, and the native host is not a Tauri app-data
  consumer. On macOS installed Tauri builds update into the native app through the bridge manifest key above;
  the bundle identifier (`com.openbitfun.desktop`), the minisign key, and the legacy executable name (a link)
  stay. An old launch-at-login item keeps working through that link. On Windows and Linux there is no native
  in-place update yet: installed Tauri builds report that no package exists for their platform and users
  install the native zip/tarball manually (on Windows the Installer can also install the native package; the
  release does not publish it yet). The release notes (`scripts/release-notes/<version>.md`) say so. Not carried over: Tauri window geometry
  (`.window-state.json`), UI-only preferences in the old WebView's local storage, desktop cards and the pet window.

## What it replaces

| Today | Replaced by |
|---|---|
| Tauri WebView hosting the React UI (`src/web-ui`) | Native NSH host, backend in-process (retired in wave 4) |
| `host_invoke` envelopes over `account_device_rpc`, executed by bouncing into the host's webview (`PeerHostInvokeBridge`) | `call` over OBP straight into `BackendService::dispatch` |
| `DeviceEvent` fan-out allowlist and source-device tagging | Per-connection event stream with scope filtering |
| Remote session records via "nudge then pull" (`host-stream-changed` + `read_stream`), no token streaming | Live seq-numbered events; durable records stay the history read through commands |
| `mobile-web` and its `RemoteCommand` DTOs | The same NSH UI served by the backend |
| Embedded LAN relay | Direct LAN WebSocket with pinned pairing |
| Duplicated CLI peer handlers | One generated dispatch shared by Desktop and CLI hosts |

## Upgrade compatibility

Existing paired devices keep their identities and keys; the tunnel handshake reuses them, so nothing is re-paired.
Clients probe for OBP (`obp_v1` + `mesh_v1` on the device's mesh listener; `dispatch_target_v1` and
`remote_command_v1` for dispatch and bots) and fall back to `host_invoke` / `read_stream` against older hosts
that never join the mesh. Hosts keep serving `RemoteCommand`, `HostStream` and `machine-event` until no supported peer needs them
(including the native clients in OpenBitFun-Mobile). Every phase ships old-peer/new-peer round-trip tests in both
directions.

## Display-only frontend: logic migration

Rules that live in a client drift between clients. Known cross-client inconsistencies at the start of this work:

- Mid-turn send: the NSH UI steers; mobile and bots always queue.
- The local queue fallback drains only while its window is open.
- "A started session cannot change agent" is enforced only in UIs.
- Transcript projection differs between NSH (`format.ts`) and the backend `ChatMessage` used by mobile.
- Slash commands differ between the UI and bots.
- The usage heatmap keys days in UTC on Home and in the local zone on the Usage page.
- Unread marks and terminal profiles are per-client local storage.
- Model request-URL resolution has several copies.
- Whole-document config writes race between clients.
- The dispatch preflight hard-codes the protocol version and capability list.

Migration batches (each moves a rule into its existing backend owner and deletes the client copy):

| Batch | Content |
|---|---|
| 1 | Delete client duplicates the backend already enforces (max-tokens cap, memory window, capability defaults, quick-action defaults, request URL, `expectedHash` on save, `i18n_set_language`, dispatch readiness from `dispatch_probe_target`) |
| 2 | Typed config mutations instead of whole-document writes (models, task models, permissions, web search, ACP, MCP, settings descriptors via product control) |
| 3 | Turn and session policy: `submit_user_message` (steer/queue decided server-side), no local queue, mode catalog + rebind rule in `update_session_mode`, session commands, stop fallback, `mark_session_seen` |
| 4 | View models: transcript view with typed deltas, usage activity, personal overview, workspace navigator, device list with presence, capability flags in DTOs |
| 5 | Liveness and routing: remote workspace link state, `git://status-changed`, compound git operations, cron draft validation, assistant identity, terminal profiles in config, backend-held peer scope |

What may stay in the frontend: rendering, layout, animation, text formatting, transient UI state (open panels,
drafts, selection, scroll), and the transport adapter.

Batch 4 and 5 status (wave 4). Every command below has a registry row (none `Unaudited`); an older host without it
gets an explicit "update the host" state in the NSH UI, never the deleted client copy.

| Rule | Backend owner and command | Client copy removed |
|---|---|---|
| Transcript projection | `remote_connect::transcript_view` (services-integrations) projects persisted turns once; `get_session_transcript_view {session_id, workspace_id, limit, cursor}` (Routed, CLI handled). Mobile/bot `ChatMessage` is derived from the same view (`chat_messages_from_transcript`). Turns carry `settled` (terminal status persisted); a `cursor` names the last settled turn, so re-reads return only what follows it (`mode: "after"`) | `format.ts` raw-record parsing; `agentEvents.ts` settle heuristics (item counting, turn-count baseline, 250/750 ms retries): the live stream is replaced exactly when a view read reports its turn settled |
| Usage activity | `get_token_usage_activity {timeZone, months}` keys days in the requested zone for Home and Usage | Client day keying (Home used UTC, Usage the local zone) |
| Personal overview | `get_personal_overview {timeZone, activityMonths}` with per-section `ready/failed/unsupported` | Home's multi-read composition |
| Workspace navigator | `get_workspace_navigator {selectedId}` (dedupe, selection rule) | `loadWorkspaces` merge in `state.ts` |
| Device list | `account_list_devices` rows carry `online`, `presence`, `is_local` | Client join with `account_online_devices` |
| Capability flags | Skill `canDelete`/`canToggle`, mode/subagent `canEdit`/`canDelete`, MiniApp `permissionBadges`; `get_permission_settings` page read | Client derivations (kept only as commented compatibility reads for hosts whose DTO lacks the field) |
| Remote workspace link | `remote_workspace_ensure_connected`, `remote_workspace_link_states`, event `remote://link-state` (`remote_ssh::link_supervisor`: probe, reconnect, 30 s heartbeat, backoff) | `sshRemoteStore.ts` heartbeat and reconnect loop |
| Git liveness | `git://status-changed` (`git::status_watch`, leased via `git_watch_status`/`git_unwatch_status`), `git_discard_files`, `git_push {publishIfNoUpstream}`, `git_commit_and_checkout`, untracked files in `git_get_diff` | Client git polling and compound git sequences |
| Cron drafts | `validate_cron_job_draft`, `preview_cron_occurrences` (CLI handled) | Client cron parser |
| Assistant identity | `create_assistant_workspace {name}`, `set_assistant_identity` | `identityDocument.ts` read-modify-write |
| Terminal profiles | Config `terminal.profiles` keyed by workspace id; `get/upsert/delete/import_terminal_profiles` (CLI handled); the client hands its old `Storage` copy over once | Per-client local profile storage |
| Review launch (wave 5) | `launch_review {parentSessionId, intent, files, focus, commandText, requestId, dryRun}` (`RemoteUnsupported`, Proxied, CLI not implemented): the host resolves workspace changes with Git, builds target evidence, run manifest and prompt (`agent-runtime` `deep_review::launch_plan`) and creates and starts the read-only `CodeReview` / `DeepReview` child; ordinary targets over 80 files are refused with their file list (the managed packet plan is not ported) | The React launcher's target resolver, classifier, manifest and prompt builders (`flow_chat/deep-review/launch`, `review-team`); the NSH sheet only sends choices and opens the child |
| Agent navigation (wave 5) | The control host resolves an `open` / product-action `execute` request to its catalog `destination` (`openbitfun_control_host.rs` `presentation_destination`) and sends it with `agentic://openbitfun-control-request`; the NSH window maps it onto its screens and reports with `report_openbitfun_control_result` | The React UI's generated capability catalog copy used to resolve destinations (`interactiveCapabilityCatalog`) |
| Running-turn hydration (wave 5) | `get_session_transcript_view` `runningTurn` from the runtime session-event journal (`running_turn_event_snapshot`) | A client-side reconstruction of a turn it did not see start (the React UI read `restore_session_view` and replayed it itself) |

Running turn and live channel (wave 5). `get_session_transcript_view` also answers `runningTurn` (Routed row unchanged; additive field): the runtime journal's projection of the turn running now, as the same `agentic://*` events the live wire carries plus the delivery cursor they reached. A client that connects or reopens a session mid-turn replays them through its own live handlers and drops live events at or below that cursor, so no client-side snapshot of a running turn is needed. Decision on the typed live-delta stream (`transcript://delta`): not built. The `agentic://*` events stay the live channel because they are already the typed, journaled, cursor-carrying stream (the journal behind `load_session_event_backfill` and `runningTurn` is built from them), and the per-frame smoothness rests on them: the host coalesces text chunks, the client merges once per frame (`textChunkCoalescer.ts`, which now records the cursor span of every merged part) and reveals per round on its own signals. A second delta stream would duplicate that path, re-project every chunk into view items on the host, and double the bytes on the mesh for no change in what a client draws; the view keeps the durable record and the settle signal. Remaining: the backend-held peer scope belongs to the Peer Device Mode work; marketplace `installed` flags are still derived by the client.

## Phases

| Phase | Deliverable | Retires |
|---|---|---|
| 1 | Native NSH desktop host with in-process `BackendService`; host shim makes every command callable without Tauri; shell channel, native updater, MiniApp windows and Windows/Linux runners (wave 4); the Tauri shell and React UI retired (wave 4 sunset); wave 5 ports the MiniApp market into Spaces (browse, listing detail, install/update with the host's permission and overwrite confirmations, rating, favorites, submissions with withdraw, `.bfminiapp` import, installed marks from `miniapp_market_installed_origins`) on the existing `miniapp_market_*` commands; submitting a new release stays retired with its Tauri window capture | WebView at runtime, Tauri desktop shell, `src/web-ui` |
| 2 | OBP for Peer Device Mode: live token streaming desktop-to-desktop, calls go straight to dispatch. Wave 4: done over the device mesh (`peer_link_*`, NSH bridge routing, per-device negotiation, legacy relay kept for older devices) | Webview bounce for peer calls, fan-out allowlist, nudge-then-pull for live content (new-to-new) |
| 3 | WebSocket listener, UI bundle serving, LAN pairing; logic batches 1-3 | Embedded LAN relay, `mobile-web` on LAN, `apps/server` dispatcher |
| 4 | Relay tunnel with end-to-end encryption; logic batch 4. Wave 4 delivers the transport as the EasyTier device mesh (sidecar, issuer, `account-device` listener, client helper), Peer Device Mode, Detached Dispatch and IM bots on it, and phones over the LAN or the mesh (paired-client on the mesh listener) | `mobile-web` and the relay for new clients (kept for older hosts and clients); typed `RemoteCommand` still carries bot calls (`obp_remote_command`) |
| 5 | Bots, dispatch observers and the CLI host on `BackendService`; logic batch 5 | Poll paths, duplicate CLI handlers (the desktop's Tauri crate dependency is gone since the wave 4 sunset) |

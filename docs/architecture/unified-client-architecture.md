# Unified client architecture: one UI, one protocol, display-only frontend

Status: adopted direction (2026-11). Phase 1 of the native desktop host is being built; the protocol and
logic-migration phases below are planned. This document is the owner for the target shape; per-phase status
lives in the phase tables.

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

- `dispatch(command, args) -> Result<json, error>`: `command` is the product command name (today's Tauri command
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
The native host starts it in `start_native_backend`; the Tauri host does not (its `obp_*` commands answer an
explicit `obp_unavailable` state). `OPENBITFUN_OBP_LISTENER=off` disables it; `OPENBITFUN_OBP_PORT` /
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

Remaining after phase 3: the relay tunnel (phase 4), Peer Device Mode on OBP (phase 2), retiring `mobile-web` and
the embedded LAN relay (both still served), a native NSH mobile client that pins the QR fingerprint (browsers
show the self-signed warning; the user compares the fingerprint), and starting the listener from the Tauri host.

## What it replaces

| Today | Replaced by |
|---|---|
| Tauri WebView hosting the UI | Native NSH host, backend in-process |
| `host_invoke` envelopes over `account_device_rpc`, executed by bouncing into the host's webview (`PeerHostInvokeBridge`) | `call` over OBP straight into `BackendService::dispatch` |
| `DeviceEvent` fan-out allowlist and source-device tagging | Per-connection event stream with scope filtering |
| Remote session records via "nudge then pull" (`host-stream-changed` + `read_stream`), no token streaming | Live seq-numbered events; durable records stay the history read through commands |
| `mobile-web` and its `RemoteCommand` DTOs | The same NSH UI served by the backend |
| Embedded LAN relay | Direct LAN WebSocket with pinned pairing |
| Duplicated CLI peer handlers | One generated dispatch shared by Desktop and CLI hosts |

## Upgrade compatibility

Existing paired devices keep their identities and keys; the tunnel handshake reuses them, so nothing is re-paired.
Clients probe for OBP (`obp_v1`, relay `tunnel_v1`) and fall back to `host_invoke` / `read_stream` against older
hosts. Hosts keep serving `RemoteCommand`, `HostStream` and `machine-event` until no supported peer needs them
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

## Phases

| Phase | Deliverable | Retires |
|---|---|---|
| 1 | Native NSH desktop host with in-process `BackendService`; host shim makes every command callable without Tauri | WebView at runtime |
| 2 | OBP over the existing encrypted lanes for Peer Device Mode: live token streaming desktop-to-desktop, calls go straight to dispatch | Webview bounce for peer calls, fan-out allowlist, nudge-then-pull for live content |
| 3 | WebSocket listener, UI bundle serving, LAN pairing; logic batches 1-3 | Embedded LAN relay, `mobile-web` on LAN, `apps/server` dispatcher |
| 4 | Relay tunnel with end-to-end encryption; logic batch 4 | `mobile-web`, typed `RemoteCommand` for new clients |
| 5 | Bots, dispatch observers and the CLI host on `BackendService`; logic batch 5 | Poll paths, duplicate CLI handlers, Tauri crate dependency |

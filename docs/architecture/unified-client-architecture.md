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

The backend exposes one service, `BackendService` (`src/apps/desktop/src/backend_protocol`), to every client.
The wire itself (event ring, JSON-RPC framing, scopes, listeners, the Link handshake, the `obp-e2e-v1` channel
and the controller client) is one crate, `openbitfun-obp` (`src/crates/adapters/obp`, adapters layer: protocol
and transport projection with no product rules): feature `server` for hosts (the desktop backend, the CLI host),
feature `client` for controllers (the desktop's Peer Device Mode, Detached Dispatch and IM bots, the phone app).
A host plugs in its dispatcher and event source through `server::ObpBackend` (plus its kind, its same-account
host verbs and their capabilities); the desktop's `backend_protocol::ws` and the CLI's `obp_host` are thin
adapters over it.

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
| Relay tunnel | Any client, anywhere | The relay forwards opaque frames between same-account devices; end-to-end encryption uses the existing device X25519 keys |
| Browser gateway (`wss://<domain>/obp/<deviceId>`) | A browser anywhere (the web controller) | A byte pipe into the account's Link network; the browser and the device run the `obp-e2e-v1` end-to-end channel inside it (X25519 device keys, AES-256-GCM), so the gateway sees ciphertext |
| Device mesh (OpenBitFun Link, an EasyTier fork in-process) | Another desktop of the same account, anywhere (same network included) | TLS WebSocket to the device's mesh virtual IP; P2P (LAN, IPv4, IPv6) with relay fallback through another account device or the server; `account-device` handshake with the device X25519 keys, or a `paired-client` QR credential for a phone browser (wave 4, below). The only multi-device transport of the new version (wave 6) |

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

Owner: `openbitfun-obp` (`src/crates/adapters/obp`, server), the desktop's adapter
`src/apps/desktop/src/backend_protocol/ws`, `src/nsh-ui/src/webSocketConnection.ts` (client).
The native host starts it in `start_native_backend`. `OPENBITFUN_OBP_LISTENER=off` disables it; `OPENBITFUN_OBP_PORT`
overrides the preferred loopback port (47610, ephemeral when taken).

- **Listeners.** Loopback `http://127.0.0.1:<port>` always; the mesh listener (TLS, next sections) while the device
  mesh runs. There is no LAN listener (retired in wave 6, see "Mesh only"). Both serve the NSH web bundle at `/` (`pnpm run desktop-nsh:web`, found via
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
  `Authorization: Bearer` or as the HttpOnly cookie the `/?token=` launch link sets. `paired-client`: mesh
  listener only; `/pair?code=` (browsers, cookie) or `POST /obp/pair` (native clients, bearer) redeems a one-time
  code (5 min) for a revocable credential stored as SHA-256 in `<data>/obp/paired-clients.json`; the QR carries
  `https://<virtual-ip>:<port>/pair?code=…#fp=sha256:…`, the fingerprint of the self-signed certificate kept in
  `<data>/obp/lan-identity.json` (name kept from the LAN listener so the certificate survives upgrades). Revocation closes live connections (close code 4003). `/obp/session` tells a
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

Remaining after phase 3 (wave 4 delivered the relay tunnel as the device mesh and Peer Device Mode on OBP, below;
wave 6 retired the LAN listener and the embedded LAN relay): retiring `mobile-web` (still served by the cloud relay
for older hosts and clients), a native NSH mobile client that pins the QR fingerprint (browsers show the
self-signed warning; the user compares the fingerprint).

### Device mesh: OBP between account devices over OpenBitFun Link (wave 4, Link core wave 7)

The devices of one account connect through **OpenBitFun Link**, an EasyTier v2.7.1 fork
(`third_party/easytier`, LGPL-3.0, changes in its `OPENBITFUN-PATCH.md`) that every end embeds, instead of
the old relay transport. The relay server stays the account's device directory (names, X25519 public keys);
it carries no Link traffic. Wave 4 ran the official EasyTier binaries as a sidecar; wave 7 replaced them.

- **In-process node** (`openbitfun-link`, services layer). The desktop backend and the CLI host (wave 9) run
  the fork on its own Tokio runtime: no TUN, no root, no child process, no SOCKS5 or other proxy port. DHCP
  virtual IP, hostname = account device id, direct listeners on `0.0.0.0` and `[::]` (TCP+UDP, IPv6 on), UDP
  and TCP hole punching, UPnP, LAN direct, relaying through another account device, and the relay node as the
  fallback. `Link` (`session.rs`) follows the account: joins on sign-in, leaves on sign-out and quit, restarts
  a stopped node with backoff. Hosts get tokio `AsyncRead + AsyncWrite` streams: `Link::accept()` (inbound
  streams on the OBP port) and `connect(device_id, port)` (outbound, through the fork's userspace stack).
- **Credentials and join tokens.** `POST https://remote.openbitfun.com/mesh/v1/credentials`
  (`relay-service::mesh_issuer`, deployed as `openbitfun-mesh-issuer`, `deploy/easytier`) verifies the
  OpenBitFun identity access token and returns `{networkName: "obf-" + HMAC(key, accountId), networkSecret,
  peers, easytierVersion, joinToken, joinTokenExpiresAt}`: every device of the account gets the same network,
  nobody else can derive it, the issuer stores nothing. The join token (`relay-service::link_token`, Ed25519,
  30 minutes, bound to network, account and device id) is what the relay node checks: a handshake without a
  valid token for its network is refused before any relay traffic, so nobody without a sign-in can join an
  account network or use relay bandwidth. Clients refresh it 10 minutes before expiry and cache the document
  per account (0600) for issuer outages; a 404 answers an explicit `mesh_unsupported` state. Network secrets
  and tokens are never logged or shown in a UI (`mesh_phone_join_info` is retired).
- **Listener.** `ObpServer::start_mesh_with` serves Link's inbound streams for the first free port of
  47612-47619 on the device's virtual IP (no host socket), TLS with the backend's self-signed identity, routes `/obp`
  and `/obp/mesh/info` only. The upgrade carries `Authorization: ObpMesh <proof>` plus device, target,
  time and nonce headers; the proof is HMAC over both device ids, the TLS certificate fingerprint the
  client saw, the time and the nonce, keyed from the device pair key (`device_crypto::derive_message_key`
  of the directory keys). The `101` returns the server's proof. Nonces are single-use, clocks may differ
  by 120 s, browser `Origin`s are refused. The connection scope is `account-device`: registry `Proxied`
  commands only, owner-only events (now including `mesh://`) withheld, the same credit/ack, coalescing
  and resume as every OBP connection; `hello` adds the `mesh_v1` capability.
- **Discovery and API.** Link's route table is the presence list (hostname = device id, virtual IP, route
  `direct_lan`/`direct_ipv4`/`direct_ipv6`/`relayed_peer` (+ `relayVia`)/`relayed_server`, latency, last
  seen, devices seen in the last day); `/obp/mesh/info` (unauthenticated, no secrets) advertises device id, OBP
  protocol, capabilities (`obp_v1`, `mesh_v1`) and the certificate fingerprint. Owner commands
  `mesh_status` and `mesh_list_devices` (`ControllerLocal`) and the `mesh://status-changed` event
  expose them; `crate::mesh::connect_device(device_id, options)` returns an authenticated
  `MeshObpConnection` (`call`, `next_event` with ack-on-take backpressure, resume via `lastSeq`), which
  Peer Device Mode, Detached Dispatch and IM bots use (next section).
- **Controls.** `OPENBITFUN_MESH=off` disables it; `OPENBITFUN_MESH_API_URL` points at another issuer;
  `OPENBITFUN_MESH_DISABLE_P2P=1` forces relaying.
- **Browsers: the web controller and the gateway (wave 8).** Browsers do not run Link (no WASM, no
  `easytier-js`). `https://<domain>/app/` serves the NSH web bundle with `#nsh-params` `{controller: {api,
  gateway}}` (`pnpm run web-controller:build`); the page installs the web `ControllerPort`
  (`src/nsh-ui/src/controller/`) and shows the controller shell: email, code, the account's devices, connect.
  The browser gateway (`openbitfun-link-gateway`, `src/apps/relay-server/link-gateway`, on loopback behind
  nginx `/obp/`, deployed as in `deploy/easytier/README.md`) signs the browser in through the identity
  authority, registers the browser's own X25519 device key in the account directory (a controller row,
  never a host), keeps the session in a sealed HttpOnly cookie, lists the devices with whether and why each
  can be connected, and pipes `wss://<domain>/obp/<deviceId>` to the device's OBP port through
  `openbitfun_link::gateway::LinkGateway` (one member per account network, the account from the session
  only, the target checked against that account's directory). It lives in its own process because it
  needs the issuer key (to mint its membership) and the relay node must not hold it. Inside the pipe the
  browser's page realm (`host.js`: WebCrypto key, non-extractable, in IndexedDB) and the device run OBP's
  **end-to-end channel** `obp-e2e-v1` (`backend_protocol/ws/e2e.rs`): a stream that opens with its magic
  instead of a TLS `ClientHello` gets the account-device proof over the directory pair key bound to fresh
  X25519 ephemeral keys, then AES-256-GCM records carrying the OBP messages; the connection then runs as
  `account-device` like any other. The gateway sees and logs only byte counts. A device on a build
  without the channel hangs up on the hello and the page asks to update it; a device off Link answers
  `4404` from the gateway.

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
  adds `hostCapabilities` (the registry's peer-host list) for feature gates and `hostKind` (`desktop`, `cli`;
  additive, display only). A device on the mesh is never sent to the relay, also while the mesh cannot reach
  it (reported instead); devices never seen on the mesh, and hosts that run no mesh (older Tauri desktops,
  CLI builds before wave 9), keep the relay path. The banner and Devices say which path is in use.
- **Detached Dispatch and IM bots.** The `account-device` scope also runs `dispatch_target_*` and
  `obp_remote_command` (a bot `RemoteCommand`), advertised as `dispatch_target_v1` / `remote_command_v1`.
  Controllers go through the `remote_connect::mesh_route` port (desktop implementation `mesh/route.rs`): a mesh
  device with the capability gets OBP (errors are reported, never retried over the relay); older targets keep
  the relay RPC with the same agent-identity translation. Both bot lanes use it: turns (`RemoteBotTarget`) and,
  since wave 9, the command router's menu commands (sessions, assistants, models; `exec_remote_rpc`).
- **Phones and browsers.** Phones join Link in the OpenBitFun app (native data plane through FFI, signed in
  with the account, `src/apps/mobile-nsh`); browsers reach devices through the gateway (above). Both run the
  same controller shell over the `ControllerPort` interface (`src/nsh-ui/src/controller/controllerPort.ts`:
  `requestCode`, `verifyCode`, `signOut`, `listDevices`, `connect`), web and native implementations. The
  wave-4 path through the official EasyTier app is retired with `mesh_phone_join_info` (network credentials are
  never shown); Devices › "Use on phone or in a browser" shows the web controller's address and its QR only. The mesh listener keeps serving the UI bundle and the `paired-client` routes to requests
  without the device handshake (own cookie, the one pairing store and revocation) for clients on Link.
  `mobile-web` and the relay pairing stay only for older hosts and the OpenBitFun-Mobile native clients.

| Client | Same network or anywhere |
|---|---|
| Phone (Android, iOS) | The NSH phone app (`src/apps/mobile-nsh`) joins Link as a controller with the email-code sign-in (wave 8, below); the OpenBitFun-Mobile apps keep the legacy relay |
| A browser anywhere (phone or computer) | `https://<domain>/app/`: email sign-in, the account's devices, OBP through the gateway with the end-to-end channel (wave 8); on this computer, the loopback owner link |
| Another OpenBitFun desktop (native) | Peer Device Mode over the mesh |
| A CLI host (`openbitfun`, the daemon) as the driven device | Wave 9: joins Link as a device while it serves this machine's device identity, OBP on its port like a desktop (below) |
| Older OpenBitFun host or client | Legacy cloud relay / `mobile-web` (the LAN relay of older hosts still works against those hosts) |

### CLI host as a remotely controlled device (wave 9)

The CLI process that serves this machine's device identity (the daemon, or an interactive `openbitfun` when no
daemon runs; a desktop app on the same machine is the primary host and wins) joins the account's Link network as
a device and serves OBP on its port (`src/apps/cli/src/obp_host.rs` over `openbitfun-obp`), so the desktop's Peer
Device Mode, the phone app and the browser controller drive it like a desktop host, with the same protocol.

- **When.** Signed in, remote control on (the machine-wide switch shared with the desktop app, `openbitfun
  remote-control [status|on|off]`; on by default), and this process owns device routing (its relay routing is
  not standing by for a desktop). Link re-checks on routing changes and every 15 s; `OPENBITFUN_MESH=off`
  turns it off. State lives in `<user data>/cli-host/` (`mesh/` credential cache, `obp/` TLS identity and
  pairings, `remote-control.json` status without secrets). No loopback listener (the terminal is the CLI's UI).
- **Calls.** `account-device` connections run the Peer Device host's registry-derived handlers
  (`peer_host::handle_obp_call`: the registry verdict for `PeerHostKind::Cli`, arguments and results in the
  canonical agent-identity dialect like every OBP host). A command the CLI does not run answers with the
  registry's refusal (`command 'x' is not supported on CLI peer host: …`, typed `data.kind = "unsupported"`);
  the relay control plane (`peer_mode_ping`, attach, detach) is not an OBP command. Host verbs:
  `dispatch_target_*` (the durable CLI runner) and `obp_remote_command` (bots), advertised as
  `dispatch_target_v1` / `remote_command_v1`.
- **Capabilities and events.** The `hello` carries `hostKind: "cli"` and the registry's CLI capability set in
  `hostCapabilities`, so the UI hides what the CLI does not serve. Events are the Peer Device host's fan-out
  (agentic events with their session cursors, permission requests, catalog, file watch, settings), published to
  the host's own ring in the canonical dialect; relay controllers keep their legacy DeviceEvents.
- **Compatibility.** Older controllers keep the relay path to the CLI (it still serves relay routing); older
  CLI builds are never on Link, so controllers keep their relay path to them. Remaining: an IM bot hosted by
  the CLI daemon reaches other devices through the relay only (the CLI installs no `mesh_route`).

### Phone app: the NSH UI as a Link controller (wave 8)

The phone app (`src/apps/mobile-nsh`, iOS and Android) is the same NSH UI built with a native module of its own,
`openbitfun/mobile` (crate `openbitfun-mobile-native`). It has no backend: the UI's controller port
(`src/nsh-ui/src/controller/controllerPort.ts`, shared with the browser controller) is implemented natively
(`src/apps/mobile-nsh/src/nativeController.ts`), and the chosen device's backend becomes the UI's connection.

- **Sign-in.** The email code goes through the account APIs every device uses: a device sign-in transaction of
  the identity service (`/auth/desktop/start?methods=all`) whose ticket takes the code (`/auth/email/send`,
  `/auth/email/verify`), then `/auth/desktop/poll` returns this phone's token pair. The phone registers its own
  X25519 public key in the account directory (`/relay/api/auth/login`, kind `mobile`); desktops derive the pair
  key from it exactly as for another desktop. The key, the token pair and the directory token are one record in
  the platform keystore (iOS Keychain `AfterFirstUnlockThisDeviceOnly`; Android an app-private 0600 file until
  NSH exposes the JVM for a Keystore wrap).
- **Link as a controller.** The module runs `openbitfun-link` with `NodeRole::Controller`: no OBP listener, no
  inbound virtual TCP, no forwarding of other devices' data; desktops list it as a controller, never as an
  unreachable device. P2P (LAN, IPv4, IPv6 hole punching) first, relayed by another account device or the server
  otherwise.
- **Devices.** Directory rows joined with the Link route (`direct_lan`, `direct_ipv4`, `direct_ipv6`,
  `relayed_peer` with the relaying device's name, `relayed_server`); controllers are left out; a device that is
  online but not on Link says `update_required`, one that is offline says `offline` (no relay fallback).
- **Connections.** OBP over a Link stream with the account-device handshake (the shared client,
  `openbitfun_obp::client`, the code the desktop's `ws/mesh_client.rs` re-exports): `account-device` scope, `Proxied` commands only, owner-only
  events withheld, credit/ack backpressure. A dropped connection redials on the next call and resumes after the
  last event the UI took (`lastSeq` + `instanceId`); a restarted backend answers `events-dropped` and the UI
  re-reads. The connection is the same JSON wire as the in-process desktop backend (`jsonWireConnection.ts`).
- **Packaging.** `pnpm run mobile-nsh:package:{ios-sim,ios,android}` (`scripts/package-mobile-nsh.mjs`, NSH
  `nsh package`); the module and Link build for `aarch64-apple-ios(-sim)` in NSH's generated workspace (libc is
  pinned to 0.2.189 there: 0.2.191 limits `RTAX_MAX` to macOS, which breaks EasyTier's `netdev` on iOS).

### Mesh only: LAN sunset and a domain-only server

The new version's multi-device connectivity is the account device mesh only. Devices on one network already
connect directly through it (every device runs a direct-connect listener and the mesh picks the LAN path), so the
separate LAN options are gone:

- **Removed.** The OBP LAN listener (TLS, 47611, `OPENBITFUN_OBP_LAN_PORT`), LAN pairing QR codes, the Devices
  "same network" options, the desktop's embedded LAN relay (`remote_connect` LAN mode, `RelayRoute::Lan`) and the
  LAN-only commands. Registry rows: `obp_set_lan_enabled`, `remote_connect_get_lan_ip` and
  `remote_connect_get_lan_network_info` are `retired(...)`. Kept: the loopback owner listener (a browser on the
  same computer), the mesh listener, and the `paired-client` scope on it (phones that joined the mesh).
- **Answers to older callers.** A retired command answers
  `unsupported_in_native_host: <command> (retired: <reason>)` and a non-owner scope gets `-32003` with the
  reason; `obp_create_pairing {via: "lan"}` answers `obp_lan_retired: …` (the default route is now `mesh`);
  `remote_connect_start`/`_stop` with `lan` answer `unsupported: the LAN relay was retired; …` before touching
  any service, and `remote_connect_get_methods` no longer lists it. No silent fallback to the cloud relay.
- **Compatibility.** Older mobile-web clients that paired through a LAN relay invitation
  (`http://<lan-ip>:9700`) cannot reach new hosts that way; they use the cloud relay invitation, which new and
  older hosts both still serve (older hosts also keep their own LAN relay). Phones paired on the LAN listener
  keep their credential record in `<data>/obp/paired-clients.json` and the same certificate
  (`lan-identity.json`), but must join the mesh and pair again (the browser cookie was per listener). The
  retired `<data>/obp/settings.json` (`lanEnabled`, `lanPort`) is no longer read and is left on disk untouched.
- **Domain-only server.** The OpenBitFun server opens no port of its own: it is reached only through its domain
  over HTTPS, and the hosting provider's front end forwards that traffic to nginx. The relay node listens on
  `ws://127.0.0.1:11011/` only and is reached as `wss://remote.openbitfun.com/mesh/et/` (the issuer hands out
  only that URL); no `0.0.0.0` or `[::]` TCP/UDP listener exists. This does not limit direct connections: hole
  punching runs between the devices themselves (addresses from public STUN servers, exchanged over the existing
  connection), and the server carries only coordination and the relayed fallback for devices that cannot connect
  directly (`deploy/easytier/README.md`). The front end closes a WebSocket after 180 s without traffic
  (measured); Link pings each WebSocket connection at least every 15 s and redials a lost relay connection
  every second; nginx keeps tunnels for 3600 s, unbuffered, and counts per-client limits by the forwarded client address.
- **Path label.** Devices shows one line per mesh device from `mesh_list_devices` / `mesh_status`
  (`route`: `direct_lan`, `direct_ipv4`, `direct_ipv6`, `relayed_peer` with the relaying device's name when the
  backend names it in `relayVia`, `relayed_server`; older backends send only `path` = `p2p` / `relayed`).

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
| Embedded LAN relay, LAN OBP listener | The device mesh (it picks the direct LAN path for devices on one network) |
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
| 3 | WebSocket listener, UI bundle serving, QR pairing; logic batches 1-3. Wave 6: the LAN listener and LAN pairing retired (mesh only) | Embedded LAN relay (retired wave 6), `mobile-web` on LAN (retired wave 6), `apps/server` dispatcher |
| 4 | Relay tunnel with end-to-end encryption; logic batch 4. Wave 4 delivers the transport as the EasyTier device mesh (sidecar, issuer, `account-device` listener, client helper; wave 7 replaces the sidecar with the in-process Link fork and join tokens), Peer Device Mode, Detached Dispatch and IM bots on it, and phones over the mesh (paired-client on the mesh listener). Then: mesh only, domain-only server node | `mobile-web` and the relay for new clients (kept for older hosts and clients); typed `RemoteCommand` still carries bot calls (`obp_remote_command`) |
| 5 | Bots, dispatch observers and the CLI host on `BackendService`; logic batch 5. Wave 9: one OBP crate (`openbitfun-obp`) for the desktop, the CLI host and the phone; the CLI host serves OBP over Link with registry-derived handlers and capabilities; bot menu commands use the `mesh_route` port like bot turns | Poll paths, duplicate CLI handlers (the desktop's Tauri crate dependency is gone since the wave 4 sunset), the phone's copy of the OBP client |

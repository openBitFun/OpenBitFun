# Unified client architecture: one UI, one protocol, display-only frontend

Status: adopted (2026-11). The native NSH app is the desktop client; the Tauri desktop shell and the React
desktop UI were retired (Tauri sunset, below). This document owns the target shape; the Status table at the end
lists what remains.

## Product model

OpenBitFun is a distributed Agent runtime with one display-and-control surface.

| Node | Runs | Where |
|---|---|---|
| Runtime node | An Agent runtime (backend) and the UI | The native desktop (`src/apps/desktop-nsh` over `src/apps/desktop`) and the CLI host (`src/apps/cli`) |
| Frontend-only client | The UI only | A browser (`https://super.openbitfun.com/`), the NSH phone app (`src/apps/mobile-nsh`), IM bots |
| Cloud node | The account's superagent: a model loop and management tools, no Agent runtime | `openbitfun-superagent` (`src/apps/relay-server/superagent`), shown as "OpenBitFun" |

- Any frontend displays and operates any runtime of the account through one fleet entry (below). Which device
  executes a session is a backend fact shown as a label ("on <device>", a device badge), never a mode the user
  switches into.
- Runtime nodes are symmetric peers: any desktop or CLI host can be the entry; there is no home device.
- The cloud superagent is the main entry of the UI (the OpenBitFun conversation). It is on by default, and full
  access is the default: jobs it dispatches auto-approve, and per-device switches fence a device off or turn
  auto-approval off.
- The OpenBitFun server is reachable only through its domain over HTTPS.

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
feature `client` for controllers (the desktop's Peer Device Mode, Detached Dispatch and IM bots, the phone app),
feature `fleet` for the fleet layer every runtime host runs (below).
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
| Browser gateway (`wss://<domain>/obp/<deviceId>`) | A browser anywhere (the web controller) | A byte pipe into the account's Link network; the browser and the device run the `obp-e2e-v1` end-to-end channel inside it (X25519 device keys, AES-256-GCM), so the gateway sees ciphertext |
| Cloud node endpoint (`wss://super.openbitfun.com/agent/obp`) | Runtime hosts reaching the account's cloud superagent | The `obp-e2e-v1` channel inside a WebSocket to the server's loopback service; the server front end and nginx see ciphertext |
| Device mesh (OpenBitFun Link, an EasyTier fork in-process) | Another runtime host of the same account, anywhere (same network included) | TLS WebSocket to the device's mesh virtual IP; P2P (LAN, IPv4, IPv6) with relay fallback through another account device or the server; `account-device` handshake with the device X25519 keys, or a `paired-client` QR credential for a phone browser (wave 4, below). The only multi-device transport of the new version (wave 6) |

The backend serves the UI bundle (NSH web target) on its listener, so a browser or phone opening the backend
URL gets the same UI that then connects to `/obp`.

### Scopes and controller-local commands

Each connection is bound to a scope: `owner` (in-process, or loopback with a per-launch token and Origin check),
`account-device` (same-account device key handshake), `cloud-agent` (the same handshake from the account's cloud
node: the `account-device` allowlist plus the model relay, under the device's superagent switches),
`paired-client` (revocable QR credential) or `observer` (read-only). The Product Operation Registry (`remote_surface/table.rs`) decides per command: `Proxied` runs for any
authorized scope; `ControllerLocal` / `OperatorOnly` run only for `owner`. The registry gains an event stance so
account, window and updater events never leave the owner scope.

A client that has a local backend (the native desktop) routes `ControllerLocal` commands to its own backend and
everything else through the fleet to the device that owns it (`fleet_call`, below). A phone or browser has no local backend, so
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

### Device mesh: OBP between account devices over OpenBitFun Link (wave 4, Link core wave 7)

The devices of one account connect through **OpenBitFun Link**, an EasyTier v2.7.1 fork
(`third_party/easytier`, LGPL-3.0, changes in its `OPENBITFUN-PATCH.md`) that every end embeds, instead of
the old relay transport. The account's device directory (names, X25519 public keys, the cloud node's row) is
OpenBitFun 2.0's own directory, `https://super.openbitfun.com/directory` (a relay-service instance with its own
database, `openbitfun-directory`, `deploy/super`); it carries no Link traffic. Wave 4 ran the official EasyTier
binaries as a sidecar; wave 7 replaced them.

- **One service host for 2.0.** Every 2.0 component (desktop, CLI, phone, web UI, gateway, issuer, cloud agent)
  uses only `super.openbitfun.com`: `/` the web UI, `/b/` and `/cas/` its device bundles, `/obp/` the browser
  gateway, `/mesh/et/` the Link relay node, `/mesh/v1/*` the issuer, `/agent/` the cloud agent and `/directory/`
  the account directory (`DEFAULT_ACCOUNT_DIRECTORY_URL`, override `OPENBITFUN_ACCOUNT_DIRECTORY_URL`). Hosts sign
  in to the directory from the account identity alone (`remote_connect::directory_session`) and keep that
  session in the profile's credential vault (under `OPENBITFUN_USER_ROOT` for a profile with its own user root),
  reusing its token across starts until it is 15 days old and revoking a token they replace; the first session of
  an account also asks the cloud agent to create the account's node (`/agent/api/v1/ensure`, as does a browser's
  first sign-in at the gateway). `remote.openbitfun.com` (the 1.0 relay and its pages) serves released 1.0 clients
  only; no 2.0 component uses it, and 2.0 is compatible with 1.0 for session records and configuration only.

- **In-process node** (`openbitfun-link`, services layer). The desktop backend and the CLI host (wave 9) run
  the fork on its own Tokio runtime: no TUN, no root, no child process, no SOCKS5 or other proxy port. DHCP
  virtual IP, hostname = account device id, direct listeners on `0.0.0.0` and `[::]` (TCP+UDP, IPv6 on), UDP
  and TCP hole punching, UPnP, LAN direct, relaying through another account device, and the relay node as the
  fallback. `Link` (`session.rs`) follows the account: joins on sign-in, leaves on sign-out and quit, restarts
  a stopped node with backoff. Hosts get tokio `AsyncRead + AsyncWrite` streams: `Link::accept()` (inbound
  streams on the OBP port) and `connect(device_id, port)` (outbound, through the fork's userspace stack).
- **Credentials and join tokens.** `POST https://super.openbitfun.com/mesh/v1/credentials`
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
  `easytier-js`). `https://super.openbitfun.com/` serves the NSH web bundle with `#nsh-params` `{controller: {api,
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

### Fleet: every runtime of the account in one surface

Every desktop and CLI host runs the same fleet layer (`openbitfun-obp` feature `fleet`, `src/crates/adapters/obp/src/fleet`;
contract and pure policy in `openbitfun_product_domains::fleet`). A frontend connects to one runtime host, the
**entry**, and through it sees and operates every runtime of the account. All runtime hosts are equal peers:
any of them can be the entry, there is no home device, and the user never picks one.

- **Placement.** Desktop: `src/apps/desktop/src/fleet` (`DesktopFleetBackend`, links through
  `mesh::peer_link::global`). CLI: `src/apps/cli/src/fleet_host.rs` (dials over its own Link node with
  `LinkPeerConnector`). Both start the fleet with the mesh listener, before the first hello, so `hello` and
  `/obp/mesh/info` advertise `fleet_v1`; without a running fleet every fleet verb answers `fleet_unavailable: ...`.
  The shared glue is `fleet::host::FleetHost`; hosts provide a `FleetBackend` (local digest and dispatcher) and a
  `FleetPeerTransport`.
- **Owner partitions.** The index (`fleet/index.rs`) holds one single-writer partition per device, keyed by the
  owner's `(instanceId, revision)`. A partition comes only from its owner (no gossip, no merge, no CRDT), so
  same-named ids on two devices stay distinct: the global key is `(deviceId, entityId)`. The owner side is
  `openbitfun_core::service::fleet::digest` (`fleet_digest {sinceRevision, instanceId}` answers a delta inside
  the tombstone window, otherwise a full snapshot; changes coalesce for 300 ms into `fleet://digest-changed
  {revision}`). Only summaries are replicated: workspaces (opened and recent, at most 250), sessions (the newest
  50 top-level per workspace plus every running, waiting or unread one, at most 500 per device), pending prompts
  (at most 256, payloads over 16 KiB marked `payloadTruncated`, Detached Dispatch prompts with `answerRoute:
  "dispatch"`), at most 1 MiB per partition and 32 indexed devices. Transcripts, files, terminal output, config
  and credentials are never replicated; they are read from the owner on demand. The index is cached at
  `<data>/fleet/index.json`, read per device record, and an unreadable file is kept aside, never deleted. An
  unreachable owner keeps its partition, marked with its state and `asOfMs`.
- **Replication** (`fleet/sync.rs`). The entry keeps an index-only link to every reachable peer (hello `events:
  {prefixes: ["fleet://"]}`; a peer that ignores the filter is filtered locally). A `fleet_v1` peer is pulled on
  connect, on every digest hint and on an instance change, with a full snapshot every 5 minutes (anti-entropy).
  A device-network host without `fleet_v1` is a leaf owner, indexed by polling its navigator, first sessions
  page and pending permissions (on events and every 60 s); a relay-only host is never dialed and shows
  `update_required`.
- **Device states.** Decided by the backend with a reason: `online`, `offline`, `stale`, `unreachable`,
  `update_required`, `not_indexed`.
- **Commands: routing by owner.** A frontend sends every product command as `fleet_call {target, command, args}`
  with the args unchanged. The entry runs it when it is the target and otherwise makes a plain `call` on its link
  to the target, which applies its own allowlist; the owner's results and errors come back unchanged. The
  per-command side table `remote_surface/fleet_routing.rs` says how the target is found: `ByOwner {entity, path}`
  (the id at `path` must belong to the target, otherwise `fleet_owner_mismatch: <owner>`, never a silent
  reroute; a missing target resolves to the owner when the index knows exactly one, otherwise
  `fleet_target_required`), `ByTarget` (device-scoped commands; the UI passes its device context), `EntryLocal`
  (controller-local and host-control-plane rows, native desktop only). Other refusals: `fleet_device_offline`,
  `fleet_device_outdated`, `fleet_nested_call` (a `fleet_*` verb wrapped in `fleet_call`).
- **Entry verbs** (`PeerStance::FleetEntry`, answered by the entry for the `owner`, `account-device` and
  `cloud-agent` scopes, never forwarded, refused for paired clients): `fleet_call`, `fleet_navigator
  {sinceRevision?}` (devices, workspaces, sessions, totals and per-device action gates, all ordered and counted
  by the backend), `fleet_prompts`, `fleet_attention` / `fleet_attention_mark_read` (the Inbox: every device's
  prompts, the cloud agent's blocked, done and failed jobs, and failed sessions; read state per entry;
  `fleet://attention-changed`), `fleet_recent_sessions {limit?, cursor?}` (a flat recent list: every runtime
  device's top-level sessions newest first, with device and workspace labels, paged by an opaque cursor over the
  index window), `fleet_device_detail {deviceId}` (a device's details, which the UI reads for the update a stale device needs: the navigator row, user and dispatch sessions
  running now, jobs waiting to start or waiting on the user from the device's dispatch sessions and prompts and the
  cloud agent's queued jobs, capability ids, and the update line of an `update_required` device),
  `fleet_models {deviceId?}` (the account-wide model catalog, below), `fleet_subscribe {follow}`, `fleet_events`
  (the native desktop's long poll for peer origins) and `fleet_ui_bundle`. Owner verbs on the device network:
  `fleet_digest`, `fleet_replay`.
- **Account-wide model catalog** (`product_domains::fleet::models`, `openbitfun_core::service::fleet::models`).
  Every runtime device publishes its configured chat models in its digest (`models`: id, display name,
  provider, capabilities, context window, which one is its primary; never endpoints or keys); a digest from an
  older build has none, and its device shows `device_requires_update` in the picker. `fleet_models` groups the
  catalog by device relative to the device that runs the session (that device first, then online devices),
  with each device's state and `unavailableReason` (`device_offline`, `device_requires_update`, `no_model`), so
  the session model picker only draws it. Picking another device's model stores `fleet:<deviceId>/<modelId>`
  (a plain id, every selection stored before the catalog, stays this device's model). The runtime host mirrors
  every other device's published models as runtime model entries (provider `fleet_relay`, no credentials,
  never persisted), so the session resolves like any configured model and each round runs through the owner's
  model relay over Link (`account-device` scope). Credentials never leave the owner, and the owner never relays
  a round onwards. A round whose owner is offline fails at once, not retried, with "{model} lives on {device},
  which is offline"; a stored reference this host cannot resolve fails the turn instead of running the
  primary model. Publishing the catalog is the negotiation: a device with a catalog runs a build whose relay
  admits other devices.
- **Events: per-origin cursors** (`fleet/mux.rs`). A client that sends `fleet: {protocol: 1, cursor: {[deviceId]:
  {instanceId, seq}}}` on its hello gets one stream of frames `{seq, event, payload, origin, originInstance}`,
  where `seq` is the origin's own and the payload is unchanged. Order holds within an origin only. The entry keeps
  4,096 events / 16 MiB per origin; an older cursor is replayed from the owner (`fleet_replay`), and when that
  history is gone or the owner restarted the client gets `backend://events-dropped {origin, reason, resumeSeq}`
  and re-hydrates that origin alone. A full upstream stream is kept only for devices a client follows
  (`fleet_subscribe`); every other link stays index-only. A slow client is skipped forward for the lagging origin
  only. A hello without `fleet` (an older client) gets unchanged frames.
- **Entry selection and failover.** The native desktop enters through its own backend. The browser (gateway
  `entryCandidates`) and the phone (`rank_entry_candidates` in its native module) use one ranking: online, then
  `fleet_v1`, then a desktop, then lowest latency, then fewest attached clients (`fleetLoad` on
  `/obp/mesh/info`), then newest version; the account's cloud node comes last. `src/nsh-ui/src/controller/fleetEntry.ts`
  walks the list: on loss, calls in flight fail with `entry_lost` (mutations are not retried; reads are), and the
  next entry gets the same vector cursor. The user is told only when every candidate fails. Losing the entry or
  the client never cancels a turn: it belongs to its owner's runtime.
- **Device context.** The UI's device context is the device of the selected workspace; device-scoped surfaces
  (settings, models, MCP, skills, agents, routines, usage, files, Git, terminals) follow it and say which device
  they show. The native folder picker exists only for the client's own machine; other devices use the in-app
  browser over `fleet_call get_directory_children`. An SSH workspace belongs to the device holding the SSH
  profile; two devices on one SSH root are two rows.
- **Account replica (wave 21).** Account-level data that follows the user, starting with synced settings, is
  held by the runtime devices themselves, never by a server: `fleet/replica.rs` keeps records with
  hybrid-logical-clock revisions (last writer wins per record), tombstones kept 30 days and content-addressed
  blobs, size-capped, in `<user data>/fleet/replica-<account>.json`. Peers exchange it through the owner verbs
  `fleet_replica_digest` / `fleet_replica_pull` / `fleet_replica_push` / `fleet_blob_get`
  (`account_replica_v1`): local writes are pushed to every online peer at once, digests are compared every
  minute and whenever a peer comes online, and writes made offline stay undelivered until a peer acknowledges
  them. Settings sync binds it to the config (`services-integrations` `remote_connect::settings_sync`, see
  [peer-device-mode.md](peer-device-mode.md)). Phones and browsers read and write through their entry.
- **Account records (wave 24).** The rest of the account's data rides the same replica, one collection per
  kind with its own budget (`product_domains::fleet::account_records::ACCOUNT_COLLECTIONS`, declared by every
  runtime device when it opens the replica): quick actions, user custom agents and agent profiles, user skills
  (files as blobs), routine definitions (each names the one device that runs it), MCP server shapes, SSH
  profiles, the consolidated memory document, assistant persona documents, desktop card definitions, imported
  pets and the pet choice, and IM bot binding metadata. The binder
  (`services-integrations` `remote_connect::account_records`) follows the settings pattern: each owner lists
  its items as replica-safe projections and applies account items through its own typed mutation, a device's
  first sync offers only its non-default items at the lowest clock, the 1.x files are read in place and never
  rewritten by the offer, and the account sync switch covers it. Records never carry a secret: the replica
  refuses secret-named fields, non-placeholder `env`/`headers` values and credential-shaped strings on write
  and on merge (`find_secret`), and every binding replaces secrets with per-device placeholders
  (`{"$secretRef": …}`) that the device needing them fills locally (`device_records_overview` tells the UI
  which MCP servers, SSH profiles and skill markets still need one here, and which routines run elsewhere).
  Device-bound items (command cards, another device's routines) are listed but materialized only on their
  device; prose (personas, memory) keeps a conflict copy when a concurrent edit replaces local content.
- **Compatibility.** An entry without `fleet` on its hello leaves the UI on that one backend (with an "update
  this device" notice) and its legacy Peer Device Mode ([peer-device-mode.md](peer-device-mode.md)). Fleet DTOs
  read tolerantly: every field defaults, unknown fields are ignored, every enum has an `Unknown` variant.

### The cloud superagent node

Each account has one cloud node, the OpenBitFun superagent (`openbitfun-superagent`,
`src/apps/relay-server/superagent`; contract and pure policy in `openbitfun_product_domains::superagent`;
deployment in `deploy/superagent/README.md`). It is the main entry of the UI: one input box, a model, and the
management tools. There is no fixed workflow; the model chooses devices, fans out and compares results through
the tools.

- **Place in the fleet.** `hostKind: "cloud"`, device id `cloud-<hash(account)>`, display name "OpenBitFun", its
  own X25519 key in the 2.0 account directory under the server-only kind `cloud_agent`
  (`relay-service/src/routes/cloud_agent.rs`, enabled on `openbitfun-directory` with a 0600 key file; client
  logins can never write that kind). The node is created on the account's first sign-in (`/agent/api/v1/ensure`). It is a fleet owner
  (`fleet_digest` / `fleet_replay`: one assistant workspace whose sessions are its conversations) and serves the
  `superagent_*` commands. It is not on the device network: entries reach it at `wss://super.openbitfun.com/agent/obp` with
  the `obp-e2e-v1` end-to-end channel (`openbitfun_obp::client::cloud`, `WithCloudNode` routes `cloud-*` ids
  there). Frontends call it as `fleet_call {target: "cloud-…", command: "superagent_…"}`. The browser's entry
  ranking always lists it last, so it is the entry when no runtime host answers; it answers the hello without
  the fleet layer, so the conversation works but no device index is shown.
- **Reaching devices.** It joins an account's Link network as its own member (minted from the issuer key) only
  while a job is live or a turn is unfinished. A device that sees the `cloud_agent` row grants the `cloud-agent`
  scope: the `account-device` allowlist plus the model relay, under the device's switches
  `superagent.acceptDispatch` (fence the device off; only probe, status, list, cancel, the owner verbs and the
  relay stay open) and `superagent.allowAutoApproval` (refuse `approvalPolicy: auto` and prompt answers). Both
  default on. Devices advertise `cloud_agent_scope_v1`; a device without it is never dialed
  (`superagent_requires_update`).
- **Model rounds without server credentials.** `fleet_model_start` / `fleet_model_poll` / `fleet_model_cancel`
  (`fleet_model_v1`; the `cloud-agent` and `account-device` scopes, never a paired client) run one completion on
  a device with the provider configured there (`openbitfun_core::service::superagent_relay`); no tool runs on
  the device for it, polling resumes by sequence, and usage is recorded there as "OpenBitFun agent". A
  conversation runs on **Auto** (the backend ranks the holder: the last one, then desktop over CLI, then
  latency, and the holder runs its primary model) or on the device and model the user picked
  (`Conversation.pinnedHolder` + `modelId`, persisted in the encrypted store; `superagent_set_model`, or `model`
  on `superagent_send` for a new conversation). A lost Auto holder's round retries elsewhere; a pick never moves
  to another device. With no holder the turn ends at once with a `no_holder` card that names the offline
  devices, the ones without a model and the ones that need an update, and says what to do; it never parks on
  model availability (a turn parked by an earlier build resumes into that answer). Queued jobs for offline
  devices are unaffected. `superagent_status.models` is the picker (devices with their catalogs) and
  `superagent_get_conversation` carries the conversation's `model`.
- **Work through Detached Dispatch.** Tools: `fleet_list_runtimes`, `fleet_dispatch`, `fleet_wait`,
  `fleet_job_status`, `fleet_job_result`, `fleet_job_transcript`, `fleet_job_message`, `fleet_job_cancel`,
  `fleet_job_answer`, `fleet_publish_branch` (closed set, strict parsing). Jobs default to `approval: auto`
  (full access); the agent may answer a job's permission prompt (`answeredBy: superagent` on the card). Target
  capabilities it negotiates are in [detached-task-dispatch.md](detached-task-dispatch.md#cloud-controller-and-superagent-target-capabilities).
- **Commands and events for frontends.** `superagent_status`, `_enable`, `_disable`, `_list_conversations`,
  `_get_conversation`, `_rename_conversation`, `_delete_conversation`, `_send {conversationId?, message,
  clientMessageId}` (idempotent), `_cancel_turn`, `_job_action`, `_delete_data`; events
  `superagent://turn-delta`, `superagent://card-changed`. Job cards, their states, reasons and allowed actions are
  projected by the node. On by default: an account's node is created on first use; turning it off and deleting
  its data are each one step.
- **Runtime shape.** A control-plane node, not an Agent Runtime deployment
  ([agent-runtime-deployment-design.md](agent-runtime-deployment-design.md#10-cloud-superagent-control-plane-node)).

### Dispatch, bots, phones and Peer Device Mode over the mesh

OpenBitFun 2.0 devices talk to each other only over OBP on Link. The 1.x relay transport
(`account_device_rpc`, relay `rpc-call`, `machine-event`, `HostStream`, HostInvoke, pairing invitations) is not
part of 2.0: its commands are `retired(...)` registry rows (`RELAY_TRANSPORT_RETIRED`,
`RELAY_HOST_INVOKE_RETIRED`), and nothing in 2.0 falls back to it. A device that is not on Link (offline, or an
OpenBitFun 1.x device) gets an explicit refusal, never a silent fallback.

- **Peer Device Mode** ([peer-device-mode.md](peer-device-mode.md#obp-over-the-device-mesh-new-hosts)), the
  path for a backend without the fleet layer; on a fleet entry the device context replaces it. A device in the
  account mesh whose listener advertises `obp_v1` + `mesh_v1` is driven over OBP: the controller's backend holds
  the authenticated link (`mesh/peer_link.rs`; `peer_link_connect`, `peer_link_call`, `peer_link_events` long poll
  with the peer's own `seq` and resume, `peer_link_disconnect`, all `ControllerLocal`), and the NSH bridge makes
  it the surface's data backend: registry `ControllerLocal` commands and owner-only events stay local, everything
  else is the peer's, unchanged and live. Chosen over a UI-side socket because the device handshake key stays in
  the backend; the extra hop is in-process. The hello adds `hostCapabilities` (the registry's peer-host list) for
  feature gates and `hostKind` (`desktop`, `cli`, `cloud`; additive, display only). HTML preview of a peer's
  workspace reads `html_preview_read_resource` over the same kind of link (`workspace_html_preview_v1` in
  `hostCapabilities`).
- **Detached Dispatch and IM bots.** The `account-device` scope also runs `dispatch_target_*` and
  `obp_remote_command` (a bot `RemoteCommand`), advertised as `dispatch_target_v1` / `remote_command_v1`.
  Controllers go through `remote_connect::mesh_route::call_mesh` (desktop route `mesh/route.rs`, CLI route
  `src/apps/cli/src/mesh_route.rs`): a mesh device with the capability gets OBP; anything else answers
  `device_not_on_link: …`. Both bot lanes use it: turns (`RemoteBotTarget`) and the command router's menu
  commands (sessions, assistants, models; `exec_remote_rpc`), on a desktop and on the CLI daemon alike.
- **Phones and browsers.** Phones join Link in the OpenBitFun app (native data plane through FFI, signed in
  with the account, `src/apps/mobile-nsh`); browsers reach devices through the gateway (above). Both run the
  same controller shell over the `ControllerPort` interface (`src/nsh-ui/src/controller/controllerPort.ts`:
  `requestCode`, `verifyCode`, `signOut`, `listDevices`, `connect`), web and native implementations. The
  wave-4 path through the official EasyTier app is retired with `mesh_phone_join_info` (network credentials are
  never shown); Devices › "Use on phone or in a browser" shows the web controller's address and its QR only. The mesh listener keeps serving the UI bundle and the `paired-client` routes to requests
  without the device handshake (own cookie, the one pairing store and revocation) for clients on Link.
  `mobile-web` (the 1.x phone web UI) and the relay pairing were removed from the 2.0 tree.

| Client | Same network or anywhere |
|---|---|
| Phone (Android, iOS) | The NSH phone app (`src/apps/mobile-nsh`) joins Link as a controller with the email-code sign-in and enters the fleet through the best-ranked runtime host; the OpenBitFun-Mobile apps are 1.x clients and do not reach 2.0 hosts |
| A browser anywhere (phone or computer) | `https://super.openbitfun.com/`: email sign-in, then the device's own web UI over the gateway with the end-to-end channel, entering the fleet through the best-ranked runtime host; on this computer, the loopback owner link |
| The native desktop | Its own backend is its fleet entry; every other device of the account appears in the same surface (legacy Peer Device Mode only toward a backend without the fleet layer) |
| A CLI host (`openbitfun`, the daemon) | A runtime node: joins Link while it serves this machine's device identity, OBP on its port like a desktop, fleet owner and entry (below) |
| OpenBitFun 1.x host or client | Not supported by 2.0: 1.x clients keep using the 1.x relay against 1.x hosts only |

### CLI host as a runtime node

The CLI process that serves this machine's device identity (the daemon, or an interactive `openbitfun` when no
daemon runs; a desktop app on the same machine is the primary host and wins) joins the account's Link network as
a device and serves OBP on its port (`src/apps/cli/src/obp_host.rs` over `openbitfun-obp`), so every frontend
drives it like a desktop host, with the same protocol. It is a full runtime node: it runs the fleet layer
(`fleet_host.rs`) as an owner (its digest and replay for the other hosts) and as an entry (a phone or browser
connected to it sees and drives every device of the account), serves its own embedded web UI bundle, relays model
rounds for the cloud agent (`fleet_model_*`), and is the durable Detached Dispatch target.

- **When.** Signed in, remote control on (the machine-wide switch shared with the desktop app, `openbitfun
  remote-control [status|on|off]`; on by default), and this process serves the machine's device identity: it
  holds the secondary device routing claim (`routing_lease::DeviceRoutingLease`, an OS lock next to
  `device_identity.json`) while no desktop holds the primary one (a signed-in desktop with remote control on). Link re-checks on routing changes and every 15 s; `OPENBITFUN_MESH=off`
  turns it off. State lives in `<user data>/cli-host/` (`mesh/` credential cache, `obp/` TLS identity and
  pairings, `remote-control.json` status without secrets). No loopback listener (the terminal is the CLI's UI).
- **Calls.** `account-device` connections run the Peer Device host's registry-derived handlers
  (`peer_host::handle_obp_call`: the registry verdict for `PeerHostKind::Cli`, arguments and results in the
  canonical agent-identity dialect like every OBP host). A command the CLI does not run answers with the
  registry's refusal (`command 'x' is not supported on CLI peer host: …`, typed `data.kind = "unsupported"`);
  the retired relay control plane (`peer_mode_ping`, attach, detach) is gone. Host verbs:
  `dispatch_target_*` (the durable CLI runner) and `obp_remote_command` (bots), advertised as
  `dispatch_target_v1` / `remote_command_v1`.
- **Capabilities and events.** The `hello` carries `hostKind: "cli"` and the registry's CLI capability set in
  `hostCapabilities`, so the UI hides what the CLI does not serve. Events are the Peer Device host's fan-out
  (agentic events with their session cursors, permission requests, catalog, file watch, settings), published to
  the host's own ring in the canonical dialect (terminal output included).
- **Bots.** The CLI installs its own `mesh_route` while it serves Link, so an IM bot hosted by the CLI daemon
  reaches other devices through the fleet over Link, like a desktop-hosted bot. The CLI opens no relay socket.

### Phone app: the NSH UI as a Link controller

The phone app (`src/apps/mobile-nsh`, iOS and Android) is the same NSH UI built with a native module of its own,
`openbitfun/mobile` (crate `openbitfun-mobile-native`). It has no backend: the UI's controller port
(`src/nsh-ui/src/controller/controllerPort.ts`, shared with the browser controller) is implemented natively
(`src/apps/mobile-nsh/src/nativeController.ts`), and the chosen device's backend becomes the UI's connection.

- **Sign-in.** The email code goes through the account APIs every device uses: a device sign-in transaction of
  the identity service (`/auth/desktop/start?methods=all`) whose ticket takes the code (`/auth/email/send`,
  `/auth/email/verify`), then `/auth/desktop/poll` returns this phone's token pair. The phone registers its own
  X25519 public key in the account directory (`/directory/api/auth/login`, kind `mobile`); desktops derive the pair
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
- **Fleet entry.** The native module ranks the runtime hosts (`rank_entry_candidates`, the gateway's ranking),
  and `controller/fleetEntry.ts` walks them with the vector cursor (above).
- **Connections.** OBP over a Link stream with the account-device handshake (the shared client,
  `openbitfun_obp::client`, the code the desktop's `ws/mesh_client.rs` re-exports): `account-device` scope, `Proxied` commands only, owner-only
  events withheld, credit/ack backpressure. A dropped connection redials on the next call and resumes after the
  last event the UI took (`lastSeq` + `instanceId`); a restarted backend answers `events-dropped` and the UI
  re-reads. The connection is the same JSON wire as the in-process desktop backend (`jsonWireConnection.ts`).
- **Packaging.** `pnpm run mobile-nsh:package:{ios-sim,ios,android}` (`scripts/package-mobile-nsh.mjs`, NSH
  `nsh package`); the module and Link build for `aarch64-apple-ios(-sim)` in NSH's generated workspace (libc is
  pinned to 0.2.189 there: 0.2.191 limits `RTAX_MAX` to macOS, which breaks EasyTier's `netdev` on iOS).

### Browsers load the web UI from the device

A browser runs the exact web UI bundle of the device it controls, never a server-picked version: the launcher
(`https://super.openbitfun.com/`) signs in, gets the device's manifest over the end-to-end channel, and a Service Worker
runs the device's bundle from a content-addressed pool on the server, verifying every byte against that manifest.

- **Launcher and loader** (`src/nsh-ui/web/ui-loader.js`, `host.js`). After sign-in the launcher opens the newest
  connectable device by itself (`pickUiSourceDevice`, the next one on failure) and calls `ui_bundle_manifest`. When
  the bundleId is the launcher's own it drives the device in place; otherwise it stores `{bundleId, manifest,
  deviceId}` and navigates to `/b/<bundleId>/index.html#device=<deviceId>`, where the Service Worker (scope
  `/b/`) serves each file from Cache Storage or from `/cas/<sha256>?device=<deviceId>` after checking its
  SHA-256 against the manifest (the `.br` variant is decoded, then checked). A mismatch or failure is an error page
  naming the file; nothing unverified runs. The handoff is sessionStorage `obf.controller.handoff.v1` `{v: 1,
  deviceId, at}`, a frozen contract (fields are only added). A device without a bundle, or too old to answer, gets
  "update OpenBitFun on this device".
- **Pool** (`openbitfun-link-gateway`, `src/apps/relay-server/link-gateway/src/pool.rs`, deployment in
  `deploy/easytier/README.md`). Untrusted and content-addressed: one copy per hash for every account and device,
  pulled through on a miss from the requesting device over Link (`GET /obp-ui/v1/<sha256>`), then from the other
  holders named in `&holders=`, hashed before it is stored; files unused for 30 days are deleted. The entry verb
  `fleet_ui_bundle` names the newest usable bundle among online fleet hosts (manifest `minEntryFleetProtocol` at
  most the entry's protocol) with every holder of it.

Device side:

- **Manifest.** Every web package (`pnpm run desktop-nsh:web`, the desktop packages' `nsh-web`, the CLI's embedded
  copy, the web controller build) carries `ui-bundle.json`, schema 1: `{schema, product, version, nsh, entry,
  files: [{path, sha256, size, br?: {sha256, size}}]}`, written by `scripts/write-ui-bundle-manifest.mjs` over the
  untouched `nsh package` output (the device injects `#nsh-params` only when it serves `/`). `files` lists every
  runtime file except `.br`/`.gz` siblings, sorted by path; paths are POSIX and relative, with no `.`/`..`/empty
  segments, backslash, colon or control character. The **bundleId** is the lowercase hex SHA-256 of the canonical
  manifest (keys sorted by UTF-16 code units, no whitespace, `JSON.stringify` string escapes, safe integers
  only), recomputed by every party. The JavaScript writer and the Rust reader (`openbitfun_obp::ui_bundle`) are
  checked against one fixture (`src/crates/adapters/obp/src/ui_bundle_fixture.json`).
- **`ui_bundle_manifest`** (`request: {}`) answers `{manifest, bundleId}` with the manifest exactly as shipped, or
  `ui_bundle_unavailable: <reason>` (no bundle, no manifest, a file that no longer matches). Registry row:
  `Agnostic` (public build output, the same for any workspace), `Proxied` (it must answer on the device, under
  `account-device`), CLI `HANDLED`. Loading checks every listed file; a directory bundle is reloaded when its
  manifest changes. A device older than this answers `-32003 forbidden_for_scope: ... unknown to this OpenBitFun
  backend version`; both cases mean "update OpenBitFun on this device". `hello` adds `uiBundleId` as a hint
  (additive; never trusted over the manifest).
- **Fetch by hash.** The mesh listener tells three openings apart by a stream's first byte: 0x16 TLS, `O` the
  end-to-end channel, `G` a plain `GET /obp-ui/v1/<sha256> HTTP/1.1` from the server pool over Link. It answers
  `200` (`application/octet-stream`, `Content-Length`, `Content-Encoding: br` exactly when it served a `.br`
  sibling) with bytes re-checked against the hash on every read, `404` for any hash not in the current manifest
  (also when the device ships none), `400`/`405`/`431` for malformed requests and `503` when its 8 fetch slots
  stay busy for 10 s; one request per stream, then close. It serves only listed bundle files (public code, no
  user data) and only account network members reach it.
- **The CLI's bundle** is compiled into the executable (`src/apps/cli/build.rs` from `OPENBITFUN_CLI_WEB_UI_DIR`,
  which `pnpm run cli:build` and the installers build from the same tree), so it cannot drift from the binary
  through self-update, `cargo install` or a copied executable; a build without it answers
  `ui_bundle_unavailable`. The desktop's is `Resources/nsh-web` (or `nsh-web/` next to the executable).

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
- **Compatibility.** The cloud relay invitation and `remote_connect` `openbitfun_server` were retired in 2.0 as
  well (`remote_connect_start` answers `RELAY_METHOD_RETIRED`). Phones paired on the LAN listener
  keep their credential record in `<data>/obp/paired-clients.json` and the same certificate
  (`lan-identity.json`), but must join the mesh and pair again (the browser cookie was per listener). The
  retired `<data>/obp/settings.json` (`lanEnabled`, `lanPort`) is no longer read and is left on disk untouched.
- **Domain-only server.** The OpenBitFun server opens no port of its own: it is reached only through its domain
  over HTTPS, and the hosting provider's front end forwards that traffic to nginx. The relay node listens on
  `ws://127.0.0.1:11011/` only and is reached as `wss://super.openbitfun.com/mesh/et/` (the issuer hands out
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
| `browser_webview_capture_preview` | Adapter, `Proxied` (wave 22): `{label?, conversationId?}` picks the page (the conversation's newest, else the device's newest) and answers a script-free copy of its document made in the page through `browser.evaluate` (`status: "snapshot"`, or `noPage`, `tooLarge` over 1 MiB, `unsupported` when the window offers no browser). Phones, browsers and other desktops draw it as a read-only live view. NSH 0.6 has no web view pixel snapshot, so agent `Page.captureScreenshot` still fails with that reason |
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
| `mobile-web` (removed in 2.0) | The same NSH UI served by the backend |
| Embedded LAN relay, LAN OBP listener | The device mesh (it picks the direct LAN path for devices on one network) |
| Duplicated CLI peer handlers | One generated dispatch shared by Desktop and CLI hosts |

## Upgrade compatibility

OpenBitFun 2.0 is compatible with 1.0 for session records and config only: persisted sessions, transcripts,
workspace records, the account credential record (`relay_url` kept as the directory URL field) and settings
files written by 1.x still read. Frontends, remote control, peers and accounts do not interoperate with 1.x:
`remote.openbitfun.com` and its relay serve the released 1.x clients only. Between 2.0 builds everything is
negotiated: clients probe for OBP (`obp_v1` + `mesh_v1` on the device's mesh listener; `dispatch_target_v1` and
`remote_command_v1` for dispatch and bots), the fleet entry advertises `fleet_v1` and answers `fleet` on the hello,
a peer without `fleet_v1` is indexed by polling, and the cloud node is dialed only on devices advertising
`cloud_agent_scope_v1`; an older 2.0 client that sends no `fleet` gets unchanged frames. The retired relay
commands keep `retired(...)` rows so a caller gets the reason instead of an unknown-command error. Every change
ships old-peer/new-peer round-trip tests in both directions.

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

Tool results on demand. The UI reads history with `tool_detail: "summary"`: settled turns then carry a preview of each tool result and `detailOmitted` on every call that lost content, so opening a long session does not ship, parse and hold megabytes of output nobody opened. Opening a card reads its one turn whole (`before_turn_index: turnIndex + 1, limit: 1`, no `tool_detail`; `src/nsh-ui/src/toolDetailStore.ts`). The field is additive in both directions: without it, and from a host that does not know it, results are whole. Generative UI, MCP, plan and running calls, and inputs (a diff's line counts) are never shortened.

Running turn and live channel (wave 5). `get_session_transcript_view` also answers `runningTurn` (Routed row unchanged; additive field): the runtime journal's projection of the turn running now, as the same `agentic://*` events the live wire carries plus the delivery cursor they reached. A client that connects or reopens a session mid-turn replays them through its own live handlers and drops live events at or below that cursor, so no client-side snapshot of a running turn is needed. Decision on the typed live-delta stream (`transcript://delta`): not built. The `agentic://*` events stay the live channel because they are already the typed, journaled, cursor-carrying stream (the journal behind `load_session_event_backfill` and `runningTurn` is built from them), and the per-frame smoothness rests on them: the host coalesces text chunks, the client merges once per frame (`textChunkCoalescer.ts`, which now records the cursor span of every merged part) and reveals per round on its own signals. A second delta stream would duplicate that path, re-project every chunk into view items on the host, and double the bytes on the mesh for no change in what a client draws; the view keeps the durable record and the settle signal. Remaining: the backend-held peer scope belongs to the Peer Device Mode work; marketplace `installed` flags are still derived by the client.

## Status

| Area | Delivered | Remaining |
|---|---|---|
| Desktop | Native NSH host with the in-process `BackendService`, shell channel, native updater, MiniApp windows, macOS/Windows/Linux runners; Tauri shell and React UI retired | In-place update on Windows and Linux; non-macOS folder picker |
| Protocol and transport | One OBP crate (`openbitfun-obp`) for desktop, CLI, phone and cloud node; loopback owner listener; OpenBitFun Link device network with join tokens; browser gateway with the end-to-end channel; domain-only server | Retiring `mobile-web` and the relay transport once no supported peer needs them |
| Fleet | Symmetric fleet layer on desktop and CLI: owner partitions, `fleet_call` routing by owner, per-origin cursors, entry ranking and failover, Inbox (`fleet_attention`) | Retiring `peer_link_*` and legacy Peer Device Mode once no supported backend lacks `fleet_v1` |
| Cloud superagent | Cloud node service, encrypted per-account slots, model relay, Detached Dispatch tools, frontend commands; the target side of peer branch import, publish and the worker-question mailbox (`workspace_peer_import_v1`, `workspace_publish_v1`, `user_question_mailbox_v1`, see [detached-task-dispatch.md](detached-task-dispatch.md)) | Live verification of the Windows detached runner on a real Windows host |
| Browsers | The device's own web UI from the content-addressed pool | The browser does not yet load through `fleet_ui_bundle` holders |
| Bots and dispatch | Bot turns and menu commands over OBP (`mesh_route`); Detached Dispatch over OBP with the relay for older targets | IM bots hosted by the CLI daemon still reach other devices through the relay only |
| Display-only frontend | Logic batches 1-5 (table above) | Marketplace `installed` flags are still derived by the client |

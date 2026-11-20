# OpenBitFun Link

This crate owns the device network every OpenBitFun host embeds: the EasyTier
fork in `third_party/easytier` running in this process, joined by account
sign-in. Read `third_party/easytier/OPENBITFUN-PATCH.md` before changing how
the fork is used.

## Ownership

- `node`: one running node on the host's Tokio runtime (no threads, no TUN,
  no root, no proxy port); virtual TCP streams (`connect`, `bind`) through the
  fork's userspace stack; per-device route status (direct LAN / IPv4 / IPv6,
  relayed by the server or another device, latency, last seen).
- `session`: the account lifecycle hosts use (`Link`): credentials from the
  account issuer (cached 0600 per account), a short-lived join token refreshed
  before expiry, restart of a stopped node, the OBP listener's inbound streams.
- Roles (`NodeRole`, `LinkOptions::role`, `LinkNode::start_as`,
  `DeviceNodeConfig::render_as`): `device` serves OBP; `controller` (phone
  app, browser gateway member) only opens streams, admits none, relays no
  other device's data, and is advertised in its route info so devices list
  it as a controller (`MeshPeer::role`) and refuse to dial it. Nodes without
  the flag are devices. `NodeProfile::display_name` / `LinkOptions::display_name`
  advertises a member's name (a phone the account directory may not list);
  `MeshPeer::display_name` carries it.
- `gateway`: the server-side member for browsers (`LinkGateway::open` streams,
  `LinkGateway::peers` the account's online members with route and role, cheap
  enough to poll).
- `issuer`: `LinkOptions::tls_roots` picks the platform verifier or the
  bundled Mozilla roots (the default on Android, whose platform verifier needs
  Java-side setup).
- Logging: this crate logs through `log`; the fork logs through `tracing`.
  Hosts install their own subscribers (a phone app routes both to its system
  log); this crate never installs one.
- `relay`: the relay node's join gate (a peer of an account network is
  admitted only with an issuer-signed token for that network). The token
  format and signing live in `relay-service::link_token`.
- `credentials`, `handshake`: the issuer document and the account-device
  handshake proofs OBP uses on top of Link.
- Network secrets and join tokens are never logged, never written outside
  the credential cache, and never shown in a UI.

## Boundaries

- Do not depend on assembly, interface, adapter, or application crates.
- Hosts provide the account session (`AccountSession`); this crate never reads
  host account state itself.
- Keep fork changes small and documented in `OPENBITFUN-PATCH.md`; prefer an
  OpenBitFun module in the fork over edits spread through upstream code.

## Verification

`cargo test -p openbitfun-link` (unit tests, `switch_tests`: a stream kept
alive across forced relay <-> direct switches, plus `tests/relay_mesh.rs`:
in-process devices, the browser gateway and a controller over an in-process
gated relay). Live: `examples/link_probe.rs`
with credentials from `openbitfun-link-node issue` (see
`deploy/easytier/README.md`), and the ignored `mesh_e2e_*` / `peer_link_e2e_*`
tests in `src/apps/desktop`.

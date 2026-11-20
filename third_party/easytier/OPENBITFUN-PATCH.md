# EasyTier fork for OpenBitFun Link

Source: EasyTier v2.7.1, <https://github.com/EasyTier/EasyTier>, commit
`0d9c52b169dc2112687ddefcf571cd01d383193c` (tag `v2.7.1`). This copy keeps
the upstream LGPL-3.0 license (`LICENSE`). The modified source is published
in this repository, so anyone can change it and relink the programs that use
it (`THIRD_PARTY_NOTICES.md`).

OpenBitFun Link is the device network every OpenBitFun end embeds (desktop
backend, CLI host, relay node, and later the phone app and bots): the user
signs in with the OpenBitFun account and the host joins the account's
network in-process. No EasyTier product (binary, app, GUI, web console) is
used, and no network name or secret is ever shown or typed. The OpenBitFun
side lives in `src/crates/services/link` (`openbitfun-link`) and
`src/apps/relay-server/link-node`.

## What is vendored

Only the three library crates Link links:

- `easytier-proto`: protobuf types and RPC stubs.
- `easytier-core`: the OS-free control plane, peers, routing, hole punching,
  the smoltcp gateway and the data plane.
- `easytier` (library only): the native host runtime (sockets, listeners,
  WebSocket tunnels, UPnP, STUN).

`Cargo.toml` at this directory is the fork's own workspace (the upstream
manifests keep inheriting their dependency versions from it). The OpenBitFun
workspace excludes this directory, consumes `easytier`/`easytier-core` by
path, and resolves them in the repository's `Cargo.lock`.

Not vendored: `easytier-gui`, `easytier-web` (web console), `easytier-js`
(browser runtime), every `easytier-contrib/*` crate (FFI, iOS, Android JNI,
HarmonyOS, mini, uptime, Magisk), the `easytier-core`/`easytier-cli`
binaries, the Windows DLLs and images under `easytier/third_party` and
`easytier/assets`, benches, docs, and the upstream integration test suite
(`easytier/src/tests`, `easytier/tests`; it needs TUN devices and Linux
network namespaces).

## Build and feature trimming

- Removed modules (management and console surface): `easytier/src/core.rs`
  (the daemon), `service_manager`, `web_client`, `rpc_service`, and the
  integration `tests` module. `easytier/src/lib.rs` drops the clap
  completion helpers.
- Removed features and their dependencies: `tun`, `kcp`, `quic`,
  `wireguard`, `faketcp`, `magic-dns`, `management`, `management-rpc`,
  `web-client`, `cli`, `vpn-portal`, `jemalloc*`, `mimalloc`, `tracing`
  (console-subscriber), `macos-ne`, `openssl-crypto`, `system-certificates`,
  `extended-services`, `hotpath*`; `easytier-proto/json-rpc`. Code gated on
  them stays compiled out; `[lints.rust] unexpected_cfgs` lists them. This
  also removes every git dependency except EasyTier's `tokio-websockets` fork
  (pinned to the revision upstream v2.7.1 locks), and `tokio/full`.
- `easytier/build/main.rs`: no Windows thunk/DLL link setup (no TUN, no
  WinDivert), no `git log` call. `EASYTIER_VERSION` is the fixed string
  `2.7.1-openbitfun` (the `git-version` macro would describe this
  repository).
- `common::ifcfg` (interface configuration, TUN only) is gated on `tun`;
  Tokio `process` is enabled only on macOS, where `networksetup` tells
  physical interfaces apart for direct-connection candidates.
- `easytier-proto` has no build script: the generated code is checked in
  under `generated/` (no `protoc` needed to build). After editing a
  `.proto` file run
  `cargo run --manifest-path third_party/easytier/easytier-proto/codegen/Cargo.toml`
  (protoc comes from `protoc-bin-vendored`); `include!` paths point at
  `generated/`.
- `easytier-core` builds as `rlib` only; a few items used only by the web
  client carry `allow(dead_code)` when it is compiled out.
- Manifests: `publish = false`, `license = "LGPL-3.0-only"`.

## Behaviour changes (all marked `OpenBitFun` in the code)

1. **Account join tokens** (`easytier-core/src/openbitfun.rs`,
   `proto/peer_rpc.proto`, `peers/conn/peer_conn.rs`).
   `HandshakeRequest` gains `bytes obf_join_token = 1001` (upstream peers skip
   the unknown field). A process-wide registry holds the current token per
   (network name, node hostname); every handshake a node starts for its own
   network carries it. Secure-mode (Noise) handshakes carry none. Why:
   upstream lets anyone create a network on a shared relay node; OpenBitFun
   admits only signed-in devices of the account.
2. **Foreign-network admission gate** (`openbitfun.rs`,
   `peers/peer_manager.rs::add_tunnel_as_server_with_origin`). After the
   handshake of an accepted tunnel whose network is not the node's own, an
   installed `ForeignNetworkAdmission` decides; a refusal closes the tunnel
   before the peer is added (no relay bandwidth, no route exchange). Without
   a gate nothing changes. The relay node installs one that verifies the
   issuer's Ed25519 token for that network (`relay-service::link_token`).
3. **Keepalive on WebSocket tunnels** (`peers/conn/peer_conn.rs`). Pings on
   `ws`/`wss` tunnels back off to at most 15 s (upstream: 32 s). The relay is
   reachable only through its domain over HTTPS, and the provider's front end
   closes connections idle for 180 s.
4. **In-process instances** (`easytier/src/openbitfun.rs`,
   `instance/composition.rs`). `create_instance_on_current_runtime` builds an
   instance with the full native host configuration (UDP/TCP hole punching,
   UPnP, WebSocket) whose tasks run on the caller's Tokio runtime, with no
   executor threads of its own. Upstream offers this only through the
   management API or a reduced "compact" profile.
5. **Userspace TCP flush** (`gateway/smoltcp/tokio_smoltcp/socket.rs`).
   `TcpStream::poll_flush` hands buffered bytes to the stack and returns,
   like a kernel socket; upstream waited until the peer acknowledged every
   byte, which cost one round trip per flush: WebSocket writers flush each
   message, so OBP events over the relay crawled at one per RTT (500 events:
   57.6 s before, 0.55 s after).

6. **Controller role** (`easytier-core/src/openbitfun.rs`,
   `proto/common.proto`, `peers/context.rs::feature_flags`).
   `PeerFeatureFlag` gains `bool obf_controller = 1001`. A process-wide
   registry marks a member (network name, node hostname) as controller-only
   and the node's route info advertises the flag; upstream peers skip the
   field and OSPF route reflection forwards the raw route info byte-for-byte,
   so relays of any version carry it. Why: the phone app and the browser
   gateway join an account network to drive devices and serve nothing;
   devices must list them as controllers, not probe them and show them as
   unreachable devices. Nodes without the flag are devices.

7. **Route around a silent direct path** (`peers/conn/peer_conn.rs`,
   `peer_conn_ping.rs`, `peer.rs`, `peer_manager.rs::send_msg_internal`).
   A connection whose ping is answered late (four round trips, 300 ms to
   1.5 s) or not at all is marked *suspect* until a ping succeeds again:
   connection selection and flow bindings prefer answering connections, and
   when no direct connection to a peer answers (all suspect, or the last one
   just closed), packets to it go through the relay node; the relay is also
   the path of last resort while routes converge (a route still naming a
   direct neighbour that is gone). Only in networks without secure mode and
   with a relay node (public server) connected. Closing still takes five
   lost pings. Why: a direct path can
   die on one side only (a UDP tunnel has no FIN, a NAT mapping expires, a
   hole-punched duplicate is closed by one peer); upstream kept feeding it
   for about ten seconds and pinned active TCP flows to it, so streams
   stalled for 10-15 s or for good at a direct -> relay switch. Measured by
   `openbitfun-link`'s `switch_tests` (eight forced relay <-> direct
   switches over TCP and UDP): before, the stream stalled permanently at the
   first UDP switch; after, the longest gap is about 1 s.
8. **`txt:` STUN entries without a full resolver** (`easytier/src/openbitfun.rs`,
   `common/dns.rs`). Builds without the `dns-resolver` feature resolve TXT
   records with a minimal UDP DNS query to public resolvers (AliDNS, DNSPod,
   Volcengine, then Cloudflare; parallel, first answer wins, 2 s) instead of
   failing, so `txt:stun.easytier.cn` (EasyTier's mainland STUN list) works.
   Why: hole punching from mainland networks needs mainland STUN servers,
   and the hickory resolver is a large dependency for one lookup.

9. **Windows build hygiene** (`easytier/src/arch/windows.rs`,
   `instance/listeners.rs`, `socket/udp.rs`). Without the `tun` feature the
   Windows TUN and firewall helpers are unused (`allow(dead_code)` on that
   module), and imports used only by Unix-only code are gated, so
   `cargo xwin check --target x86_64-pc-windows-msvc -p openbitfun-link`
   builds without warnings.

10. **Member display names** (`easytier-core/src/openbitfun.rs`,
    `proto/peer_rpc.proto` `RoutePeerInfo.obf_display_name = 1001`,
    `core_peer.proto`/`api_instance.proto` `Route.obf_display_name = 1001`,
    `peers/route/peer_ospf_route.rs`, `easytier-proto/src/{peer_rpc,api}.rs`).
    A registry like the controller one holds a member's display name (control
    characters dropped, at most 64 bytes); its route info carries it and the
    route snapshot exposes it. Upstream peers skip the field and route
    reflection forwards it unchanged. Why: a phone app or browser session may
    not be in the account directory desktops read names from.

The data plane (`DataPlaneTcpStream`/`DataPlaneTcpListener`,
`CoreInstance::data_plane_tcp_connect/bind`) is used unchanged: it is
upstream's in-process virtual TCP over the node's smoltcp stack.

## Updating from upstream

Copy the three crates from the new tag, re-apply the trimming above, re-apply
the `OpenBitFun` changes (search for `OpenBitFun` and `openbitfun`), re-add
`obf_join_token` and `obf_display_name` to `peer_rpc.proto` (and
`obf_display_name` to both `Route` messages) and `obf_controller` to `common.proto`,
regenerate `easytier-proto/generated/`, then run `cargo test -p
openbitfun-link` (in-process nodes over a gated in-process relay, the
controller role, forced relay <-> direct switches) and the live checks in
`deploy/easytier/README.md`. The fork's own core tests run from this
directory with Link's feature set:
`cargo test -p easytier-core --lib --no-default-features --features "proxy-smoltcp-stack aes-gcm ring-crypto tcp-hole-punch dhcp-ipv4 endpoint-discovery test-utils config-write"`
(the default features include the trimmed management surface). Keep the
field numbers (1001) and the registry semantics: relay and devices of
different OpenBitFun versions meet on the same relay.

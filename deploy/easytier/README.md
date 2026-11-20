# OpenBitFun Link: relay node and issuer

OpenBitFun Link is the device network every OpenBitFun end embeds: a fork of
[EasyTier](https://github.com/EasyTier/EasyTier) v2.7.1 (LGPL-3.0, source in
`third_party/easytier`, changes in `third_party/easytier/OPENBITFUN-PATCH.md`)
that runs inside the desktop backend, the CLI host and the relay node. Users
only sign in with their OpenBitFun account; no EasyTier binary or app is used
and no network name or secret is ever shown. Devices connect directly when
they can (LAN, IPv4/IPv6 hole punching, relaying through another device of
the account); the relay node is the coordination point and the fallback path.
The old relay server is not a transport for this; it stays the account's
device directory (names and public keys).

This directory holds the sanitized deployment of the shared relay node and
the per-account credential issuer. Secrets (the issuer key) live only on the
server, mode 0600.

| Piece | Where | What |
|---|---|---|
| `openbitfun-link-node` | `/opt/openbitfun-link-node` | The fork's shared node for every account network (`obf-*`), admitting only devices with an issuer-signed join token |
| `openbitfun-mesh-issuer` | `/opt/openbitfun-mesh-issuer` | `POST /mesh/v1/credentials`: verifies the OpenBitFun identity token, returns the account's network and a 30-minute join token for the requesting device |
| `openbitfun-link-gateway` | `/opt/openbitfun-link-gateway` | Browsers: email sign-in, the account's devices, and a byte pipe into the account network (`/obp/`) |
| Web controller | `/opt/openbitfun-web/app` | The NSH web UI as a controller, `https://<domain>/app/` |
| nginx include | `/etc/nginx/openbitfun-mesh-location.conf` | `wss://<domain>/mesh/et/`, `/mesh/v1/*`, `/obp/` and `/app/` |

## Reachability: domain-only

The server opens no port: it is reachable only through its domain over HTTPS,
where the hosting provider's front end forwards to nginx. The node, the
issuer and the browser gateway listen on loopback only (node
`ws://127.0.0.1:11011/`, issuer `127.0.0.1:19720`, gateway `127.0.0.1:19730`), and `wss://<domain>/mesh/et/` is the node's only address
(`MESH_ISSUER_PEERS` names only it). Do not add `0.0.0.0`/`[::]` listeners to
the node. Hole punching does not need any server port: devices find their
public addresses with public STUN servers and exchange candidates over their
existing connection to the node.

The provider's front end closes connections idle for 180 s; Link pings every
WebSocket tunnel at least every 15 s and redials a lost relay connection every
second. nginx (`openbitfun-mesh-location.conf`) keeps tunnels for 3600 s,
passes the WebSocket upgrade, does not buffer, and takes the client address
from `X-Forwarded-For` so per-client limits count devices.

## Join tokens

A device asks the issuer for credentials with its access token and its device
id (`{"deviceId": ...}`); the response carries `joinToken` and
`joinTokenExpiresAt`. The token is `obfjt1.<claims>.<signature>`: Ed25519 over
`{v, net, acct, dev, iat, exp, jti}` (`relay-service::link_token`), valid for
30 minutes; clients refresh it 10 minutes before expiry. The signing key
derives from the issuer key, so the node holds only the public key
(`joinTokenPublicKey` of `/mesh/v1/info`). The node admits a peer of an
account network only when its handshake carries a token for that network that
verifies and has not expired; tokenless or foreign tokens are refused before
any relay traffic or route exchange. Established connections are not cut when
a token expires; reconnects need a current one.

## Issuer (`openbitfun-mesh-issuer.service`)

Built from `src/apps/relay-server` (binary `openbitfun-mesh-issuer`).

```bash
useradd --system --home-dir /opt/openbitfun-mesh-issuer --no-create-home --shell /usr/sbin/nologin openbitfun-mesh
install -d -m 0755 /opt/openbitfun-mesh-issuer /opt/openbitfun-mesh-issuer/bin
install -d -m 0750 -o root -g openbitfun-mesh /opt/openbitfun-mesh-issuer/etc
umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /opt/openbitfun-mesh-issuer/etc/issuer.key
chown openbitfun-mesh: /opt/openbitfun-mesh-issuer/etc/issuer.key
```

`/opt/openbitfun-mesh-issuer/etc/issuer.env` (root:openbitfun-mesh 0640):

```
MESH_ISSUER_LISTEN_ADDR=127.0.0.1:19720
MESH_ISSUER_KEY_FILE=/opt/openbitfun-mesh-issuer/etc/issuer.key
MESH_ISSUER_PEERS=wss://<domain>:443/mesh/et/
MESH_ISSUER_EASYTIER_VERSION=2.7.1
```

The network of an account is `obf-` + 24 hex of HMAC-SHA256(key, account id)
and its secret another HMAC of the same key, so every device of the account
gets the same network and no state is stored. **Never rotate or lose the key
casually**: a new key moves every account to a new network and changes the
join-token key (the node needs the new public key). Back up `issuer.key` with
the server's other secrets.

## Node (`openbitfun-link-node.service`)

Built from `src/apps/relay-server/link-node` (binary `openbitfun-link-node`).
A reduced build context needs `src/apps/relay-server`,
`src/crates/services/{link,relay-service,page-function-runtime,services-core}`,
`src/crates/contracts/{core-types,events,runtime-ports,product-domains}`,
`third_party/{easytier,eioc}` and a root manifest listing only the two apps;
`cargo build --release -p openbitfun-link-node -p openbitfun-relay-server` in
`rust:1.96-bookworm` produces both binaries.

```bash
useradd --system --home-dir /opt/openbitfun-link-node --no-create-home --shell /usr/sbin/nologin openbitfun-link
install -d -m 0755 /opt/openbitfun-link-node /opt/openbitfun-link-node/bin
install -d -m 0750 -o root -g openbitfun-link /opt/openbitfun-link-node/etc
install -m 0755 openbitfun-link-node /opt/openbitfun-link-node/bin/
curl -s http://127.0.0.1:19720/mesh/v1/info | python3 -c 'import sys,json; print(json.load(sys.stdin)["joinTokenPublicKey"])' > /tmp/join.pub
install -m 0640 -o root -g openbitfun-link /tmp/join.pub /opt/openbitfun-link-node/etc/join.pub
install -m 0644 openbitfun-link-node.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now openbitfun-link-node
```

The unit runs without capabilities (no TUN) and with
`MemoryDenyWriteExecute`. Its configuration is the environment in the unit
(`LINK_NODE_LISTENERS`, `LINK_NODE_HOSTNAME`, `LINK_NODE_JOIN_PUBLIC_KEY_FILE`,
`LINK_NODE_BPS_LIMIT`, 2 MiB/s of relayed traffic per account network). The
node's own network gets a fresh random secret at every start; nothing secret
is stored for it. The official `easytier-core` node of earlier builds
(`openbitfun-easytier.service`, `/opt/easytier`) is replaced: stop and disable
it before starting this unit (same loopback port). Devices on builds before
Link cannot join through this node (they send no join token).

## Browser gateway and web controller

Browsers do not run Link. A phone or computer browser opens
`https://<domain>/app/` (the web controller: the same NSH UI, built with
`pnpm run web-controller:build`), signs in with the email verification code,
sees the account's devices and drives one, through the browser gateway
(`openbitfun-link-gateway`, from `src/apps/relay-server/link-gateway`):

| Route (nginx `/obp/` to `127.0.0.1:19730`) | What |
|---|---|
| `GET /obp/api/v1/session` | Whether this browser is signed in |
| `POST /obp/api/v1/auth/code` `{email, locale}` | Starts a sign-in at the identity authority and sends the code; the authority's transaction stays on the gateway |
| `POST /obp/api/v1/auth/verify` `{challengeId, code, device}` | Checks the code, registers the browser's own X25519 device key in the account directory (relay, kind `mobile`: a controller, never listed as a host) and sets the session cookie |
| `POST /obp/api/v1/auth/sign-out` | Revokes the browser's directory credential and clears the cookie |
| `GET /obp/api/v1/devices`, `/devices/{id}/key` | The account's devices with whether each can be connected and why not; a device's public key for the handshake |
| `GET /obp/{deviceId}` (WebSocket) | A byte pipe to the device's OBP port in the account's Link network |

- **End to end.** Inside the pipe the browser (page realm of `host.js`:
  WebCrypto X25519 key, non-extractable, in IndexedDB) and the device run OBP's
  end-to-end channel (`obp-e2e-v1`, `src/apps/desktop/src/backend_protocol/ws/e2e.rs`):
  the account-device proof over the directory pair key, bound to fresh
  ephemeral keys, then AES-256-GCM records. The gateway logs byte counts per
  pipe, never content.
- **Session.** An HttpOnly, `Secure`, `SameSite=Strict` cookie on `/obp`:
  the account id, the browser's device id and directory credential, sealed
  with AES-256-GCM under a key derived from the issuer key (no session store;
  a restart keeps sessions). Every device list and pipe re-checks the
  credential with the directory, so a sign-out or a removed device ends it.
- **Isolation and limits.** A pipe opens only to a host device the directory
  lists for the session's account, through that account's own network member
  (`LinkGateway`: one member per account network, `obf-gateway-lwb`). Limits:
  1024 pipes, 256 account networks, 16 streams per account, 6 code requests and
  20 verify attempts per client address per minute, idle pipes closed after
  150 s, page `Origin` checked on every API call and pipe. The gateway pings
  each WebSocket every 30 s (the front end cuts silent ones at 180 s).
- **Answers.** A pipe that cannot open is accepted and closed with a code the
  page shows: 4401 signed out, 4403 not the account's device, 4404 not on the
  device network (offline or a build without Link), 4429 busy, 4503
  unavailable. A device on a build without the end-to-end channel hangs up on
  the hello; the page says to update OpenBitFun there.

Gateway install (it mints account-network membership from the issuer key, so
it runs as the issuer's user and reads `issuer.key` where it is):

```bash
install -d -m 0755 /opt/openbitfun-link-gateway /opt/openbitfun-link-gateway/bin
install -m 0755 openbitfun-link-gateway /opt/openbitfun-link-gateway/bin/
install -m 0644 openbitfun-link-gateway.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now openbitfun-link-gateway
```

The binary builds in the same reduced context as the node (add
`src/apps/relay-server/link-gateway` to the context's members):
`cargo build --release -p openbitfun-link-gateway`.

Web controller install (static files; nothing runs):

```bash
pnpm run web-controller:build          # target/web-controller/app (domain: --domain)
rsync -a --delete target/web-controller/app/ <server>:/opt/openbitfun-web/app/
```

The page's `#nsh-params` `{controller: {api, gateway}}` names the gateway;
the nginx include serves `/app/` with the CSP the NSH web runtime needs
(`script-src 'self' 'wasm-unsafe-eval'`), precompressed files and immutable
caching for content-hashed names. The old relay site keeps `/` (legacy
`mobile-web`) unchanged. `nginx -t` before every reload.

## Verification

```bash
curl -s https://<domain>/mesh/v1/info        # capabilities include link_join_token_v1
# On the server: credentials for two devices of a scratch account (0600 files).
openbitfun-link-node issue --issuer-key-file /opt/openbitfun-mesh-issuer/etc/issuer.key \
  --account selftest-$RANDOM --device dev-a --out a.json
```

With two such documents on any machine:
`cargo run --release -p openbitfun-link --example link_probe -- b.json dev-b serve`
and `... a.json dev-a ping dev-b` print routes (direct LAN / IPv4 / IPv6,
relayed by the server or a device), latency and throughput
(`OPENBITFUN_MESH_DISABLE_P2P=1` forces the relay). The desktop end-to-end
checks (two backends, OBP calls and event streams with the account-device
handshake, Peer Device Mode token streaming) are
`OPENBITFUN_LINK_E2E_A=a.json OPENBITFUN_LINK_E2E_B=b.json cargo test -p openbitfun-desktop --lib mesh_e2e peer_link_e2e -- --ignored --nocapture --test-threads 1`.
The node logs every admission and refusal (`journalctl -u openbitfun-link-node`).

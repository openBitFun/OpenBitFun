# OpenBitFun device mesh node (EasyTier)

New OpenBitFun clients connect the devices of one account through an
[EasyTier](https://github.com/EasyTier/EasyTier) network (LGPL-3.0): automatic
P2P hole punching with relay fallback. The old relay server is not a transport
for this; it stays the account's device directory (names and public keys).

This directory holds the sanitized deployment of the shared relay/discovery
node and the per-account credential issuer. Secrets (the node's own network
secret, the issuer key) live only on the server, mode 0600.

| Piece | Where | What |
|---|---|---|
| `easytier-core` v2.6.4 | `/opt/easytier` | Shared node, network `openbitfun-relay`; relays and coordinates only networks named `obf-*` |
| `openbitfun-mesh-issuer` | `/opt/openbitfun-mesh-issuer` | `POST /mesh/v1/credentials`: verifies the OpenBitFun identity token and returns the account's network |
| nginx include | `/etc/nginx/openbitfun-mesh-location.conf` | `wss://relay.example.com/mesh/et/` and `/mesh/v1/*` through the edge (cloud WAF/LB) on :80 |

## Version

Clients and the node run EasyTier **v2.6.4**, the latest stable (non-prerelease)
release. v2.7.x is a prerelease line with configuration migrations; adopt it by
changing the pin in `scripts/fetch-easytier.mjs`, the issuer's
`MESH_ISSUER_EASYTIER_VERSION`, and this node together.

## Node (`openbitfun-easytier.service`)

```bash
useradd --system --home-dir /opt/easytier --no-create-home --shell /usr/sbin/nologin easytier
install -d -m 0755 /opt/easytier /opt/easytier/bin
install -d -m 0750 -o easytier -g easytier /opt/easytier/etc /opt/easytier/logs
curl -fsSLO https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-linux-x86_64-v2.6.4.zip
echo "61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6  easytier-linux-x86_64-v2.6.4.zip" | sha256sum -c -
# unzip; install easytier-core and easytier-cli into /opt/easytier/bin (root:root 0755)
```

`/opt/easytier/etc/config.toml` (owner `easytier`, mode 0600):

```toml
instance_name = "openbitfun-relay"
hostname = "openbitfun-relay-<site>"
listeners = ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11010", "ws://0.0.0.0:11011/"]

[network_identity]
network_name = "openbitfun-relay"
network_secret = "<random, generated on the server>"

[flags]
no_tun = true
multi_thread = true
relay_network_whitelist = "obf-*"
private_mode = false
foreign_relay_bps_limit = 2097152
```

Install `openbitfun-easytier.service` into `/etc/systemd/system/`, then
`systemctl enable --now openbitfun-easytier`. The unit runs as `easytier`
without capabilities (no TUN). Do not add `MemoryDenyWriteExecute`: the release
binaries are UPX-packed and crash with it. Check with
`/opt/easytier/bin/easytier-cli -p 127.0.0.1:15888 node`.

`private_mode = false` and the `obf-*` whitelist make this a shared node for
account networks: anyone can join a network whose name starts with `obf-`, but
only holders of that network's secret can talk inside it. The per-network relay
bandwidth is capped (`foreign_relay_bps_limit`, 2 MiB/s).

## Issuer (`openbitfun-mesh-issuer.service`)

Built from `src/apps/relay-server` (binary `openbitfun-mesh-issuer`, standalone
like the relay: copy `src/apps/relay-server`, `src/crates/services/relay-service`
and `src/crates/services/page-function-runtime`, then
`cargo build --release --bin openbitfun-mesh-issuer` in `src/apps/relay-server`).

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
MESH_ISSUER_PEERS=wss://relay.example.com:443/mesh/et/
MESH_ISSUER_EASYTIER_VERSION=2.6.4
```

The network of an account is `obf-` + 24 hex of HMAC-SHA256(key, account id)
and its secret another HMAC of the same key, so every device of the account
gets the same network and no state is stored. **Never rotate or lose the key
casually**: a new key moves every account to a new network (devices then meet
again only after each fetched new credentials; clients cache credentials).
Back up `issuer.key` with the server's other secrets.

## Edge (nginx)

`openbitfun-mesh-location.conf` is included in the existing `relay.example.com`
server block right after the relay include (`nginx -t && systemctl reload nginx`).
It reuses the relay's WAF peer map and connection-upgrade map; nothing else in the
site changes.

## Ports and the cloud security group

The node listens on 11010/tcp, 11010/udp (EasyTier) and 11011/tcp (WebSocket).
When the cloud security group blocks them, clients use
`wss://relay.example.com/mesh/et/` through the edge on :80/:443 (works on every
network, at the cost of the edge hop on relayed traffic).

For best P2P and relay performance open, inbound from `0.0.0.0/0`:

- **11010/udp**: UDP tunnels and STUN-assisted hole punching coordination (most important)
- **11010/tcp**: direct TCP tunnels when UDP is blocked on a client network

then add `udp://<server-ip>:11010,tcp://<server-ip>:11010` in front of the
WSS URL in `MESH_ISSUER_PEERS` and restart the issuer. 11011/tcp does not need to
be opened (nginx reaches it locally).

## Verification

From any machine with the EasyTier binaries (`node scripts/fetch-easytier.mjs`):

```bash
# a throwaway network that matches the whitelist
easytier-core --no-tun --network-name obf-selftest-$RANDOM --network-secret "$(openssl rand -hex 16)" \
  -p wss://relay.example.com:443/mesh/et/ --rpc-portal 127.0.0.1:15999
easytier-cli -p 127.0.0.1:15999 peer   # shows PublicServer_openbitfun-relay-<site> over wss
curl -s https://relay.example.com/mesh/v1/info
```

The desktop end-to-end check (two backends, OBP call and event stream across the
mesh with the account-device handshake) is
`cargo test -p openbitfun-desktop --lib mesh_e2e -- --ignored --nocapture` with
`OPENBITFUN_EASYTIER_DIR` and `OPENBITFUN_MESH_E2E_PEER` set (see the test).

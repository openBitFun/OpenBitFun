# OpenBitFun 2.0 service host: `super.openbitfun.com`

Every OpenBitFun 2.0 component (desktop, CLI, phone app, web UI, browser
gateway, mesh issuer, cloud agent) uses this one host. `remote.openbitfun.com`
(the 1.0 relay container, its database and its nginx site) serves released
1.0 clients only: no 2.0 component reads or writes it, and nothing here
changes it. 2.0 stays compatible with 1.0 for session records and
configuration only.

| Path | Service (loopback) | Unit / source |
|---|---|---|
| `/` | Web UI launcher (static) | `/opt/openbitfun-web/super`, `pnpm run web-controller:build` |
| `/b/<bundleId>/` | A device's UI through the Service Worker (nginx answers the boot page) | same |
| `/cas/<sha256>` | Web UI pool | `openbitfun-link-gateway` `127.0.0.1:19730` |
| `/obp/` | Browser gateway API and device pipes | `openbitfun-link-gateway` `127.0.0.1:19730` |
| `/mesh/et/` | OpenBitFun Link relay node (WebSocket) | `openbitfun-link-node` `127.0.0.1:11011` |
| `/mesh/v1/*` | Mesh credential issuer | `openbitfun-mesh-issuer` `127.0.0.1:19720` |
| `/agent/` | Cloud agent | `openbitfun-superagent` `127.0.0.1:19740` |
| `/directory/` | Account device directory | `openbitfun-directory` `127.0.0.1:19750` |

The node, issuer, gateway and web UI are described in
[`deploy/easytier`](../easytier/README.md), the cloud agent in
[`deploy/superagent`](../superagent/README.md).

## Reachability: domain-only

The server opens no port of its own. The provider's front end terminates
HTTPS for `*.openbitfun.com` (wildcard certificate) and forwards to nginx on
:80; the origin's default server answers 404 for names without a server
block. `super.openbitfun.com.conf` is that block: it trusts only the
front-end ranges (`$obf_super_trusted_peer`, `nginx-http.conf`), takes the
client address from `X-Forwarded-For`, and proxies each path to its loopback
service. The 2.0 site has its own maps, limit zones and log format, never
the 1.0 relay's.

The front end closes a WebSocket after 180 s of silence. Link pings each
tunnel at least every 15 s, the gateway and the cloud agent ping every 30 s,
and nginx keeps tunnels for 3600 s, so a live connection is never cut by an
idle timer.

## Account directory (`openbitfun-directory`)

The same `openbitfun-relay-server` binary as the 1.0 relay
(`src/apps/relay-server`), as a separate service with its own database
(`/var/lib/openbitfun-directory/directory.db`). Devices register their
X25519 keys there (`/directory/api/auth/login` with the identity access
token); devices, the gateway and the cloud agent read names, kinds and keys
(`/directory/api/devices`, `/directory/api/devices/<id>/key`). Its
server-only cloud agent route (`/api/internal/v1/cloud-agent`,
`relay-service/src/routes/cloud_agent.rs`) is on: nginx answers 404 for
`/directory/api/internal/`, and the route itself refuses any proxied
request. Its key (64 hex characters) is one file per reader, each 0600 and
owned by that service's user:
`/opt/openbitfun-directory/etc/cloud-agent.key` (`RELAY_CLOUD_AGENT_KEY_FILE`)
and `/opt/openbitfun-superagent/etc/directory.key`
(`SUPERAGENT_DIRECTORY_KEY_FILE`).

```bash
useradd --system --home-dir /opt/openbitfun-directory --no-create-home --shell /usr/sbin/nologin openbitfun-directory
install -d -m 0755 /opt/openbitfun-directory /opt/openbitfun-directory/bin
install -d -m 0750 -o root -g openbitfun-directory /opt/openbitfun-directory/etc
(umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /opt/openbitfun-directory/etc/cloud-agent.key)
chown openbitfun-directory: /opt/openbitfun-directory/etc/cloud-agent.key
install -m 0600 -o openbitfun-mesh -g openbitfun-mesh /opt/openbitfun-directory/etc/cloud-agent.key /opt/openbitfun-superagent/etc/directory.key
install -m 0755 openbitfun-relay-server /opt/openbitfun-directory/bin/
install -m 0644 openbitfun-directory.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now openbitfun-directory
```

The binary builds in the reduced context of `deploy/easytier` (it is
`cargo build --release -p openbitfun-relay-server` there).

It runs with `RELAY_PROFILE=directory`
(`relay-service/src/directory_hygiene.rs`), which the 1.0 relay never sets:

- Published Pages are off: the Page routes are not mounted (404), there is
  no asset store on disk, and the service refuses to start when any
  `RELAY_PAGE_*` or `RELAY_ASSET_*` variable is set.
- Retention, swept hourly: expired tokens are deleted; a device row with no
  live token goes after `RELAY_STALE_DEVICE_DAYS` (90) without being seen, or
  `RELAY_STALE_CONTROLLER_DAYS` (30) for phones and browser sign-ins (kind
  `mobile`); a row without `last_seen_at` is never removed by age; a user with
  no device, token or Page left goes after `RELAY_STALE_USER_DAYS` (365).
- A sign-in on an account at the 64-device or 256-token quota first frees
  room: the dead row seen longest ago, else the controller seen longest ago
  (that browser or phone signs in again). Hosts and the cloud agent are never
  removed this way.

## nginx

```bash
install -m 0644 nginx-http.conf /etc/nginx/conf.d/openbitfun-super.conf
install -m 0644 super.openbitfun.com.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/super.openbitfun.com.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Keep a copy of `/etc/nginx` before every change, and run `nginx -t` before
every reload.

## Logs

The site logs to its own directory with its own retention; the host's
`/etc/logrotate.d/nginx` (60 days for `/var/log/nginx/*.log`, kept for the
1.0 release mirror) does not match it.

- Access log `/var/log/nginx/openbitfun-super/access.log`: time, method,
  route, status, size and timing. No client address, no query string, and
  device, bundle and content ids are replaced by placeholders
  (`$obf_super_log_path`). The error log keeps only `crit` lines, because
  request errors carry the client address and the full request line.
- Retention 14 days, at most 100 MiB per file (`logrotate-openbitfun-super.conf`).
- The services log to the journal, capped host-wide at 2 GiB and 30 days
  (`journald-openbitfun.conf`). Their lines carry hashed account labels and
  device ids, never message text, titles, e-mail addresses or client
  addresses (the Link relay logs the transport only).

```bash
install -d -m 0750 -o root -g adm /var/log/nginx/openbitfun-super
install -m 0644 logrotate-openbitfun-super.conf /etc/logrotate.d/openbitfun-super
logrotate -d /etc/logrotate.d/openbitfun-super
install -D -m 0644 journald-openbitfun.conf /etc/systemd/journald.conf.d/50-openbitfun.conf
systemctl restart systemd-journald
```

## Configuration of the 2.0 clients

| Setting | Default | Override |
|---|---|---|
| Account directory | `https://super.openbitfun.com/directory` (`DEFAULT_ACCOUNT_DIRECTORY_URL`, also `DEFAULT_RELAY_URL`) | `OPENBITFUN_ACCOUNT_DIRECTORY_URL`; phone `OPENBITFUN_DIRECTORY_URL` |
| Mesh issuer | `https://super.openbitfun.com` | `OPENBITFUN_MESH_API_URL` |
| Link relay node | the issuer's `peers` (`MESH_ISSUER_PEERS=wss://super.openbitfun.com:443/mesh/et/`) | issuer environment |
| Cloud agent | `wss://super.openbitfun.com/agent/obp`, derived from the directory URL | directory URL |
| Web UI | `https://super.openbitfun.com/` | `web-controller:build --domain` |

## Verification

```bash
for p in / /mesh/v1/info /agent/health /directory/health /obp/api/v1/session; do
  curl -s -o /dev/null -w "$p %{http_code}\n" https://super.openbitfun.com$p; done   # all 200
curl -s -o /dev/null -w "%{http_code}\n" https://super.openbitfun.com/directory/api/internal/v1/cloud-agent  # 404
systemctl status openbitfun-directory openbitfun-mesh-issuer openbitfun-link-node openbitfun-link-gateway openbitfun-superagent
```

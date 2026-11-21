# OpenBitFun cloud agent (`openbitfun-superagent`)

The cloud agent is the account's hub entry: an input box, a model, and a set
of management tools over the account's own desktops and CLI hosts. It runs no
tools on the server and holds no model credentials. Model rounds are relayed to
one of the account's devices (`fleet_model_*`), and every job belongs to the
device that runs it (Detached Dispatch). It is on by default: the first sign-in
or first use of an account creates its node. `superagent_disable` turns it off,
and `superagent_delete_data` deletes everything in one step.

Source: `src/apps/relay-server/superagent` (crate docs in `src/lib.rs`).

| Piece | Where | What |
|---|---|---|
| `openbitfun-superagent` | `/opt/openbitfun-superagent/bin` | The service, on `127.0.0.1:19740` only |
| Directory key | `/opt/openbitfun-superagent/etc/directory.key` | The 2.0 directory's cloud agent route credential (`deploy/super`), `openbitfun-mesh` 0600 |
| Master key | `/opt/openbitfun-superagent/etc/master.key` | 64 hex characters, `openbitfun-mesh` 0600. Wraps every account's data key |
| Data | `/var/lib/openbitfun-superagent` | `StateDirectory`, 0700. `accounts/<hmac>/key.wrap` and `*.rec` |
| Unit | `/etc/systemd/system/openbitfun-superagent.service` | `MemoryMax=3G`, `SUPERAGENT_FRONTENDS=true` |
| nginx | `super.openbitfun.com.conf` (`deploy/super`) | `https://super.openbitfun.com/agent/` to the loopback port |

## Reachability: domain-only

The server opens no port of its own. The agent listens on loopback, and
`https://super.openbitfun.com/agent/` is its only address (the provider's front end, then
nginx). Entries (desktop and CLI backends) dial `wss://super.openbitfun.com/agent/obp`.
The WebSocket carries the OBP end-to-end channel (`obp-e2e-v1`):

- The entry proves it holds the key of a device of the account. That is the
  pair key of its directory key and the node's own `cloud_agent` key.
- The node proves it is `cloud-<hash(account)>`.
- After the handshake, every record is AES-256-GCM.

nginx and the front end only see ciphertext.

The agent reaches devices through the account's Link network, as its own
member (`obf-agent-lwb`, minted from the issuer key like the browser
gateway). Devices see its `cloud_agent` directory row and grant it the
`cloud-agent` scope: the `account-device` allowlist plus the model relay
(`fleet_model_*`), under the device's switches `superagent.acceptDispatch` and
`superagent.allowAutoApproval` (both on by default). A device whose mesh info
lacks `cloud_agent_scope_v1` is never dialed (`superagent_requires_update`).

## State and privacy

- Each account has a directory named `hmac(master, account)`. Inside it,
  `key.wrap` holds the account's 32-byte data key, AES-256-GCM under a key
  derived from the master key. Records (`meta`, `ledger`, `conversations`,
  `conv-*`, `hist-*`, `index`, `devices`) are AES-256-GCM under the data key, with the
  account directory and the record name as associated data. No file name or
  byte on disk holds an account id or conversation text. This protects disks
  and backups. It does not protect against the operator of the running
  process.
- Deleting data overwrites and removes `key.wrap` first, then the records.
  Backups of the records can then no longer be opened (crypto-shred). The
  node's directory row is revoked before anything is deleted.
- `devices` holds each device's facts as last seen online (capabilities,
  models, workspaces), so after a restart an offline device answers
  `device_offline` (a job can queue for it) instead of
  `superagent_requires_update`. It is read tolerantly: an entry this build
  cannot read is skipped and kept.
- Logs hold ids and byte counts only.
- **Never lose or rotate `master.key` casually.** Without it, no account's
  data opens. Back it up with the server's other secrets.

## Bounds

- An account slot loads on demand. It holds the ledger, the last 20 turns of
  its resident conversations, and an index of at most 256 KiB, within 4 MiB.
- At most 512 slots are resident (least recently used first out).
- A slot unloads after 10 idle minutes. Accounts with live jobs or unfinished
  turns stay on the watcher list (`SUPERAGENT_WATCH_SECONDS`).
- Model rounds: at most 64 per process and 2 per account.
- `MemoryMax=3G` covers the slots plus Link and buffers.

## Install

The agent runs as the issuer's user (`openbitfun-mesh`), because it reads
`issuer.key`.

```bash
install -d -m 0755 /opt/openbitfun-superagent /opt/openbitfun-superagent/bin
install -d -m 0750 -o root -g openbitfun-mesh /opt/openbitfun-superagent/etc
umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /opt/openbitfun-superagent/etc/master.key
chown openbitfun-mesh: /opt/openbitfun-superagent/etc/master.key
install -m 0755 openbitfun-superagent /opt/openbitfun-superagent/bin/
install -m 0644 openbitfun-superagent.service /etc/systemd/system/
# nginx: the /agent/ locations are part of deploy/super/super.openbitfun.com.conf.
systemctl daemon-reload && systemctl enable --now openbitfun-superagent
```

### Building it

The binary builds in the same reduced context as the browser gateway. Add
these to the context:

- `src/apps/relay-server/superagent`;
- `src/crates/adapters/obp`.

Then build with `cargo build --release -p openbitfun-superagent` in
`rust:1.96-bookworm`.

## Account provisioning and frontends

`SUPERAGENT_FRONTENDS=true` is the deployed value (`false` makes
`/agent/obp` and `POST /agent/api/v1/ensure` answer `503
superagent_unavailable`; `/agent/health` answers either way).

- An account's node is created on its first sign-in: the browser gateway
  calls `POST /agent/api/v1/ensure` on loopback after a browser's sign-in
  (`LINK_GATEWAY_SUPERAGENT_URL`), and desktop and CLI hosts call it once per
  process when their directory session starts
  (`remote_connect::directory_session`). Both are best effort.
- `ensure` registers the node's row (kind `cloud_agent`) in OpenBitFun 2.0's
  own directory (`openbitfun-directory`, `deploy/super`) through its
  server-only route (`POST`/`DELETE /api/internal/v1/cloud-agent`,
  `relay-service/src/routes/cloud_agent.rs`) at
  `SUPERAGENT_DIRECTORY_URL=http://127.0.0.1:19750`, with the credential in
  `SUPERAGENT_DIRECTORY_KEY_FILE`. It never touches the 1.0 relay or its
  database.
- Devices see the node's row kind and grant it the `cloud-agent` scope; a
  device without `cloud_agent_scope_v1` is never dialed.

## Verification

```bash
curl -s https://super.openbitfun.com/agent/health     # {"ok":true,"frontends":true,...}
systemctl status openbitfun-superagent
journalctl -u openbitfun-superagent -n 50
```

The behavior is covered by these test suites (fakes only):

- `cargo test -p openbitfun-superagent`: the fake runtime matrix and the
  end-to-end channel;
- `cargo test -p openbitfun-relay-service --lib db::`: the directory kind.

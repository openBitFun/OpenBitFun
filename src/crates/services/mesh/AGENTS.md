# Mesh Service

This crate owns the OpenBitFun device mesh runtime pieces that do not depend on
a host: the EasyTier `easytier-core` sidecar (configuration, supervision with
backoff, status probes through `easytier-cli`), the credential wire shape the
account mesh issuer returns, and the account-device handshake proofs that OBP
uses over the mesh.

## Ownership

- EasyTier runs as a separate official binary (LGPL-3.0, never linked). This
  crate spawns it in no-TUN userspace mode with `create_tokio_command` (no
  console windows), writes its config with mode 0600, and never logs the
  network secret or raw `easytier-cli node` output (it embeds the config).
- Mesh membership is only the outer gate. OBP over the mesh authenticates every
  connection with the device X25519 pair key (`handshake`).
- Credential issuing lives in `relay-service` (`mesh_issuer`); the OBP mesh
  listener, the client helper and the commands live in `src/apps/desktop`.

## Boundaries

- Do not depend on assembly, interface, adapter, or application crates.
- Keep HTTP clients and servers out of this crate; hosts fetch credentials.

## Verification

Run `cargo test -p openbitfun-mesh-service` and
`node scripts/check-core-boundaries.mjs` after changes. The live end-to-end
check (two real sidecars through the relay node, OBP across the mesh) is the
ignored `mesh_e2e_*` tests in `src/apps/desktop` (`backend_protocol/ws/mesh_tests.rs`);
see `deploy/easytier/README.md`.

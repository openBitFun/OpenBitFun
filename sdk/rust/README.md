# OpenBitFun in-process Rust SDK

A Rust application can run a local agent directly with the `openbitfun-agent` crate and its `local` feature. The application supplies a workspace, an absolute data directory, and an explicit model configuration. It can receive model events, approve or reject a text file read, cancel a turn, and reopen a saved session. Model requests and approved file reads run in the application's process.

## Build the independent consumer

From the OpenBitFun checkout, run the following with Rust/Cargo, Node.js and Python 3.11+ (or Python 3.9+ with `tomli`). The temporary volume must record file access times so that the smoke test can distinguish a real read from a denied read.

```sh
work=$(mktemp -d)
python3 sdk/rust/verify.py "$work/rehearsal"
```

This produces two sibling workspaces, `OpenBitFun-SDK/` and `consumer/`, and builds the consumer into a new `target/`. Each workspace has its own manifest and lockfile. Use `--offline` when the Cargo registry cache contains the locked dependencies for all target platforms. The rehearsal keeps these workspaces for inspection. The model fixture uses a local HTTP SSE endpoint and needs no API key.

On macOS the consumer build and smoke run under a sandbox that denies access to the original checkout. The smoke process has an empty executable search path and can reach only loopback addresses under that sandbox. On other systems the script checks the Cargo graph and builds in a clean target directory. To verify physical isolation there, copy both workspaces to a machine or container with the checkout unmounted, then build and run the consumer there.

The fixture checks the tool call ID and random file contents in the second model request. It reopens the session in a fresh process and checks that the model receives the saved result without reading the file again. Separate processes test rejection and cancellation before approval. The approved read serves as a positive control for the filesystem access-time checks.

## Use the crate in another project

From the product root, `python3 sdk/rust/export.py /path/to/new/OpenBitFun-SDK` exports the SDK alone. A sibling Rust project can depend on that workspace directly.

```toml
[dependencies]
openbitfun-agent = { path = "../OpenBitFun-SDK/src/crates/assembly/agent", features = ["local"] }
```

1. Call `LocalAgent::open(workspace, data_root, model)` and `create_session(name)`. Persist the returned session ID.
2. Subscribe to `agent.subscribe_permissions()` before driving `session.run(prompt, cancellation_token)`. While the turn is running, match each approval to its session and tool call and use `agent.reply(request_id, reply)`. Model events are available through `session.subscribe_events()`.
3. Drop the session to release its writer. A fresh process can call `restore_session(id)` with the same workspace and data root. A second writer receives `SessionWriteLockError::InUse` while the original writer is active.

The runnable consumer is in [smoke/main.rs](smoke/main.rs). The local assembly supplies a text-model adapter and a workspace-bound `Read` provider. Desktop and CLI supply their product tool catalogs, routing, hooks and context-management policies through their existing assembly. Stored sessions needing an interrupted-turn repair or a remote execution target require the owning host.

## Check compatibility with the product SDK Host

After building the TypeScript SDK, run these commands in the product checkout with the consumer built above.

```sh
cargo build --locked -p openbitfun-sdk-host-app --bin openbitfun-sdk-host
pnpm --dir sdk/typescript stage:host ../../target/debug/openbitfun-sdk-host
OPENBITFUN_SMOKE_RUST_CONSUMER="$work/rehearsal/target/debug/export-consumer" pnpm --dir sdk/typescript smoke:node
```

This checks a live writer conflict, then transfers a real Host session to the independent consumer and verifies a second approved read.

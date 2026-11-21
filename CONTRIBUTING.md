# Contributing

[中文版](./CONTRIBUTING_CN.md)

Thanks for your interest in OpenBitFun! OpenBitFun is a multi-platform AI programming environment powered by Rust and TypeScript, with shared core logic across Desktop/CLI/Server. This guide explains how to contribute effectively.

## Code of Conduct

Be respectful, kind, and constructive. We welcome contributors of all backgrounds and experience levels.

## Quick Start

### Prerequisites

- Node.js 22.12+ (LTS recommended)
- pnpm 10.15.0 via Corepack
- Rust toolchain (install via [rustup](https://rustup.rs/))
- The [NSH CLI](docs/architecture/nsh-frontend.md) (`nsh` 0.6) and Rust 1.98.1 for the native desktop app (`RUSTUP_TOOLCHAIN=1.98.1`)

OpenBitFun standardizes local JavaScript builds and CI on Node.js 22.12+. The GitHub
Actions upgrades in this repository use Node.js 24-compatible action runtimes,
but project scripts should run on Node.js 22.12+ unless a narrower local guide
says otherwise. After switching from an older Node.js version, rerun
`pnpm install`.

#### Build Prerequisites Check

When `cargo check --workspace`, `cargo check -p openbitfun-desktop`, or pnpm build
commands fail with confusing errors (e.g., "resource path doesn't exist" or
sherpa-onnx download failures), run the preflight check to identify missing
prerequisites and get actionable fix commands:

```bash
pnpm run check:build-prereqs           # check only
pnpm run check:build-prereqs -- --fix  # attempt to fix missing prerequisites
```

The check detects:

- Missing `node_modules` (fix: `pnpm install`)
- Missing sherpa-onnx prebuilt libs (the sherpa-onnx-sys build script
  downloads from GitHub at build time; if the download fails on poor
  connectivity, set `SHERPA_ONNX_LIB_DIR` to the prebuilt lib directory
  under `target/sherpa-onnx-prebuilt/` to use the local copy)

### Install dependencies

```bash
pnpm install
```

The pnpm workspace uses the root `pnpm-lock.yaml` as its dependency lockfile;
do not commit `package-lock.json` files for workspace packages. The standalone
`packages/dsh-acp` npm package and `src/apps/extension-host` Bun host retain their
own lockfiles and preparation commands. Keep generated `gen/` directories (Data Tools, installer, MiniApp shell)
and local implementation-process notes out of Git.

### Common commands

```bash
# Desktop: the native NSH app (src/apps/desktop-nsh + src/nsh-ui + the backend library)
pnpm run desktop:dev                # build the UI bundle, backend and runner (debug), then run it
pnpm run desktop:dev -- --isolated-data # opt into checkout-local test data
pnpm run desktop:preview:debug      # run the last debug build without rebuilding
pnpm run prepare:dsh-profile        # optional: compile the DeepSeek Harness bridge for local sessions

# Desktop (packaged app for this OS: target/desktop-nsh/)
pnpm run desktop:build              # release profile; desktop:build:release-fast for a faster local package

# UI suite and native smoke test
pnpm run e2e:ui                     # headless NSH UI suites (cd src/nsh-ui && nsh test .)
pnpm run e2e:smoke                  # launches the built app on a scratch profile and drives it over OBP
```

> The NSH CLI (`nsh`) and `RUSTUP_TOOLCHAIN=1.98.1` are required for the native app; see [`docs/architecture/nsh-frontend.md`](docs/architecture/nsh-frontend.md). `desktop:dev` rebuilds before every launch; UI-only iteration can use `nsh run src/nsh-ui --target web` with hot reload.

Both launchers use the installed app's data by default, including existing model
settings, workspaces, and sessions. Use `--isolated-data` for persistent test data
under the current checkout's `.openbitfun/desktop-dev/` directory. Explicit
storage environment overrides still take precedence; `--shared-data` remains a
compatible way to request the default mode.

> For the full script list, see [`package.json`](package.json). For agent-specific commands, verification, and architecture rules, see [`AGENTS.md`](AGENTS.md).

### Desktop debugging tools

The desktop app is a native NSH app with no WebView DevTools. Debug the UI with
`nsh run src/nsh-ui --target web` (browser devtools on the web target) and the
headless suites (`cd src/nsh-ui && nsh test .`); backend logs are in the session
log directory (Settings → Logs).

## Code Standards and Architecture Constraints

Use [`AGENTS.md`](AGENTS.md) as the canonical source for repository-wide rules,
layer boundaries, and how to choose verification. In contributor-facing terms:

- Logs are English-only and should stay useful, not noisy.
- User-visible copy should use the project i18n flow; do not share the desktop
  UI locale catalogs with smaller surfaces.
- Shared core must stay platform-agnostic. Desktop host details belong in app
  adapters and flow through typed capability interfaces; use the production
  transport adapter when event delivery is needed.
- Backend commands use `snake_case` command names and structured `request`
  payloads (`// @backend-command` handlers registered in `backend_commands!`).
- Product architecture, feature-boundary, dependency-boundary, and build-speed
  work must follow `docs/architecture/product-architecture.md` and
  `docs/architecture/rust-build-dependency-boundaries.md`.
- Feature-specific rules belong in the nearest module `AGENTS.md`.

## Key Contribution Focus Areas

1. Contribute good ideas/creativity (features, interactions, visuals, etc.) by opening issues
   > Product managers and UI designers are welcome to submit ideas quickly via PI. We will help refine them for development.
2. Improve the Agent system and overall quality
3. Improve system stability and strengthen foundational capabilities
4. Expand the ecosystem (Skills, MCP, or better support for domain-specific development scenarios)

## Contribution Workflow and PR Expectations

### What to Contribute (Beyond Features and Fixes)

We welcome contributions beyond standard feature or bug-fix PRs. Examples include:

| Contribution area | Location / files | Example |
| --- | --- | --- |
| Prompts | `src/crates/assembly/agent-content/prompts/agents/` | Add or refine built-in prompts; keep selection and runtime policy in their existing owners |
| Tools | `src/crates/assembly/core/src/agentic/tools/implementations/`, `src/crates/assembly/core/src/agentic/tools/registry.rs` | Add tool implementations and register them in the tool registry |
| Subagents | `src/crates/assembly/core/src/agentic/agents/definitions/`, `src/crates/assembly/core/src/agentic/agents/registry/` | Add subagent definitions and register them with the owning registry |
| Mode contributions | `src/crates/assembly/core/src/agentic/agents/definitions/`, `src/crates/assembly/agent-content/prompts/agents/`, `src/nsh-ui/src/locales/` | Keep mode policy, built-in prompts, and owning UI copy in sync |
| Playbook and scenario guides | `src/shared/interactive-capabilities/catalog.json`, owning app README | Maintain the source catalog and run `pnpm run capabilities:generate`; `website/` consumes the generated catalog |

### Before you start

- Open an issue to describe the problem or proposal, especially for larger changes, to avoid duplication and design conflicts
- For new features or UI changes, discuss the design direction early to ensure it fits the product experience
- Use the issue and PR templates as a guide. Keep the PR focused and explain any skipped verification when it matters.

### PR title and description

We recommend using Conventional Commits for clearer history and better automation:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `chore:` maintenance/deps
- `refactor:` refactor without behavior change
- `test:` tests

UI changes should include before/after screenshots or a short recording for fast review.

If your work is AI-assisted, please note it in the PR and indicate testing level (untested/lightly tested/fully tested) to help reviewers assess risk.

Do not commit transient AI prompts, local absolute paths, generated scratch files, pairing secrets, tokens, certificates, or unrelated artifacts. Keep the PR focused on the intended product or maintenance change.

Git objects larger than 5 MiB are rejected by the Repository Object Sizes check,
including files added in an intermediate commit and deleted before the PR's final
commit. Keep build artifacts outside Git. Existing bundled Chinese fonts have
exact-object exceptions in `scripts/git-object-size-policy.json`; changes to those
exceptions require review. Check a proposed history with
`node scripts/check-git-object-sizes.mjs --base origin/main --head HEAD`, or omit
`--base` to check all reachable history. Verify the checker with
`node --test scripts/check-git-object-sizes.test.mjs`.

### Branch management

**The `main` branch is the default collaboration branch and accepts feature PRs.** Since this repo encourages product managers and developers to use AI-generated code for rapid validation or idea submission, **please open all PRs targeting the `main` branch**.

### Scope

Keep PRs small and focused. Avoid bundling unrelated changes.

## Testing and Verification

Run the smallest checks that match the changed files and behavior. CI covers
full builds and broad test suites; local prechecks should stay focused unless
the change affects build, packaging, release behavior, or a path CI cannot
protect.

Common local checks:

| Change type | Typical verification |
| --- | --- |
| Repository metadata or GitHub config | `pnpm run check:repo-hygiene && pnpm run check:github-config && git diff --check` |
| Frontend runtime or UI | `pnpm run check:web`, plus the nearest focused test when behavior changed |
| Rust shared runtime or services | Follow the nearest module `AGENTS.md`: one package/test target and the minimum required features |
| Desktop backend / native host integration | `cargo check -p openbitfun-desktop` |
| i18n resources | `pnpm run i18n:audit` |
| i18n contract or shared terms | `pnpm run i18n:generate && pnpm run i18n:contract:test && pnpm run i18n:audit` |

For UI changes, include screenshots or a short recording when helpful. If you
cannot run a relevant check, explain why in the PR and provide a lower-risk
manual verification path.

For desktop UI changes run `cd src/nsh-ui && nsh check && nsh test .`
(`pnpm run e2e:ui`), plus `pnpm run theme:color-audit:all` for theme or color changes.

## Security and Compliance

- Do not commit secrets, tokens, certificates, or any sensitive data
- When adding dependencies, ensure license compatibility and explain the purpose

## Thanks

Every contribution matters. Issues, PRs, and suggestions are all welcome!

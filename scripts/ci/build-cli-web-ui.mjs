#!/usr/bin/env node
// Builds the web UI a release CLI embeds (browsers load the UI from the device
// they control; see `docs/architecture/unified-client-architecture.md`).
//
// Installs the pinned NSH CLI (`scripts/ci/install-nsh.mjs`), packages
// `src/nsh-ui` for the web, writes its `ui-bundle.json`, and exports
// OPENBITFUN_CLI_WEB_UI_DIR to later steps (GITHUB_ENV) so `cargo build -p
// openbitfun-cli` embeds it (`src/apps/cli/build.rs`). Run it after any version
// patch: the manifest records the root package.json version.
//
// Usage: node scripts/ci/build-cli-web-ui.mjs [--out <dir>] [--product <id>]
import { execFileSync } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsh } from './install-nsh.mjs';
import { writeUiBundleManifest } from '../write-ui-bundle-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function buildCliWebUi({ out = path.join(root, 'target', 'cli-web-ui'), product } = {}) {
  const { bin, version } = await installNsh();
  const nsh = path.join(bin, process.platform === 'win32' ? 'nsh.exe' : 'nsh');
  rmSync(out, { recursive: true, force: true });
  execFileSync(nsh, ['package', 'src/nsh-ui/WebApp.tsx', '--target', 'web', '-o', out], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  const nshVersion = version.split(/\s+/)[1] ?? undefined;
  const { bundleDir, bundleId } = writeUiBundleManifest(out, { product, nsh: nshVersion });
  console.log(`[cli-web-ui] ${bundleDir} (bundle ${bundleId})`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `OPENBITFUN_CLI_WEB_UI_DIR=${bundleDir}\n`);
  return { bundleDir, bundleId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = option(args, 'out');
  buildCliWebUi({ out: out ? path.resolve(out) : undefined, product: option(args, 'product') }).catch((error) => {
    console.error(`[cli-web-ui] ${error.message}`);
    process.exitCode = 1;
  });
}

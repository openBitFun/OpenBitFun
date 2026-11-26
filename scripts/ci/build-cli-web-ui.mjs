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
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNsh } from './install-nsh.mjs';
import {
  buildDesktopWebUi,
  computeDesktopWebSourceFingerprint,
  planDesktopWebBuild,
  readNshVersion,
  resolveNshEnvironment,
} from '../build-desktop-web-ui.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function findReusableWebBundle({ out, explicitOut, fingerprint, env }) {
  const candidates = explicitOut
    ? [out]
    : [out, path.join(root, 'target', 'desktop-nsh', 'web-release'), path.join(root, 'target', 'desktop-nsh', 'web')];
  for (const candidate of candidates) {
    const plan = planDesktopWebBuild({ outDir: candidate, fingerprint, force: false, env });
    if (!plan.shouldBuild && plan.bundleId) {
      const stampPath = path.join(candidate, '.build-stamp.json');
      if (!existsSync(stampPath)) continue;
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
      const bundleDir = path.join(candidate, stamp.bundleDirName);
      if (existsSync(path.join(bundleDir, 'index.html'))) {
        return { bundleDir, bundleId: plan.bundleId };
      }
    }
  }
  return null;
}

export async function buildCliWebUi({ out = path.join(root, 'target', 'cli-web-ui'), explicitOut = false, product } = {}) {
  const ensured = await ensureNsh();
  const env = resolveNshEnvironment(
    ensured?.bin
      ? { ...process.env, PATH: `${ensured.bin}${path.delimiter}${process.env.PATH ?? ''}` }
      : process.env,
  );
  const nshVersion = readNshVersion(env);
  const fingerprint = computeDesktopWebSourceFingerprint({ rootDir: root, nshVersion, product });
  const reused = findReusableWebBundle({ out, explicitOut, fingerprint, env });
  const result = reused
    ? { bundleDir: reused.bundleDir, bundleId: reused.bundleId, reused: true }
    : buildDesktopWebUi({ rootDir: root, outDir: out, product, env });
  const { bundleDir, bundleId } = result;
  console.log(`[cli-web-ui] ${bundleDir} (bundle ${bundleId}${result.reused ? ', reused' : ''})`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `OPENBITFUN_CLI_WEB_UI_DIR=${bundleDir}\n`);
  return { bundleDir, bundleId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = option(args, 'out');
  buildCliWebUi({
    ...(out ? { out: path.resolve(out), explicitOut: true } : {}),
    product: option(args, 'product'),
  }).catch((error) => {
    console.error(`[cli-web-ui] ${error.message}`);
    process.exitCode = 1;
  });
}

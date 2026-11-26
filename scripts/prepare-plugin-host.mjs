#!/usr/bin/env node
// Incrementally prepares the OpenCode extension Host bundle
// (`src/apps/extension-host/dist/extension-host.js`).
//
// `cli:dev`, `cli:build`, `server:dev`, `server:build`, and desktop packaging
// all depend on this bundle. Running `bun install --frozen-lockfile` + `bun run
// build` unconditionally adds ~1.5s to every warm invocation; this script
// fingerprints the lockfile/manifest and source inputs and skips already-fresh
// install/build steps.
//
// Usage: node scripts/prepare-plugin-host.mjs [--force]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOST_DIR = path.join(ROOT, 'src', 'apps', 'extension-host');
const INSTALL_STAMP_FILE = '.openbitfun-install-stamp.json';
const BUILD_STAMP_FILE = '.openbitfun-build-stamp.json';
const STAMP_SCHEMA = 1;

function collectFiles(dir, prefix = '', out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, relative, out);
    } else if (entry.isFile()) {
      out.push({ relative, full });
    }
  }
  return out;
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function computePluginHostFingerprints(hostDir = DEFAULT_HOST_DIR) {
  const installHash = createHash('sha256');
  installHash.update(`schema:${STAMP_SCHEMA}\n`);
  for (const name of ['package.json', 'bun.lock']) {
    const full = path.join(hostDir, name);
    if (existsSync(full)) {
      installHash.update(`file:${name}\0`);
      installHash.update(readFileSync(full));
      installHash.update('\0');
    }
  }
  const installFingerprint = installHash.digest('hex');

  const buildHash = createHash('sha256');
  buildHash.update(`schema:${STAMP_SCHEMA}\ninstall:${installFingerprint}\n`);
  const tsconfig = path.join(hostDir, 'tsconfig.json');
  if (existsSync(tsconfig)) {
    buildHash.update('file:tsconfig.json\0');
    buildHash.update(readFileSync(tsconfig));
    buildHash.update('\0');
  }
  for (const entry of collectFiles(path.join(hostDir, 'src'))) {
    buildHash.update(`file:src/${entry.relative}\0`);
    buildHash.update(readFileSync(entry.full));
    buildHash.update('\0');
  }
  return {
    installFingerprint,
    buildFingerprint: buildHash.digest('hex'),
  };
}

export function planPluginHostPrepare({ hostDir = DEFAULT_HOST_DIR, force = false } = {}) {
  const { installFingerprint, buildFingerprint } = computePluginHostFingerprints(hostDir);
  const nodeModulesDir = path.join(hostDir, 'node_modules');
  const installStampPath = path.join(nodeModulesDir, INSTALL_STAMP_FILE);
  const distEntry = path.join(hostDir, 'dist', 'extension-host.js');
  const buildStampPath = path.join(hostDir, 'dist', BUILD_STAMP_FILE);

  const installStamp = readJsonSafe(installStampPath);
  const needsInstall =
    force ||
    !existsSync(nodeModulesDir) ||
    installStamp?.schema !== STAMP_SCHEMA ||
    installStamp?.fingerprint !== installFingerprint;

  const buildStamp = readJsonSafe(buildStampPath);
  const needsBuild =
    force ||
    needsInstall ||
    !existsSync(distEntry) ||
    buildStamp?.schema !== STAMP_SCHEMA ||
    buildStamp?.fingerprint !== buildFingerprint;

  return {
    needsInstall,
    needsBuild,
    installFingerprint,
    buildFingerprint,
    installStampPath,
    buildStampPath,
    distEntry,
  };
}

export function hasBun({ env = process.env, run = spawnSync } = {}) {
  const probe = run('bun', ['--version'], {
    encoding: 'utf8',
    env,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return !probe.error && probe.status === 0;
}

export function preparePluginHost({
  hostDir = DEFAULT_HOST_DIR,
  force = false,
  optional = false,
  env = process.env,
  run = spawnSync,
} = {}) {
  const plan = planPluginHostPrepare({ hostDir, force });
  if (!plan.needsInstall && !plan.needsBuild) {
    console.log('[plugin-host] Up to date.');
    return { installed: false, built: false, skipped: false, distEntry: plan.distEntry };
  }

  if (optional && !hasBun({ env, run })) {
    console.warn('[plugin-host] bun not found on PATH; skipping optional plugin-host build.');
    return { installed: false, built: false, skipped: true, distEntry: plan.distEntry };
  }

  const execBun = (args, label) => {
    const result = run('bun', args, {
      cwd: hostDir,
      env,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `plugin-host ${label} failed (${result.error?.message ?? `status ${result.status}`})`,
      );
    }
  };

  if (plan.needsInstall) {
    console.log('[plugin-host] Installing dependencies...');
    execBun(['install', '--frozen-lockfile'], 'install');
    mkdirSync(path.dirname(plan.installStampPath), { recursive: true });
    writeFileSync(
      plan.installStampPath,
      `${JSON.stringify({ schema: STAMP_SCHEMA, fingerprint: plan.installFingerprint }, null, 2)}\n`,
    );
  }

  if (plan.needsBuild) {
    console.log('[plugin-host] Building extension-host.js...');
    execBun(['run', 'build'], 'build');
    if (!existsSync(plan.distEntry)) {
      throw new Error(`plugin-host build did not produce ${plan.distEntry}`);
    }
    mkdirSync(path.dirname(plan.buildStampPath), { recursive: true });
    writeFileSync(
      plan.buildStampPath,
      `${JSON.stringify({ schema: STAMP_SCHEMA, fingerprint: plan.buildFingerprint }, null, 2)}\n`,
    );
  }

  return {
    installed: plan.needsInstall,
    built: plan.needsBuild,
    skipped: false,
    distEntry: plan.distEntry,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    preparePluginHost({
      force: args.includes('--force'),
      optional: args.includes('--optional'),
    });
  } catch (error) {
    console.error(`[plugin-host] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

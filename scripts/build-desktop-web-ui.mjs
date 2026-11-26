#!/usr/bin/env node
// Builds the desktop dev web UI bundle (`target/desktop-nsh/web/OpenBitFun`)
// from `src/nsh-ui/WebApp.tsx` and writes its `ui-bundle.json` manifest.
//
// In development builds (`pnpm run desktop:dev` / `desktop-nsh:build`), the
// native desktop serves `target/desktop-nsh/web/OpenBitFun` to browsers over
// OBP (`src/apps/desktop/src/backend_protocol/ws/mod.rs`). Running this step
// inside `desktop-nsh:build` keeps the web UI bundle in lockstep with the
// native bundle (`target/desktop-nsh/nsh`), while skipping the ~14s repackage
// whenever `src/nsh-ui` inputs have not changed.
//
// Staging into a clean sibling directory and swapping atomically ensures:
//   1. No stale hashed assets from older builds leak into `ui-bundle.json`.
//   2. A running dev desktop process (`UiBundleSource::current`) never observes
//      a half-written directory and immediately reloads the new `bundleId`.
//
// Usage: node scripts/build-desktop-web-ui.mjs [--force] [--out <dir>]
// Set OPENBITFUN_DESKTOP_WEB_UI=off to skip in local workflows.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, readUiBundleManifest, writeUiBundleManifest } from './write-ui-bundle-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'target', 'desktop-nsh', 'web');
const STAMP_FILE = '.build-stamp.json';
const STAMP_SCHEMA = 1;
const SKIP_DIRS = new Set(['.nsh', 'node_modules', 'test']);

export function resolveNshEnvironment(env = process.env, home = homedir()) {
  const nshBin = path.join(home, '.nsh', 'bin');
  const currentPath = env.PATH ?? env.Path ?? '';
  const segments = currentPath.split(path.delimiter).filter(Boolean);
  if (!existsSync(nshBin) || segments.includes(nshBin)) {
    return { ...env };
  }
  const nextPath = [nshBin, ...segments].join(path.delimiter);
  return {
    ...env,
    PATH: nextPath,
    ...(env.Path !== undefined ? { Path: nextPath } : {}),
  };
}

export function readNshVersion(env = process.env) {
  const result = spawnSync('nsh', ['--version'], {
    encoding: 'utf8',
    env,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return String(result.stdout ?? '').match(/\b(\d+\.\d+\.\d+[^\s]*)/)?.[1] ?? 'unknown';
}

function isIgnoredSourceEntry(name, isDirectory, skipDirs = SKIP_DIRS) {
  if (name.startsWith('.')) return true;
  if (isDirectory) return skipDirs.has(name);
  return /\.test\.[^.]+$/i.test(name);
}

export function collectSourceFiles(dir, prefix = '', out = [], skipDirs = SKIP_DIRS) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (isIgnoredSourceEntry(entry.name, entry.isDirectory(), skipDirs)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, relative, out, skipDirs);
    } else if (entry.isFile()) {
      out.push({ relative, full });
    }
  }
  return out;
}

/**
 * Deterministic content fingerprint over `src/nsh-ui` runtime sources,
 * `package.json`'s `version`, `scripts/write-ui-bundle-manifest.mjs`, and the
 * active NSH CLI version.
 */
export function computeDesktopWebSourceFingerprint({
  rootDir = ROOT,
  nshVersion = 'unknown',
  product = undefined,
} = {}) {
  const hash = createHash('sha256');
  const pkgPath = path.join(rootDir, 'package.json');
  const version = existsSync(pkgPath) ? String(JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '0.0.0') : '0.0.0';
  hash.update(`schema:${STAMP_SCHEMA}\nversion:${version}\nnsh:${nshVersion}\n`);
  if (product && product !== 'openbitfun') {
    hash.update(`product:${product}\n`);
  }

  const manifestWriterPath = path.join(rootDir, 'scripts', 'write-ui-bundle-manifest.mjs');
  if (existsSync(manifestWriterPath)) {
    hash.update('file:scripts/write-ui-bundle-manifest.mjs\0');
    hash.update(readFileSync(manifestWriterPath));
    hash.update('\0');
  }

  const uiDir = path.join(rootDir, 'src', 'nsh-ui');
  for (const entry of collectSourceFiles(uiDir)) {
    hash.update(`file:src/nsh-ui/${entry.relative}\0`);
    hash.update(readFileSync(entry.full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function planDesktopWebBuild({
  outDir = DEFAULT_OUT_DIR,
  fingerprint,
  force = false,
  env = process.env,
} = {}) {
  const flag = String(env.OPENBITFUN_DESKTOP_WEB_UI ?? '').trim().toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') {
    return { shouldBuild: false, reason: 'disabled via OPENBITFUN_DESKTOP_WEB_UI=off', bundleId: null };
  }
  if (force) {
    return { shouldBuild: true, reason: 'forced rebuild (--force)', bundleId: null };
  }
  const stampPath = path.join(outDir, STAMP_FILE);
  if (!existsSync(stampPath)) {
    return { shouldBuild: true, reason: 'missing build stamp', bundleId: null };
  }
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return { shouldBuild: true, reason: 'unreadable build stamp', bundleId: null };
  }
  if (stamp?.schema !== STAMP_SCHEMA || stamp?.fingerprint !== fingerprint || typeof stamp?.bundleDirName !== 'string') {
    return { shouldBuild: true, reason: 'web UI sources changed', bundleId: null };
  }
  const bundleDir = path.join(outDir, stamp.bundleDirName);
  if (!existsSync(path.join(bundleDir, 'index.html')) || !existsSync(path.join(bundleDir, MANIFEST_FILE))) {
    return { shouldBuild: true, reason: 'web bundle output incomplete', bundleId: null };
  }
  try {
    const { bundleId } = readUiBundleManifest(bundleDir);
    if (bundleId !== stamp.bundleId) {
      return { shouldBuild: true, reason: 'web bundle manifest drifted', bundleId: null };
    }
    return { shouldBuild: false, reason: 'up to date', bundleId };
  } catch {
    return { shouldBuild: true, reason: 'invalid web bundle manifest', bundleId: null };
  }
}

export function swapBundleDirectory(stagedBundleDir, targetOutDir) {
  const bundleDirName = path.basename(stagedBundleDir);
  const finalBundleDir = path.join(targetOutDir, bundleDirName);
  const backupDir = path.join(targetOutDir, `.${bundleDirName}.prev-${process.pid}-${Date.now()}`);
  mkdirSync(targetOutDir, { recursive: true });
  const hadExisting = existsSync(finalBundleDir);
  if (hadExisting) {
    renameSync(finalBundleDir, backupDir);
  }
  try {
    renameSync(stagedBundleDir, finalBundleDir);
  } catch (error) {
    if (hadExisting && !existsSync(finalBundleDir) && existsSync(backupDir)) {
      renameSync(backupDir, finalBundleDir);
    }
    throw error;
  }
  if (hadExisting) {
    rmSync(backupDir, { recursive: true, force: true });
  }
  return { bundleDirName, finalBundleDir };
}

function finalizeStagedWebBundle({ rootDir, outDir, stagingDir, fingerprint, nsh, product }) {
  const { bundleDir: stagedBundleDir, bundleId } = writeUiBundleManifest(stagingDir, {
    nsh,
    ...(product ? { product } : {}),
  });
  const { bundleDirName, finalBundleDir } = swapBundleDirectory(stagedBundleDir, outDir);
  writeFileSync(
    path.join(outDir, STAMP_FILE),
    `${JSON.stringify({ schema: STAMP_SCHEMA, fingerprint, bundleDirName, bundleId, nsh, ...(product ? { product } : {}) }, null, 2)}\n`,
  );
  console.log(`[desktop-web] Ready: ${path.relative(rootDir, finalBundleDir)} (bundleId ${bundleId})`);
  return { built: true, bundleId, bundleDir: finalBundleDir };
}

export function buildDesktopWebUi({
  rootDir = ROOT,
  outDir = DEFAULT_OUT_DIR,
  force = false,
  product = undefined,
  env = process.env,
} = {}) {
  const nshEnv = resolveNshEnvironment(env);
  const nsh = readNshVersion(nshEnv);
  const fingerprint = computeDesktopWebSourceFingerprint({ rootDir, nshVersion: nsh, product });
  const plan = planDesktopWebBuild({ outDir, fingerprint, force, env: nshEnv });
  if (!plan.shouldBuild) {
    const stampPath = path.join(outDir, STAMP_FILE);
    const bundleDirName = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')).bundleDirName : null;
    console.log(`[desktop-web] Web UI bundle ${plan.reason}${plan.bundleId ? ` (bundleId ${plan.bundleId})` : ''}`);
    return {
      built: false,
      bundleId: plan.bundleId,
      bundleDir: bundleDirName ? path.join(outDir, bundleDirName) : null,
      reason: plan.reason,
    };
  }

  console.log(`[desktop-web] Building web UI bundle (${plan.reason})...`);
  const stagingDir = `${outDir}.staging-${process.pid}-${Date.now()}`;
  rmSync(stagingDir, { recursive: true, force: true });
  try {
    const built = spawnSync('nsh', ['package', 'src/nsh-ui/WebApp.tsx', '--target', 'web', '-o', stagingDir], {
      cwd: rootDir,
      stdio: 'inherit',
      env: nshEnv,
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (built.error || built.status !== 0) {
      throw new Error(
        `nsh package src/nsh-ui/WebApp.tsx --target web failed (${built.error?.message ?? `status ${built.status ?? 'unknown'}`})`,
      );
    }
    return finalizeStagedWebBundle({ rootDir, outDir, stagingDir, fingerprint, nsh, product });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export async function buildDesktopWebUiAsync({
  rootDir = ROOT,
  outDir = DEFAULT_OUT_DIR,
  force = false,
  product = undefined,
  env = process.env,
} = {}) {
  const nshEnv = resolveNshEnvironment(env);
  const nsh = readNshVersion(nshEnv);
  const fingerprint = computeDesktopWebSourceFingerprint({ rootDir, nshVersion: nsh, product });
  const plan = planDesktopWebBuild({ outDir, fingerprint, force, env: nshEnv });
  if (!plan.shouldBuild) {
    const stampPath = path.join(outDir, STAMP_FILE);
    const bundleDirName = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')).bundleDirName : null;
    console.log(`[desktop-web] Web UI bundle ${plan.reason}${plan.bundleId ? ` (bundleId ${plan.bundleId})` : ''}`);
    return {
      built: false,
      bundleId: plan.bundleId,
      bundleDir: bundleDirName ? path.join(outDir, bundleDirName) : null,
      reason: plan.reason,
    };
  }

  console.log(`[desktop-web] Building web UI bundle (${plan.reason})...`);
  const stagingDir = `${outDir}.staging-${process.pid}-${Date.now()}`;
  rmSync(stagingDir, { recursive: true, force: true });
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('nsh', ['package', 'src/nsh-ui/WebApp.tsx', '--target', 'web', '-o', stagingDir], {
        cwd: rootDir,
        stdio: 'inherit',
        env: nshEnv,
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      child.on('error', rejectPromise);
      child.on('close', (code, signal) => {
        if (code === 0) resolvePromise();
        else {
          rejectPromise(
            new Error(`nsh package src/nsh-ui/WebApp.tsx --target web failed (status ${code ?? signal ?? 'unknown'})`),
          );
        }
      });
    });
    return finalizeStagedWebBundle({ rootDir, outDir, stagingDir, fingerprint, nsh, product });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function parseCliArgs(argv) {
  let force = false;
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      force = true;
    } else if (arg === '--out' && argv[i + 1]) {
      outDir = path.resolve(ROOT, argv[i + 1]);
      i += 1;
    }
  }
  return { force, outDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { force, outDir } = parseCliArgs(process.argv.slice(2));
    buildDesktopWebUi({ force, outDir });
  } catch (error) {
    console.error(`[desktop-web] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

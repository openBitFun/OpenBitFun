#!/usr/bin/env node
// Development loop of the native desktop app: builds the UI bundle, the backend
// library and the runner (`pnpm run desktop-nsh:build`, debug profile), then runs
// `target/debug/openbitfun-nsh` with `NSH_APP_DIR=target/desktop-nsh/nsh`.
//
// Usage: node scripts/desktop-nsh-dev.mjs [--no-build] [--isolated-data | --shared-data]
//   --no-build       reuse the last build (`pnpm run desktop:preview:debug`)
//   --isolated-data  keep settings, workspaces and sessions in this checkout's
//                    `.openbitfun/desktop-dev/` instead of the installed app's data
//   --shared-data    the default: the installed app's data
// Explicit OPENBITFUN_USER_ROOT / OPENBITFUN_HOME values take precedence.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_DESKTOP_RUST_VERSION = [1, 97];
export const DEFAULT_DESKTOP_RUSTUP_TOOLCHAIN = '1.98.1';

export function parseRustcVersion(output) {
  const match = String(output ?? '').match(/\brustc\s+(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function meetsMinRustVersion(parsed, min = MIN_DESKTOP_RUST_VERSION) {
  if (!parsed) return false;
  if (parsed[0] !== min[0]) return parsed[0] > min[0];
  return parsed[1] >= min[1];
}

function defaultReadCommandStdout(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

export function resolveDesktopDevRustEnvironment(
  env = process.env,
  {
    readRustcVersion = () => defaultReadCommandStdout('rustc', ['--version']),
    readRustupToolchains = () => defaultReadCommandStdout('rustup', ['toolchain', 'list']),
  } = {},
) {
  if (env.RUSTUP_TOOLCHAIN) return {};
  const rustcOut = readRustcVersion();
  if (meetsMinRustVersion(parseRustcVersion(rustcOut))) return {};
  const toolchains = String(readRustupToolchains() ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (toolchains.some((line) => line.startsWith(DEFAULT_DESKTOP_RUSTUP_TOOLCHAIN))) {
    return { RUSTUP_TOOLCHAIN: DEFAULT_DESKTOP_RUSTUP_TOOLCHAIN };
  }
  const minText = MIN_DESKTOP_RUST_VERSION.join('.');
  throw new Error(
    `Native desktop requires Rust >= ${minText} (default rustc: ${rustcOut ?? 'not found'}). ` +
      `Run "rustup toolchain install ${DEFAULT_DESKTOP_RUSTUP_TOOLCHAIN}" or set RUSTUP_TOOLCHAIN.`,
  );
}

/**
 * Stamps the dev NSH bundle (`target/desktop-nsh/nsh`) with OpenBitFun's app
 * name and 1.0.x icon so running the unbundled runner (`openbitfun-nsh`) shows
 * the real OpenBitFun Dock / taskbar icon instead of the OS generic executable icon.
 */
export function stampDevAppIdentity(appDir, rootDir = ROOT, platform = process.platform) {
  const appJsonPath = path.join(appDir, 'app.json');
  if (existsSync(appJsonPath)) {
    const manifest = JSON.parse(readFileSync(appJsonPath, 'utf8'));
    let changed = false;
    if (!manifest.name) {
      manifest.name = 'OpenBitFun';
      changed = true;
    }
    if (platform === 'darwin') {
      const macIcon = path.join(rootDir, 'src', 'apps', 'desktop', 'icons', 'openbitfun-app-icon.icns');
      if (existsSync(macIcon) && manifest.icon !== macIcon) {
        manifest.icon = macIcon;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(appJsonPath, `${JSON.stringify(manifest)}\n`);
    }
  }
  if (platform === 'win32') {
    const winIcon = path.join(rootDir, 'src', 'apps', 'desktop', 'icons', 'openbitfun-app-icon.ico');
    const destIcon = path.join(appDir, 'icon.ico');
    if (existsSync(winIcon)) {
      copyFileSync(winIcon, destIcon);
    }
  }
}

export function resolveDesktopDevDataMode(args = []) {
  if (args.includes('--shared-data') && args.includes('--isolated-data')) {
    throw new Error('Choose only one of --shared-data or --isolated-data');
  }
  return args.includes('--isolated-data') ? 'isolated' : 'shared';
}

export function resolveDesktopDevStorageEnvironment(env = process.env, rootDir = ROOT, dataMode = 'shared') {
  // Shared mode leaves path selection to the app, including caller overrides.
  if (dataMode === 'shared') return {};
  const storageDir = path.join(rootDir, '.openbitfun', 'desktop-dev');
  return {
    OPENBITFUN_USER_ROOT: env.OPENBITFUN_USER_ROOT || path.join(storageDir, 'user'),
    OPENBITFUN_HOME: env.OPENBITFUN_HOME || path.join(storageDir, 'home'),
  };
}

function main(args) {
  const appDir = path.join(ROOT, 'target', 'desktop-nsh', 'nsh');
  if (args.includes('--stamp-only')) {
    stampDevAppIdentity(appDir, ROOT);
    return;
  }
  const dataMode = resolveDesktopDevDataMode(args);
  if (!args.includes('--no-build')) {
    const rustEnv = resolveDesktopDevRustEnvironment(process.env);
    if (rustEnv.RUSTUP_TOOLCHAIN) {
      console.log(
        `[desktop-dev] Using RUSTUP_TOOLCHAIN=${rustEnv.RUSTUP_TOOLCHAIN} (native desktop requires Rust >= ${MIN_DESKTOP_RUST_VERSION.join('.')})`,
      );
    }
    const build = spawnSync('pnpm', ['run', 'desktop-nsh:build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env, ...rustEnv },
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const runner = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'openbitfun-nsh.exe' : 'openbitfun-nsh');
  for (const [file, hint] of [[runner, 'pnpm run desktop-nsh:build'], [appDir, 'pnpm run desktop-nsh:bundle']]) {
    if (!existsSync(file)) {
      console.error(`[desktop-dev] Missing ${path.relative(ROOT, file)}; run ${hint} first.`);
      process.exit(1);
    }
  }
  stampDevAppIdentity(appDir, ROOT);
  const storage = resolveDesktopDevStorageEnvironment(process.env, ROOT, dataMode);
  console.log(`[desktop-dev] Data mode: ${dataMode}${storage.OPENBITFUN_USER_ROOT ? ` (${storage.OPENBITFUN_USER_ROOT})` : ''}`);
  const child = spawn(runner, [], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...storage, NSH_APP_DIR: appDir },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(`[desktop-dev] ${error.message}`);
    process.exit(1);
  }
}

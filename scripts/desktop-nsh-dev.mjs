#!/usr/bin/env node
// Development loop of the native desktop app: builds the UI bundle, the backend
// library and the runner (`pnpm run desktop-nsh:build:dev`, the `desktop-dev` cargo
// profile: debug assertions and line tables, optimized dependencies), then runs
// `target/desktop-dev/openbitfun-nsh` with `NSH_APP_DIR=target/desktop-nsh/nsh`.
//
// Usage: node scripts/desktop-nsh-dev.mjs [--no-build] [--isolated-data | --shared-data]
//   --no-build       reuse the last build (`pnpm run desktop:preview:debug`)
//   --isolated-data  keep settings, workspaces and sessions in this checkout's
//                    `.openbitfun/desktop-dev/` instead of the installed app's data
//   --shared-data    the default: the installed app's data
// Explicit OPENBITFUN_USER_ROOT / OPENBITFUN_HOME values take precedence.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function main(args) {
  const appDir = path.join(ROOT, 'target', 'desktop-nsh', 'nsh');
  if (args.includes('--bundle-only')) {
    const { buildNativeUi } = await import('./desktop-nsh-package-common.mjs');
    buildNativeUi({ nshOut: appDir });
    stampDevAppIdentity(appDir, ROOT);
    return;
  }
  if (args.includes('--stamp-only')) {
    stampDevAppIdentity(appDir, ROOT);
    return;
  }
  const dataMode = resolveDesktopDevDataMode(args);
  if (!args.includes('--no-build')) {
    const build = spawnSync('pnpm', ['run', 'desktop-nsh:build:dev'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const runner = path.join(ROOT, 'target', 'desktop-dev', process.platform === 'win32' ? 'openbitfun-nsh.exe' : 'openbitfun-nsh');
  for (const [file, hint] of [[runner, 'pnpm run desktop-nsh:build:dev'], [appDir, 'pnpm run desktop-nsh:bundle']]) {
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
    await main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(`[desktop-dev] ${error.message}`);
    process.exit(1);
  }
}

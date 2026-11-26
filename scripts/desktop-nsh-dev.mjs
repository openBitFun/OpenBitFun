#!/usr/bin/env node
// Development loop of the native desktop app: builds the UI bundle, the backend
// library and the runner (`pnpm run desktop-nsh:build:dev`, the `desktop-dev` cargo
// profile: debug assertions and line tables, optimized dependencies), then runs
// `target/desktop-dev/openbitfun-nsh` with `NSH_APP_DIR=target/desktop-nsh/nsh`.
//
// Usage: node scripts/desktop-nsh-dev.mjs [--no-build] [--no-web | --wait-web] [--force] [--isolated-data | --shared-data]
//   --no-build       reuse the last build (`pnpm run desktop:preview:debug`)
//   --no-web         skip building/refreshing the dev web UI bundle
//   --wait-web       wait for the dev web UI bundle before launching (default:
//                    refresh in the background when a web bundle already exists,
//                    since `UiBundleSource::current` reloads atomic swaps live)
//   --force          bypass native/web UI build fingerprint caches
//   --isolated-data  keep settings, workspaces and sessions in this checkout's
//                    `.openbitfun/desktop-dev/` instead of the installed app's data
//   --shared-data    the default: the installed app's data
// Explicit OPENBITFUN_USER_ROOT / OPENBITFUN_HOME values take precedence.
import { spawn } from 'node:child_process';
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

export function resolveDesktopDevWebMode(args = [], env = process.env, hasExistingWebBundle = false) {
  if (args.includes('--no-web') && args.includes('--wait-web')) {
    throw new Error('Choose only one of --no-web or --wait-web');
  }
  const flag = String(env.OPENBITFUN_DESKTOP_WEB_UI ?? '').trim().toLowerCase();
  if (args.includes('--no-web') || flag === 'off' || flag === '0' || flag === 'false') {
    return 'off';
  }
  if (args.includes('--wait-web')) return 'sync';
  return hasExistingWebBundle ? 'background' : 'sync';
}

async function main(args) {
  const appDir = path.join(ROOT, 'target', 'desktop-nsh', 'nsh');
  const force = args.includes('--force');
  if (args.includes('--bundle-only')) {
    const { buildNativeUi } = await import('./desktop-nsh-package-common.mjs');
    buildNativeUi({ nshOut: appDir, force });
    stampDevAppIdentity(appDir, ROOT);
    return;
  }
  if (args.includes('--stamp-only')) {
    stampDevAppIdentity(appDir, ROOT);
    return;
  }
  const dataMode = resolveDesktopDevDataMode(args);
  const noBuild = args.includes('--no-build');
  const webOutDir = path.join(ROOT, 'target', 'desktop-nsh', 'web');
  const hasExistingWebBundle = existsSync(path.join(webOutDir, 'OpenBitFun', 'index.html'));
  const webMode = resolveDesktopDevWebMode(args, process.env, hasExistingWebBundle);

  let backgroundWebChild = null;
  if (!noBuild) {
    const { runDesktopNshBuild } = await import('./desktop-nsh-build.mjs');
    // In background mode, launch the native desktop without blocking ~15s on
    // `nsh package --target web`; start the web refresh asynchronously if stale.
    if (webMode === 'background') {
      const {
        computeDesktopWebSourceFingerprint,
        planDesktopWebBuild,
        readNshVersion,
        resolveNshEnvironment,
      } = await import('./build-desktop-web-ui.mjs');
      const nshEnv = resolveNshEnvironment(process.env);
      const fingerprint = computeDesktopWebSourceFingerprint({ rootDir: ROOT, nshVersion: readNshVersion(nshEnv) });
      const webPlan = planDesktopWebBuild({ outDir: webOutDir, fingerprint, force, env: nshEnv });
      if (webPlan.shouldBuild) {
        console.log(`[desktop-dev] Refreshing web UI bundle in background (${webPlan.reason})...`);
        backgroundWebChild = spawn(
          process.execPath,
          [path.join(ROOT, 'scripts', 'build-desktop-web-ui.mjs'), ...(force ? ['--force'] : [])],
          { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: nshEnv },
        );
        backgroundWebChild.on('exit', () => {
          backgroundWebChild = null;
        });
      }
    }
    await runDesktopNshBuild({
      profile: 'desktop-dev',
      skipWeb: webMode !== 'sync',
      force,
    });
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
  const stopChildren = (signal) => {
    child.kill(signal);
    if (backgroundWebChild && !backgroundWebChild.killed) {
      backgroundWebChild.kill(signal);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stopChildren(signal));
  }
  child.on('exit', async (code, signal) => {
    if (backgroundWebChild && !backgroundWebChild.killed) {
      backgroundWebChild.kill('SIGTERM');
    }
    if (!noBuild) {
      try {
        const { runDesktopTargetGc } = await import('./desktop-nsh-package-common.mjs');
        runDesktopTargetGc({ profile: 'desktop-dev' });
      } catch {
        // Best-effort GC must never fail dev exit.
      }
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(`[desktop-dev] ${error.message}`);
    process.exit(1);
  }
}

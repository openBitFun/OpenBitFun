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
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const dataMode = resolveDesktopDevDataMode(args);
  if (!args.includes('--no-build')) {
    const build = spawnSync('pnpm', ['run', 'desktop-nsh:build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const runner = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'openbitfun-nsh.exe' : 'openbitfun-nsh');
  const appDir = path.join(ROOT, 'target', 'desktop-nsh', 'nsh');
  for (const [file, hint] of [[runner, 'pnpm run desktop-nsh:build'], [appDir, 'pnpm run desktop-nsh:bundle']]) {
    if (!existsSync(file)) {
      console.error(`[desktop-dev] Missing ${path.relative(ROOT, file)}; run ${hint} first.`);
      process.exit(1);
    }
  }
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

#!/usr/bin/env node
// Parallel incremental build for the native NSH desktop app (`desktop-nsh:build`
// and `desktop-nsh:build:dev`).
//
// Runs all independent build stages concurrently:
//   1. Native NSH UI bundle (`target/desktop-nsh/nsh`, content-fingerprint cached)
//   2. Web UI bundle (`target/desktop-nsh/web`, content-fingerprint cached;
//      skip with `--no-web` or `OPENBITFUN_DESKTOP_WEB_UI=off`)
//   3. Desktop backend library (`openbitfun-desktop --lib`, root `target/`)
//   4. NSH runner (`src/apps/desktop-nsh/native`, isolated `target/desktop-nsh-runner`,
//      staged next to the backend library in `target/<profile>/openbitfun-nsh`)
//
// Usage:
//   node scripts/desktop-nsh-build.mjs [--profile dev|desktop-dev|release|release-fast]
//     [--target <triple>] [--no-web] [--force]

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDesktopWebUiAsync } from './build-desktop-web-ui.mjs';
import {
  backendCargoArgs,
  buildNativeUiAsync,
  root,
  runAsync,
  runnerCargoArgs,
  shouldParallelizeCargo,
  stageRunnerBinary,
  stampDevAppIdentity,
} from './desktop-nsh-package-common.mjs';

export function parseDesktopBuildArgs(argv = []) {
  const args = argv.filter((arg) => arg !== '--');
  const readValue = (flag) => {
    const inline = args.find((arg) => arg.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
  };
  const profile = readValue('--profile') ?? 'dev';
  return {
    profile,
    profileDir: profile === 'dev' ? 'debug' : profile,
    target: readValue('--target'),
    skipWeb: args.includes('--no-web'),
    force: args.includes('--force'),
  };
}

export async function runDesktopNshBuild(options = {}) {
  const {
    profile = 'dev',
    profileDir = profile === 'dev' ? 'debug' : profile,
    target = undefined,
    skipWeb = false,
    force = false,
    env = process.env,
  } = options;

  const startedAt = performance.now();
  const timings = {};
  const timed = async (label, fn) => {
    const t0 = performance.now();
    const result = await fn();
    timings[label] = ((performance.now() - t0) / 1000).toFixed(2);
    return result;
  };

  const appDir = path.join(root, 'target', 'desktop-nsh', 'nsh');
  const parallelCargo = shouldParallelizeCargo({ profile, env });

  const nativeUiTask = timed('native-ui', async () => {
    await buildNativeUiAsync({ nshOut: appDir, target, release: false, force, env });
    stampDevAppIdentity(appDir, root);
  });

  const webUiTask = skipWeb
    ? Promise.resolve()
    : timed('web-ui', () => buildDesktopWebUiAsync({ force, env }));

  const backendTask = () =>
    timed('backend', () => runAsync('cargo', backendCargoArgs({ profile, target }), { env }));

  const runnerTask = () =>
    timed('runner', async () => {
      await runAsync('cargo', runnerCargoArgs({ profile, target, env }), { env });
      stageRunnerBinary({ profileDir, target, env });
    });

  if (parallelCargo) {
    await Promise.all([nativeUiTask, webUiTask, backendTask(), runnerTask()]);
  } else {
    await Promise.all([nativeUiTask, webUiTask, backendTask()]);
    await runnerTask();
  }

  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
  const breakdown = Object.entries(timings)
    .map(([key, secs]) => `${key}=${secs}s`)
    .join(', ');
  console.log(`[desktop-build] Ready (${profile}) in ${elapsed}s (${breakdown})`);
  return { elapsed: Number(elapsed), timings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDesktopNshBuild(parseDesktopBuildArgs(process.argv.slice(2))).catch((error) => {
    console.error(`[desktop-build] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

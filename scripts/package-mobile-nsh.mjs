#!/usr/bin/env node
// Builds the NSH phone app (`src/apps/mobile-nsh`): the shared UI with the
// `openbitfun/mobile` native module (Link controller, device key, OBP client).
//
// Usage: node scripts/package-mobile-nsh.mjs <ios-simulator|ios|android> [--run] [nsh package flags...]
//   ios-simulator  an ad hoc signed `.app` for the simulator (`--run` installs and launches it)
//   ios            a signed `.ipa` (`--sign "Apple Distribution: ..." --profile x.mobileprovision`),
//                  or an unsigned `.app` without `--sign`
//   android        an `.apk` (`--keystore`, `--key-alias` for release; the debug key otherwise);
//                  needs the Android SDK (platform 35), the NDK (ANDROID_NDK_HOME), a JDK and
//                  the Rust targets of its ABIs (default arm64-v8a and armeabi-v7a; `--abi`)
// Output: target/mobile-nsh/<target>/, or `-o <dir>`. NSH needs Rust 1.97 or newer.
import { spawnSync } from 'node:child_process';
import { syncVendorAssets } from './sync-nsh-vendor-assets.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'src', 'apps', 'mobile-nsh');
export const MOBILE_TARGETS = ['ios-simulator', 'ios', 'android'];

export function mobilePackageCommand(args, env = process.env) {
  const [target, ...rest] = args;
  if (!MOBILE_TARGETS.includes(target)) {
    throw new Error(`Choose a target: ${MOBILE_TARGETS.join(', ')}`);
  }
  // `-o <dir>` / `--out <dir>` replaces the default output directory.
  const outIndex = rest.findIndex((arg) => arg === '-o' || arg === '--out');
  const out =
    outIndex >= 0 && rest[outIndex + 1]
      ? path.resolve(rest[outIndex + 1])
      : path.join(ROOT, 'target', 'mobile-nsh', target);
  const flags =
    outIndex >= 0
      ? rest.filter((_, index) => index !== outIndex && index !== outIndex + 1)
      : rest;
  return {
    command: 'nsh',
    args: ['package', APP_DIR, '--target', target, '-o', out, ...flags],
    env,
    out,
  };
}

function main(args) {
  const { command, args: nshArgs, env, out } = mobilePackageCommand(args);
  // The app ships its own copy of the shared UI's document renderers.
  syncVendorAssets();
  console.log(`[mobile-nsh] nsh ${nshArgs.join(' ')}`);
  const result = spawnSync(command, nshArgs, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[mobile-nsh] could not run nsh: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status === 0) console.log(`[mobile-nsh] output: ${path.relative(ROOT, out)}`);
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(`[mobile-nsh] ${error.message}`);
    process.exit(1);
  }
}

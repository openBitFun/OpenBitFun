#!/usr/bin/env node
// Packages the native desktop app for this machine's OS: forwards every
// argument (`--profile release|release-fast`, `--target <triple>`,
// `--skip-build`, `--updater-archive`) to `package-desktop-nsh-<os>.mjs`.
// `pnpm run desktop:build` and `desktop:build:release-fast` use it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = {
  darwin: 'package-desktop-nsh-macos.mjs',
  win32: 'package-desktop-nsh-windows.mjs',
  linux: 'package-desktop-nsh-linux.mjs',
};

const script = scripts[process.platform];
if (!script) {
  console.error(`[desktop-package] The native desktop app has no package for ${process.platform}`);
  process.exit(1);
}
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const result = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), script), ...args], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);

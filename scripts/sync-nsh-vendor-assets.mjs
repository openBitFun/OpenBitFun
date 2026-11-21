#!/usr/bin/env node
// Copies the NSH UI's vendored document renderers (`src/nsh-ui/assets/vendor`:
// Mermaid, KaTeX) into the native apps that ship the shared UI.
//
// nsh ships only files inside an app's own directory and resolves symlinks
// before it checks, so `src/apps/desktop-nsh` and `src/apps/mobile-nsh` each
// need a real copy under `assets/vendor`. The repository keeps one copy (the
// nsh-ui one); the app copies are gitignored and written here, before every
// native build (`desktop-nsh:bundle`, `desktop-nsh-package-common.mjs`,
// `package-mobile-nsh.mjs`) and after `pnpm install`. Each app registers its
// copy's URLs in its `src/documentRenderers.ts`.
//
//   node scripts/sync-nsh-vendor-assets.mjs [--check]
//
// `--check` writes nothing and fails when an app copy is missing or differs.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
export const VENDOR_SOURCE = join(root, 'src', 'nsh-ui', 'assets', 'vendor');
export const VENDOR_TARGETS = [
  join(root, 'src', 'apps', 'desktop-nsh', 'assets', 'vendor'),
  join(root, 'src', 'apps', 'mobile-nsh', 'assets', 'vendor'),
];

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out.sort();
}

function sameFile(left, right) {
  if (!existsSync(right)) return false;
  if (statSync(left).size !== statSync(right).size) return false;
  return readFileSync(left).equals(readFileSync(right));
}

/** Brings every app copy in line with the source; returns the paths that differed. */
export function syncVendorAssets({ check = false } = {}) {
  const sourceFiles = listFiles(VENDOR_SOURCE);
  if (sourceFiles.length === 0) throw new Error(`no vendored files under ${VENDOR_SOURCE}`);
  const stale = [];
  for (const target of VENDOR_TARGETS) {
    for (const file of sourceFiles) {
      const from = join(VENDOR_SOURCE, file);
      const to = join(target, file);
      if (sameFile(from, to)) continue;
      stale.push(relative(root, to));
      if (!check) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    }
    // A file the source no longer has (an older renderer version) goes too.
    for (const file of listFiles(target)) {
      if (sourceFiles.includes(file)) continue;
      stale.push(relative(root, join(target, file)));
      if (!check) rmSync(join(target, file));
    }
  }
  return stale;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = syncVendorAssets({ check });
  if (check && stale.length > 0) {
    console.error(`[nsh-vendor] app copies are out of date (run node scripts/sync-nsh-vendor-assets.mjs):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[nsh-vendor] ${check ? 'checked' : 'synced'} ${VENDOR_TARGETS.length} app copies (${stale.length} files ${check ? 'stale' : 'written or removed'})`);
}

#!/usr/bin/env node
// Collects the signed in-app updater archives of the native desktop app into
// one flat directory for the release manifest (`generate-tauri-latest-json.mjs`).
//
// The desktop ships only as the native NSH app. Its in-app update package is the
// macOS archive `OpenBitFun-nsh_<version>_<arch>.app.tar.gz` plus its minisign
// `.sig` (`scripts/ci/package-native-macos-release.sh`). Windows and Linux have no
// in-place updater yet: their native packages are manual downloads, never
// updater artifacts. A Tauri updater artifact (AppImage, deb, rpm, NSIS setup,
// Tauri `.app.tar.gz`) in the inputs fails the collection: a native release must
// not publish a Tauri package under a newer version (the old app would reinstall
// it in a loop). Each archive must hold one `OpenBitFun.app` that both updaters
// accept (`missingUpdaterArchiveEntries`).
//
// Usage: collect-tauri-updater-assets.mjs --assets-dir <dir> --version <v> --out-dir <dir>
//          [--required-platforms darwin-aarch64-nsh,darwin-x86_64-nsh]
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { basename, join } from 'path';
import {
  classifyDesktopReleaseAsset,
  missingUpdaterArchiveEntries,
  nativeUpdaterArchiveName,
} from './desktop-release-assets.mjs';

const args = parseArgs(process.argv.slice(2));
const assetsDir = requireArg(args, 'assets-dir');
const version = requireArg(args, 'version');
const outDir = requireArg(args, 'out-dir');

const requiredPlatforms = parseListArg(
  args['required-platforms'] || 'darwin-aarch64-nsh,darwin-x86_64-nsh'
);

if (!existsSync(assetsDir)) {
  fail(`Assets directory does not exist: ${assetsDir}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const collected = {};
for (const file of walkFiles(assetsDir)) {
  const asset = classifyDesktopReleaseAsset(file);
  if (asset.kind === 'tauri-updater') {
    fail(`Tauri updater artifact in a native desktop release: ${file}`);
  }
  if (asset.kind !== 'native-updater') {
    continue;
  }
  if (asset.version !== version) {
    fail(`Updater archive ${basename(file)} is for version ${asset.version}, not ${version}`);
  }
  const sigPath = `${file}.sig`;
  if (!existsSync(sigPath)) {
    fail(`Native updater archive is not signed: ${file}`);
  }
  const entries = execFileSync('tar', ['-tzf', file], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  }).split('\n');
  const missingEntries = missingUpdaterArchiveEntries(entries);
  if (missingEntries.length > 0) {
    fail(`${basename(file)} cannot update both the native app and installed Tauri builds: ${missingEntries.join('; ')}`);
  }
  const platform = asset.platform;
  if (collected[platform]) {
    fail(`Duplicate updater artifact for ${platform}: ${file} conflicts with ${collected[platform].source}`);
  }

  const outputPath = join(outDir, nativeUpdaterArchiveName(version, asset.arch));
  copyFileSync(file, outputPath);
  // Copied byte for byte: the minisign signature covers the archive bytes,
  // not its name.
  copyFileSync(sigPath, `${outputPath}.sig`);
  collected[platform] = { source: file, output: outputPath };
  console.log(`[collect-updater] ${platform}: ${basename(outputPath)}`);
}

const missing = requiredPlatforms.filter((platform) => !collected[platform]);
if (missing.length > 0) {
  const found = Object.keys(collected).sort();
  console.error(`[collect-updater] Found platforms: ${found.length > 0 ? found.join(', ') : '(none)'}`);
  fail(`Missing required updater platforms: ${missing.join(', ')}`);
}

console.log(`[collect-updater] Wrote ${Object.keys(collected).length} updater artifacts to ${outDir}`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = rawArgs[i + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for --${key}`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function requireArg(parsed, key) {
  const value = parsed[key];
  if (!value) {
    fail(`Missing required argument --${key}`);
  }
  return value;
}

function parseListArg(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function fail(message) {
  console.error(`[collect-updater] ${message}`);
  process.exit(1);
}

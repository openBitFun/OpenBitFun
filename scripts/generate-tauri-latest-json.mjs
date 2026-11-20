#!/usr/bin/env node
// Writes the desktop release manifest `latest-v1.json` (read by the native
// app's updater, by installed Tauri builds and by the download mirror).
//
// Key layout (see `desktop-release-assets.mjs`):
//   platforms["darwin-<arch>-nsh"]  the native updater archive + signature
//   platforms["darwin-<arch>"]      the SAME archive + signature: the bridge an
//                                   installed Tauri build updates through
//   no windows-* / linux-* platform keys (no native in-place updater yet)
//   manual_installers["darwin-<arch>"]    the DMG
//   manual_installers["windows-x86_64"]   the native Windows zip
//   manual_installers["linux-<arch>"]     the native Linux tarball
//
// Usage: generate-tauri-latest-json.mjs --assets-dir <collected updater dir>
//          --version <v> --tag <tag> --repo <owner/name> --out <file>
//          [--installer-assets-dir <dir>] [--required-platforms <keys>]
//          [--required-manual-platforms <keys>] [--notes-file <file>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import {
  classifyDesktopReleaseAsset,
  legacyBridgePlatform,
} from './desktop-release-assets.mjs';

const args = parseArgs(process.argv.slice(2));
const assetsDir = requireArg(args, 'assets-dir');
const version = requireArg(args, 'version');
const tag = requireArg(args, 'tag');
const repo = requireArg(args, 'repo');
const out = requireArg(args, 'out');
const requiredPlatforms = parseListArg(args['required-platforms'] || '');
const requiredManualPlatforms = parseListArg(args['required-manual-platforms'] || '');
const installerAssetsDir = args['installer-assets-dir'];
const notesFile = args['notes-file'];

if (!existsSync(assetsDir)) {
  fail(`Assets directory does not exist: ${assetsDir}`);
}

const platforms = {};
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
  if (platforms[asset.platform]) {
    fail(`Duplicate ${asset.platform} updater archive: ${file}`);
  }
  const entry = {
    signature: readFileSync(sigPath, 'utf8').trim(),
    url: releaseUrl(basename(file)),
  };
  platforms[asset.platform] = entry;
  // The bridge: an installed Tauri build reads `darwin-<arch>` and installs the
  // same signed native archive (same key, same bundle identifier).
  platforms[legacyBridgePlatform(asset.arch)] = { ...entry };
}

if (Object.keys(platforms).length === 0) {
  fail('No signed native updater archives were found. Expected OpenBitFun-nsh_<version>_<arch>.app.tar.gz with its .sig.');
}

const missingPlatforms = requiredPlatforms.filter((platform) => !platforms[platform]);
if (missingPlatforms.length > 0) {
  fail(`Missing required updater platforms: ${missingPlatforms.join(', ')}`);
}

const manifest = {
  version,
  notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : '',
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b))),
};

// What a person downloads and installs by hand: the macOS DMG (the updater
// archive unpacks into a bare .app wherever downloads land) and the Windows
// and Linux native packages. Declaring them lets the website and the mirror
// offer them instead of deriving filenames themselves.
const manualInstallers = {};
if (installerAssetsDir) {
  if (!existsSync(installerAssetsDir)) {
    fail(`Installer assets directory does not exist: ${installerAssetsDir}`);
  }
  for (const file of walkFiles(installerAssetsDir)) {
    const asset = classifyDesktopReleaseAsset(file);
    if (asset.kind !== 'manual' || asset.version !== version) {
      continue;
    }
    if (manualInstallers[asset.platform]) {
      fail(`Duplicate ${asset.platform} manual installer: ${file}`);
    }
    const signaturePath = `${file}.sig`;
    if (!existsSync(signaturePath)) {
      fail(`Missing signed manual installer pair: ${file} and ${signaturePath}`);
    }
    const url = releaseUrl(basename(file));
    manualInstallers[asset.platform] = { url, signature_url: `${url}.sig` };
  }
}

const missingManual = requiredManualPlatforms.filter((platform) => !manualInstallers[platform]);
if (missingManual.length > 0) {
  fail(`Missing required manual installers: ${missingManual.join(', ')}`);
}

if (Object.keys(manualInstallers).length > 0) {
  manifest.manual_installers = Object.fromEntries(
    Object.entries(manualInstallers).sort(([a], [b]) => a.localeCompare(b)),
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[latest-json] Wrote ${out}`);
for (const platform of Object.keys(manifest.platforms)) {
  console.log(`[latest-json] ${platform}: ${manifest.platforms[platform].url}`);
}
for (const platform of Object.keys(manualInstallers).sort()) {
  console.log(`[latest-json] manual ${platform}: ${manualInstallers[platform].url}`);
}

function releaseUrl(assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

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

function parseListArg(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireArg(parsed, key) {
  const value = parsed[key];
  if (!value) {
    fail(`Missing required argument --${key}`);
  }
  return value;
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
  console.error(`[latest-json] ${message}`);
  process.exit(1);
}

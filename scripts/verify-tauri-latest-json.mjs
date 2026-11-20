#!/usr/bin/env node
import { readFileSync } from 'fs';

const args = parseArgs(process.argv.slice(2));
const manifestPath = requireArg(args, 'manifest');
const version = args.version;
const requiredPlatforms = parseListArg(args['required-platforms'] || '');
const requiredManualPlatforms = parseListArg(args['required-manual-platforms'] || '');
// `darwin-<arch>` keys that must carry exactly the native `darwin-<arch>-nsh`
// archive and signature: the update bridge for installed Tauri builds.
const bridgePlatforms = parseListArg(args['bridge-platforms'] || '');
// Platform key prefixes the manifest must not carry (`windows-,linux-`: no native
// in-place updater yet, and an older Tauri package would reinstall in a loop).
const forbiddenPlatformPrefixes = parseListArg(args['forbidden-platform-prefixes'] || '');
const checkUrls = ['1', 'true', 'yes'].includes(String(args['check-urls'] || '').toLowerCase());

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (version && manifest.version !== version) {
  fail(`Manifest version ${manifest.version} does not match expected ${version}`);
}

if (!manifest.platforms || typeof manifest.platforms !== 'object') {
  fail('Manifest does not contain a platforms object');
}

const missing = requiredPlatforms.filter((platform) => !manifest.platforms[platform]);
if (missing.length > 0) {
  fail(`Missing required updater platforms: ${missing.join(', ')}`);
}

for (const [platform, entry] of Object.entries(manifest.platforms)) {
  if (!entry || typeof entry !== 'object') {
    fail(`Invalid platform entry for ${platform}`);
  }
  if (!entry.url || typeof entry.url !== 'string') {
    fail(`Missing URL for ${platform}`);
  }
  if (!entry.signature || typeof entry.signature !== 'string') {
    fail(`Missing signature for ${platform}`);
  }
}

for (const platform of bridgePlatforms) {
  const legacy = manifest.platforms[platform];
  const native = manifest.platforms[`${platform}-nsh`];
  if (!legacy || !native) {
    fail(`Bridge ${platform} needs both ${platform} and ${platform}-nsh entries`);
  }
  if (legacy.url !== native.url || legacy.signature !== native.signature) {
    fail(`Bridge ${platform} must carry the same archive and signature as ${platform}-nsh`);
  }
}

for (const platform of Object.keys(manifest.platforms)) {
  const prefix = forbiddenPlatformPrefixes.find((candidate) => platform.startsWith(candidate));
  if (prefix) {
    fail(`Platform ${platform} is not allowed in this manifest (forbidden prefix ${prefix})`);
  }
}

const manualInstallers = manifest.manual_installers || {};
const missingManual = requiredManualPlatforms.filter((platform) => !manualInstallers[platform]);
if (missingManual.length > 0) {
  fail(`Missing required manual installers: ${missingManual.join(', ')}`);
}
for (const [platform, entry] of Object.entries(manualInstallers)) {
  if (!entry || typeof entry !== 'object') fail(`Invalid manual installer entry for ${platform}`);
  if (!entry.url || typeof entry.url !== 'string') fail(`Missing manual installer URL for ${platform}`);
  if (!entry.signature_url || typeof entry.signature_url !== 'string') {
    fail(`Missing manual installer signature URL for ${platform}`);
  }
  if (entry.signature_url !== `${entry.url}.sig`) {
    fail(`Manual installer signature URL for ${platform} must equal url + .sig`);
  }
  if (manifest.platforms[platform]?.url === entry.url) {
    fail(`Manual installer URL for ${platform} must not replace the updater URL`);
  }
}

if (checkUrls) {
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    await assertUrlAvailable(platform, entry.url);
  }
  for (const [platform, entry] of Object.entries(manualInstallers)) {
    await assertUrlAvailable(`manual installer ${platform}`, entry.url);
    await assertUrlAvailable(`manual installer signature ${platform}`, entry.signature_url);
  }
}

console.log(`[verify-latest-json] OK: ${Object.keys(manifest.platforms).sort().join(', ')}`);

async function assertUrlAvailable(platform, url) {
  let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (response.ok) {
    return;
  }

  response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { Range: 'bytes=0-0' },
  });
  if (!response.ok) {
    fail(`URL for ${platform} is not available: ${url} (${response.status})`);
  }
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

function fail(message) {
  console.error(`[verify-latest-json] ${message}`);
  process.exit(1);
}

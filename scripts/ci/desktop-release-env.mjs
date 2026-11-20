#!/usr/bin/env node
// Resolves the build environment of a native desktop release package and
// appends it to GITHUB_ENV (or prints it):
//   OPENBITFUN_RELEASE_CHANNEL            stable | beta | nightly
//   OPENBITFUN_UPDATER_PRIMARY_ENDPOINT   compiled into the backend
//   OPENBITFUN_UPDATER_FALLBACK_ENDPOINT  (`src/apps/desktop/src/api/system_api.rs`)
//   OPENBITFUN_NATIVE_UPDATER_PUBKEY      release key the native updater verifies with
//                                         (`backend_protocol/native_commands/update.rs`)
// The channel comes from OPENBITFUN_RELEASE_CHANNEL; TAURI_UPDATER_ENDPOINT and
// TAURI_UPDATER_FALLBACK_ENDPOINT override its endpoints (fork releases). When
// OPENBITFUN_ENABLE_UPDATER_ARTIFACTS is true, the public and private release
// keys are required: a published package must be verifiable by the installed app.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReleaseChannel } from '../release-channel.mjs';

export function desktopReleaseEnvironment(env = process.env) {
  const release = resolveReleaseChannel(env.OPENBITFUN_RELEASE_CHANNEL);
  const resolved = {
    OPENBITFUN_RELEASE_CHANNEL: release.channel,
    OPENBITFUN_UPDATER_PRIMARY_ENDPOINT: env.TAURI_UPDATER_ENDPOINT || release.primaryUpdaterEndpoint,
    OPENBITFUN_UPDATER_FALLBACK_ENDPOINT: env.TAURI_UPDATER_FALLBACK_ENDPOINT || release.fallbackUpdaterEndpoint,
  };
  const enabled = ['1', 'true', 'yes'].includes(String(env.OPENBITFUN_ENABLE_UPDATER_ARTIFACTS || '').toLowerCase());
  if (enabled) {
    if (!env.TAURI_UPDATER_PUBKEY) {
      throw new Error('OPENBITFUN_ENABLE_UPDATER_ARTIFACTS is set, but TAURI_UPDATER_PUBKEY is missing.');
    }
    if (!env.TAURI_SIGNING_PRIVATE_KEY) {
      throw new Error('OPENBITFUN_ENABLE_UPDATER_ARTIFACTS is set, but TAURI_SIGNING_PRIVATE_KEY is missing.');
    }
  }
  if (env.TAURI_UPDATER_PUBKEY) {
    resolved.OPENBITFUN_NATIVE_UPDATER_PUBKEY = env.TAURI_UPDATER_PUBKEY;
  }
  return resolved;
}

/** GITHUB_ENV lines; multi-line values use a delimiter. */
export function formatGithubEnv(values) {
  return Object.entries(values)
    .map(([name, value]) => {
      const text = String(value);
      if (!text.includes('\n')) return `${name}=${text}\n`;
      const delimiter = `OPENBITFUN_ENV_${name}_EOF`;
      if (text.includes(delimiter)) throw new Error(`${name} contains its own delimiter`);
      return `${name}<<${delimiter}\n${text}\n${delimiter}\n`;
    })
    .join('');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = desktopReleaseEnvironment();
    if (process.env.GITHUB_ENV) {
      appendFileSync(process.env.GITHUB_ENV, formatGithubEnv(values));
    }
    for (const name of ['OPENBITFUN_RELEASE_CHANNEL', 'OPENBITFUN_UPDATER_PRIMARY_ENDPOINT', 'OPENBITFUN_UPDATER_FALLBACK_ENDPOINT']) {
      console.log(`[desktop-release-env] ${name}=${values[name]}`);
    }
    console.log(`[desktop-release-env] native updater key: ${values.OPENBITFUN_NATIVE_UPDATER_PUBKEY ? 'configured' : 'not configured'}`);
  } catch (error) {
    console.error(`[desktop-release-env] ${error.message}`);
    process.exitCode = 1;
  }
}

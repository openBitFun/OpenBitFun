#!/usr/bin/env node
// Installs a pinned release of the NSH CLI (`nsh`), which builds the native
// desktop app's UI bundle (`nsh build src/apps/desktop-nsh`), its web bundle and
// runs the headless UI suite (`cd src/nsh-ui && nsh test .`).
//
// The NSH crates of the runner are pinned to the same version
// (`src/apps/desktop-nsh/native/Cargo.toml`, `nsh-* = "=0.6.0"`): bump both together.
// Archives are verified against the SHA-256 digests pinned below, not against a
// checksum downloaded from the same place.
//
// Usage: node scripts/ci/install-nsh.mjs [--dir <install dir>]
// Appends `<dir>/bin` to GITHUB_PATH when set; prints the installed version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NSH_VERSION = 'v0.6.0';

export const NSH_ASSETS = {
  'darwin-arm64': { asset: 'nsh-macos-arm64.tar.gz', sha256: 'b2a8370c8b44ca6059d2d8665b48b08472a4fee3956813b99223f4e3ce5491d9' },
  'darwin-x64': { asset: 'nsh-macos-x86_64.tar.gz', sha256: 'fc764318cdbd70f488676afe007186e0748bbe54fa7c866b6d9bce6be16a3eb5' },
  'linux-x64': { asset: 'nsh-linux-x86_64.tar.gz', sha256: '19d360eb8dd1ba8847a3b3ad06082f6f3705eb04ae8178357a8cdad31880f0d9' },
  'linux-arm64': { asset: 'nsh-linux-arm64.tar.gz', sha256: 'dc6426c152ea600337451afc1e8e81531823309951be35cde3d91928eeaa7379' },
  'win32-x64': { asset: 'nsh-windows-x86_64.zip', sha256: '6ae2e430d84cfe5fcb1d2ab25e56c2685eaaa4abc963c93b52263f435791ebb1' },
};

export function nshAsset(platform = process.platform, arch = process.arch) {
  const entry = NSH_ASSETS[`${platform}-${arch}`];
  if (!entry) throw new Error(`No pinned NSH ${NSH_VERSION} build for ${platform}-${arch}`);
  return {
    ...entry,
    url: `https://github.com/longbridge/nsh/releases/download/${NSH_VERSION}/${entry.asset}`,
  };
}

async function download(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      console.warn(`[install-nsh] Download attempt ${attempt}/${attempts} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  throw new Error(`Could not download ${url}: ${lastError?.message}`);
}

export async function installNsh({ dir = path.join(homedir(), '.nsh') } = {}) {
  const { asset, sha256, url } = nshAsset();
  console.log(`[install-nsh] Installing NSH ${NSH_VERSION} (${asset}) into ${dir}`);
  const bytes = await download(url);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) {
    throw new Error(`Checksum mismatch for ${asset}: expected ${sha256}, got ${actual}`);
  }
  const work = mkdtempSync(path.join(tmpdir(), 'openbitfun-nsh-'));
  try {
    const archive = path.join(work, asset);
    writeFileSync(archive, bytes);
    // bsdtar (macOS, Windows) and GNU tar both read the release archives;
    // Windows' tar.exe also unpacks the zip.
    execFileSync('tar', ['-xf', archive, '-C', work], { stdio: 'inherit', windowsHide: true });
    const extracted = path.join(work, 'nsh');
    const binary = path.join(extracted, 'bin', process.platform === 'win32' ? 'nsh.exe' : 'nsh');
    if (!existsSync(binary)) throw new Error(`${asset} holds no nsh/bin/nsh`);
    // Replace the whole directory: runtimes of another release must not stay.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    renameSync(extracted, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const bin = path.join(dir, 'bin');
  const version = execFileSync(path.join(bin, process.platform === 'win32' ? 'nsh.exe' : 'nsh'), ['--version'], {
    encoding: 'utf8', windowsHide: true,
  }).trim();
  console.log(`[install-nsh] Installed ${version}`);
  if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
  return { bin, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : undefined;
  installNsh(dir ? { dir } : {}).catch((error) => {
    console.error(`[install-nsh] ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// Installs a pinned release of the NSH CLI (`nsh`), which builds the native
// desktop app's UI bundle (`nsh build src/apps/desktop-nsh`), its web bundle and
// runs the headless UI suite (`cd src/nsh-ui && nsh test .`).
//
// The NSH crates of the runner are pinned to the same version
// (`src/apps/desktop-nsh/native/Cargo.toml`, `nsh-* = "=0.6.1"`): bump both together.
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

export const NSH_VERSION = 'v0.6.1';

export const NSH_ASSETS = {
  'darwin-arm64': { asset: 'nsh-macos-arm64.tar.gz', sha256: 'ee1aed2a4d111fe90e6cceca4b9d5f834c9e11cfda525f8be984261a329c06de' },
  'darwin-x64': { asset: 'nsh-macos-x86_64.tar.gz', sha256: '23ccbfa71f50eb312e57862b7b843a15b23c1b9a9464cfc30735b1c07a18e324' },
  'linux-x64': { asset: 'nsh-linux-x86_64.tar.gz', sha256: '9a7ac692f1c229df476be8ff83a3c5912d271453b644e313f02cb19d18696070' },
  'linux-arm64': { asset: 'nsh-linux-arm64.tar.gz', sha256: 'd7d54b8a62aa8bd4a9fb73fcc0abce8cc565185926f226aa90f48622f3e410a3' },
  'win32-x64': { asset: 'nsh-windows-x86_64.zip', sha256: '7952c84b165e13515bd2ad2787ef22622e49ce88cb8d877825e40b40f3aff4be' },
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

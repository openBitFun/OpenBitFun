#!/usr/bin/env node
// Installs a pinned release of the NSH CLI (`nsh`), which builds the native
// desktop app's UI bundle (`nsh build src/apps/desktop-nsh`), its web bundle and
// runs the headless UI suite (`cd src/nsh-ui && nsh test .`).
//
// The NSH crates of the runner are pinned to the same version
// (`src/apps/desktop-nsh/native/Cargo.toml`, `nsh-* = "=0.7.1"`): bump both together.
// Archives are verified against the SHA-256 digests pinned below, not against a
// checksum downloaded from the same place.
//
// Usage:
//   node scripts/ci/install-nsh.mjs [--dir <install dir>]
//   node scripts/ci/install-nsh.mjs --ensure [--dir <install dir>]
//   node scripts/ci/install-nsh.mjs --postinstall [--dir <install dir>]
//
// `--ensure` skips downloading when the pinned version is already present and
// links/shims it into `<repo>/node_modules/.bin/nsh` so `pnpm run ...` works
// without shell PATH changes. `--postinstall` adds CI and opt-out guards
// (`OPENBITFUN_SKIP_NSH_INSTALL=1`) for `pnpm install`.
// Appends `<dir>/bin` to GITHUB_PATH when set; prints the installed version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const NSH_VERSION = 'v0.7.1';

export const NSH_ASSETS = {
  'darwin-arm64': { asset: 'nsh-macos-arm64.tar.gz', sha256: '28e349b59c0b46e964010c8f858a78af5db4d26012d213c03d15ce28ddff0650' },
  'darwin-x64': { asset: 'nsh-macos-x86_64.tar.gz', sha256: 'b0f42f8f586461edac9a00b02e2e4c4587f3b7a4039168c303b07dd1265162f7' },
  'linux-x64': { asset: 'nsh-linux-x86_64.tar.gz', sha256: '04457ad3a53c91b66efcee537968c5af7c90df25cf61c18d51135ecc051e22b3' },
  'linux-arm64': { asset: 'nsh-linux-arm64.tar.gz', sha256: '011099329342bc961c9089de2c7c1ccdd60c0177b77d81284756866c2087ebbb' },
  'win32-x64': { asset: 'nsh-windows-x86_64.zip', sha256: 'f09aaf5155b0c57213fbda29ce1e82cd973694d33c745f74b94a1a966a673433' },
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

export function nshBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'nsh.exe' : 'nsh';
}

export function parseNshVersion(output) {
  const match = String(output ?? '').match(/\bnsh\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i);
  return match ? `v${match[1]}` : null;
}

export function readNshVersion(binary) {
  if (!binary || !existsSync(binary)) return null;
  try {
    const raw = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    const version = parseNshVersion(raw);
    return version ? { raw, version } : null;
  } catch {
    return null;
  }
}

export function isDirOnPath(dir, env = process.env, platform = process.platform) {
  const sep = platform === 'win32' ? ';' : ':';
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const target = normalize(dir);
  return String(env.PATH ?? '')
    .split(sep)
    .filter(Boolean)
    .some((entry) => {
      try {
        return normalize(entry) === target;
      } catch {
        return false;
      }
    });
}

export function findMatchingNsh({
  dir,
  env = process.env,
  platform = process.platform,
  repoRoot = REPO_ROOT,
  readVersion = readNshVersion,
} = {}) {
  const installDir = dir ?? env.OPENBITFUN_NSH_DIR ?? path.join(homedir(), '.nsh');
  const binName = nshBinaryName(platform);
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const skipDirs = new Set([normalize(path.join(repoRoot, 'node_modules', '.bin'))]);
  const candidates = [path.join(installDir, 'bin', binName)];
  const sep = platform === 'win32' ? ';' : ':';
  for (const entry of String(env.PATH ?? '').split(sep).filter(Boolean)) {
    let normalized;
    try {
      normalized = normalize(entry);
    } catch {
      continue;
    }
    if (skipDirs.has(normalized)) continue;
    skipDirs.add(normalized);
    candidates.push(path.join(entry, binName));
  }
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalize(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const info = readVersion(candidate);
    if (info?.version === NSH_VERSION) {
      return {
        binary: candidate,
        bin: path.dirname(candidate),
        version: info.raw,
        source: key === normalize(path.join(installDir, 'bin', binName)) ? 'dir' : 'path',
      };
    }
  }
  return null;
}

export function linkNshIntoNodeModulesBin(
  binary,
  { repoRoot = REPO_ROOT, platform = process.platform } = {},
) {
  const nodeModules = path.join(repoRoot, 'node_modules');
  if (!existsSync(nodeModules)) return null;
  const binDir = path.join(nodeModules, '.bin');
  mkdirSync(binDir, { recursive: true });
  if (platform === 'win32') {
    const cmdPath = path.join(binDir, 'nsh.cmd');
    const ps1Path = path.join(binDir, 'nsh.ps1');
    const shPath = path.join(binDir, 'nsh');
    const escapedPs1 = binary.replace(/"/g, '`"');
    const posixBinary = binary.replace(/\\/g, '/').replace(/'/g, `'\\''`);
    writeFileSync(cmdPath, `@ECHO off\r\n"${binary}" %*\r\n`);
    writeFileSync(ps1Path, `& "${escapedPs1}" @args\r\nexit $LASTEXITCODE\r\n`);
    writeFileSync(shPath, `#!/bin/sh\nexec '${posixBinary}' "$@"\n`);
    return cmdPath;
  }
  const linkPath = path.join(binDir, 'nsh');
  try {
    if (lstatSync(linkPath).isSymbolicLink() && readlinkSync(linkPath) === binary) {
      return linkPath;
    }
  } catch {
    // Link does not exist yet or is not a symlink; replace it below.
  }
  rmSync(linkPath, { force: true });
  symlinkSync(binary, linkPath);
  try {
    chmodSync(binary, 0o755);
  } catch {
    // Ignore when the target binary is owned by another user / read-only store.
  }
  return linkPath;
}

function moveDirectory(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true });
  }
}

export async function installNsh({ dir = process.env.OPENBITFUN_NSH_DIR || path.join(homedir(), '.nsh') } = {}) {
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
    const binary = path.join(extracted, 'bin', nshBinaryName());
    if (!existsSync(binary)) throw new Error(`${asset} holds no nsh/bin/nsh`);
    // Replace the whole directory: runtimes of another release must not stay.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    moveDirectory(extracted, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const bin = path.join(dir, 'bin');
  const version = execFileSync(path.join(bin, nshBinaryName()), ['--version'], {
    encoding: 'utf8', windowsHide: true,
  }).trim();
  console.log(`[install-nsh] Installed ${version}`);
  if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
  return { bin, version };
}

export async function ensureNsh({
  dir,
  repoRoot = REPO_ROOT,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  postinstall = false,
  install = installNsh,
  find = findMatchingNsh,
  link = linkNshIntoNodeModulesBin,
} = {}) {
  const installDir = dir ?? env.OPENBITFUN_NSH_DIR ?? path.join(homedir(), '.nsh');
  if (env.OPENBITFUN_SKIP_NSH_INSTALL === '1') {
    console.log('[install-nsh] Skipping NSH CLI installation (OPENBITFUN_SKIP_NSH_INSTALL=1).');
    return { skipped: true, reason: 'env' };
  }
  const existing = find({ dir: installDir, env, platform, repoRoot });
  if (existing) {
    const linked = link(existing.binary, { repoRoot, platform });
    console.log(`[install-nsh] Using existing ${existing.version} (${existing.binary})`);
    return { ...existing, linked, installed: false };
  }
  if (postinstall && env.CI) {
    console.log('[install-nsh] Skipping NSH CLI download in CI postinstall (run "node scripts/ci/install-nsh.mjs" when NSH is needed).');
    return { skipped: true, reason: 'ci' };
  }
  if (postinstall && !NSH_ASSETS[`${platform}-${arch}`]) {
    console.warn(`[install-nsh] No pinned NSH ${NSH_VERSION} build for ${platform}-${arch}; skipping.`);
    return { skipped: true, reason: 'unsupported-platform' };
  }
  let installed;
  try {
    installed = await install({ dir: installDir });
  } catch (error) {
    if (postinstall) {
      throw new Error(
        `${error.message}\nSet OPENBITFUN_SKIP_NSH_INSTALL=1 to skip NSH CLI installation during pnpm install.`,
      );
    }
    throw error;
  }
  const binary = path.join(installed.bin, nshBinaryName(platform));
  const linked = link(binary, { repoRoot, platform });
  if (!env.GITHUB_PATH && !isDirOnPath(installed.bin, env, platform)) {
    console.log(
      `[install-nsh] Linked into node_modules/.bin/nsh for pnpm scripts. To run "nsh" directly in your shell, add ${installed.bin} to PATH.`,
    );
  }
  return { ...installed, binary, linked, installed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : undefined;
  const postinstall = args.includes('--postinstall');
  const ensure = postinstall || args.includes('--ensure');
  const run = ensure
    ? () => ensureNsh({ ...(dir ? { dir } : {}), postinstall })
    : async () => {
        const result = await installNsh(dir ? { dir } : {});
        const binary = path.join(result.bin, nshBinaryName());
        linkNshIntoNodeModulesBin(binary);
        if (!process.env.GITHUB_PATH && !isDirOnPath(result.bin)) {
          console.log(
            `[install-nsh] To run "nsh" directly in your shell, add ${result.bin} to PATH (or use "pnpm exec nsh").`,
          );
        }
        return result;
      };
  run().catch((error) => {
    console.error(`[install-nsh] ${error.message}`);
    process.exitCode = 1;
  });
}

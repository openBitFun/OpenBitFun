import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { desktopReleaseEnvironment, formatGithubEnv } from './desktop-release-env.mjs';
import {
  ensureNsh,
  findMatchingNsh,
  linkNshIntoNodeModulesBin,
  NSH_ASSETS,
  NSH_VERSION,
  nshAsset,
  parseNshVersion,
} from './install-nsh.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('release channel environment compiles the channel endpoints into the native backend', () => {
  const stable = desktopReleaseEnvironment({ OPENBITFUN_RELEASE_CHANNEL: 'stable' });
  assert.equal(stable.OPENBITFUN_RELEASE_CHANNEL, 'stable');
  assert.equal(stable.OPENBITFUN_UPDATER_PRIMARY_ENDPOINT,
    'https://github.com/openBitFun/OpenBitFun/releases/latest/download/latest-v1.json');
  assert.equal(stable.OPENBITFUN_UPDATER_FALLBACK_ENDPOINT, 'https://openbitfun.com/release/latest-v1.json');
  assert.equal(stable.OPENBITFUN_NATIVE_UPDATER_PUBKEY, undefined);

  const beta = desktopReleaseEnvironment({ OPENBITFUN_RELEASE_CHANNEL: 'beta', TAURI_UPDATER_PUBKEY: 'key' });
  assert.match(beta.OPENBITFUN_UPDATER_PRIMARY_ENDPOINT, /channel-v1-beta\/latest-v1\.json$/);
  assert.equal(beta.OPENBITFUN_UPDATER_FALLBACK_ENDPOINT, 'https://openbitfun.com/release/beta/latest-v1.json');
  assert.equal(beta.OPENBITFUN_NATIVE_UPDATER_PUBKEY, 'key');

  // Fork releases point both endpoints at their own repository.
  const fork = desktopReleaseEnvironment({
    OPENBITFUN_RELEASE_CHANNEL: 'stable',
    TAURI_UPDATER_ENDPOINT: 'https://github.com/fork/OpenBitFun/releases/latest/download/latest-v1.json',
    TAURI_UPDATER_FALLBACK_ENDPOINT: 'https://github.com/fork/OpenBitFun/releases/latest/download/latest-v1.json',
  });
  assert.equal(fork.OPENBITFUN_UPDATER_PRIMARY_ENDPOINT, fork.OPENBITFUN_UPDATER_FALLBACK_ENDPOINT);
  assert.match(fork.OPENBITFUN_UPDATER_PRIMARY_ENDPOINT, /github\.com\/fork\//);

  assert.throws(() => desktopReleaseEnvironment({ OPENBITFUN_RELEASE_CHANNEL: 'canary' }), /Unsupported release channel/);
});

test('publishing builds require both release keys', () => {
  const publishing = { OPENBITFUN_RELEASE_CHANNEL: 'stable', OPENBITFUN_ENABLE_UPDATER_ARTIFACTS: 'true' };
  assert.throws(() => desktopReleaseEnvironment(publishing), /TAURI_UPDATER_PUBKEY is missing/);
  assert.throws(() => desktopReleaseEnvironment({ ...publishing, TAURI_UPDATER_PUBKEY: 'key' }),
    /TAURI_SIGNING_PRIVATE_KEY is missing/);
  assert.doesNotThrow(() => desktopReleaseEnvironment({
    ...publishing, TAURI_UPDATER_PUBKEY: 'key', TAURI_SIGNING_PRIVATE_KEY: 'secret',
  }));
  assert.doesNotThrow(() => desktopReleaseEnvironment({ OPENBITFUN_RELEASE_CHANNEL: 'nightly' }));
});

test('GitHub environment lines keep multi-line keys intact', () => {
  assert.equal(formatGithubEnv({ A: 'one' }), 'A=one\n');
  const key = 'untrusted comment: minisign public key\nRWTDIhzs';
  assert.equal(
    formatGithubEnv({ OPENBITFUN_NATIVE_UPDATER_PUBKEY: key }),
    `OPENBITFUN_NATIVE_UPDATER_PUBKEY<<OPENBITFUN_ENV_OPENBITFUN_NATIVE_UPDATER_PUBKEY_EOF\n${key}\nOPENBITFUN_ENV_OPENBITFUN_NATIVE_UPDATER_PUBKEY_EOF\n`,
  );
});

test('the pinned NSH CLI matches the runner crates and covers every package runner', () => {
  const manifest = readFileSync(path.join(root, 'src/apps/desktop-nsh/native/Cargo.toml'), 'utf8');
  const crateVersion = manifest.match(/^nsh-core = \{ version = "=([^"]+)"/m)?.[1];
  assert.equal(`v${crateVersion}`, NSH_VERSION, 'bump the NSH CLI and the runner crates together');
  for (const entry of Object.values(NSH_ASSETS)) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64']]) {
    assert.match(nshAsset(platform, arch).url, new RegExp(`/releases/download/${NSH_VERSION}/nsh-`));
  }
  assert.throws(() => nshAsset('win32', 'ia32'), /No pinned NSH/);
});

test('every Desktop package platform builds through a native packaging script', () => {
  const platforms = JSON.parse(readFileSync(path.join(root, 'scripts/desktop-package-platforms.json'), 'utf8'));
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.deepEqual(platforms.map((platform) => platform.name),
    ['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64', 'windows-x64']);
  for (const platform of platforms) {
    const script = platform.build_command.match(/^pnpm run ([\w:-]+)/)?.[1];
    assert.ok(script && scripts[script], `${platform.name}: ${platform.build_command}`);
    assert.match(scripts[script], /scripts\/package-desktop-nsh-(macos|windows|linux)\.mjs/);
    if (!platform.name.startsWith('macos-')) {
      assert.ok(platform.build_command.includes(`--target ${platform.target}`), platform.name);
    }
  }
});

test('desktop:dev keeps the installed data by default and isolates it on request', async () => {
  const { resolveDesktopDevDataMode, resolveDesktopDevStorageEnvironment } = await import('../desktop-nsh-dev.mjs');
  assert.equal(resolveDesktopDevDataMode([]), 'shared');
  assert.equal(resolveDesktopDevDataMode(['--isolated-data']), 'isolated');
  assert.throws(() => resolveDesktopDevDataMode(['--shared-data', '--isolated-data']), /only one/);
  assert.deepEqual(resolveDesktopDevStorageEnvironment({}, '/repo', 'shared'), {});
  assert.deepEqual(resolveDesktopDevStorageEnvironment({}, '/repo', 'isolated'), {
    OPENBITFUN_USER_ROOT: path.join('/repo', '.openbitfun', 'desktop-dev', 'user'),
    OPENBITFUN_HOME: path.join('/repo', '.openbitfun', 'desktop-dev', 'home'),
  });
  assert.equal(resolveDesktopDevStorageEnvironment({ OPENBITFUN_HOME: '/explicit' }, '/repo', 'isolated').OPENBITFUN_HOME, '/explicit');
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['desktop:dev'], 'node scripts/desktop-nsh-dev.mjs');
  assert.equal(scripts['desktop:preview:debug'], 'node scripts/desktop-nsh-dev.mjs --no-build');
  assert.equal(scripts['nsh:install'], 'node scripts/ci/install-nsh.mjs --ensure');
  assert.match(scripts.postinstall, /node scripts\/ci\/install-nsh\.mjs --postinstall/);
  assert.doesNotMatch(Object.values(scripts).join('\n'), /desktop-tauri-build|scripts\/dev\.cjs|tauri dev/);
});

test('install-nsh ensure/postinstall reuses existing versions, skips in CI/opt-out, and links node_modules/.bin', async (t) => {
  assert.equal(parseNshVersion('nsh 0.6.1 (2f51d86)'), 'v0.6.1');
  assert.equal(parseNshVersion('nsh v0.6.1'), 'v0.6.1');
  assert.equal(parseNshVersion('unrelated 1.0.0'), null);

  const work = mkdtempSync(path.join(tmpdir(), 'openbitfun-nsh-ensure-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });

  const skipEnv = await ensureNsh({
    repoRoot: work,
    env: { OPENBITFUN_SKIP_NSH_INSTALL: '1' },
    postinstall: true,
    install: async () => { throw new Error('must not download when skipped'); },
  });
  assert.deepEqual(skipEnv, { skipped: true, reason: 'env' });

  const skipCi = await ensureNsh({
    repoRoot: work,
    env: { CI: 'true', PATH: '' },
    dir: path.join(work, 'empty-nsh'),
    postinstall: true,
    find: () => null,
    install: async () => { throw new Error('must not download in CI postinstall'); },
  });
  assert.deepEqual(skipCi, { skipped: true, reason: 'ci' });

  const skipArch = await ensureNsh({
    repoRoot: work,
    env: { PATH: '' },
    dir: path.join(work, 'empty-nsh'),
    platform: 'win32',
    arch: 'ia32',
    postinstall: true,
    find: () => null,
    install: async () => { throw new Error('must not download on unsupported arch'); },
  });
  assert.deepEqual(skipArch, { skipped: true, reason: 'unsupported-platform' });

  const fakeBin = path.join(work, 'nsh-home', 'bin', 'nsh');
  mkdirSync(path.dirname(fakeBin), { recursive: true });
  writeFileSync(fakeBin, '#!/bin/sh\n');
  const reused = await ensureNsh({
    repoRoot: work,
    dir: path.join(work, 'nsh-home'),
    env: { PATH: '' },
    platform: 'darwin',
    postinstall: true,
    find: () => ({ binary: fakeBin, bin: path.dirname(fakeBin), version: `nsh ${NSH_VERSION.slice(1)}`, source: 'dir' }),
    install: async () => { throw new Error('must not re-download when matching version exists'); },
  });
  assert.equal(reused.installed, false);
  const unixLink = path.join(work, 'node_modules', '.bin', 'nsh');
  assert.equal(lstatSync(unixLink).isSymbolicLink(), true);
  assert.equal(readlinkSync(unixLink), fakeBin);

  let downloadCalls = 0;
  const freshDir = path.join(work, 'fresh-nsh');
  const freshBin = path.join(freshDir, 'bin', 'nsh');
  const installed = await ensureNsh({
    repoRoot: work,
    dir: freshDir,
    env: { PATH: '' },
    platform: 'darwin',
    arch: 'arm64',
    postinstall: true,
    find: () => null,
    install: async ({ dir }) => {
      downloadCalls += 1;
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      writeFileSync(path.join(dir, 'bin', 'nsh'), '#!/bin/sh\n');
      return { bin: path.join(dir, 'bin'), version: `nsh ${NSH_VERSION.slice(1)}` };
    },
  });
  assert.equal(downloadCalls, 1);
  assert.equal(installed.installed, true);
  assert.equal(readlinkSync(unixLink), freshBin);

  const winWork = mkdtempSync(path.join(tmpdir(), 'openbitfun-nsh-win-'));
  t.after(() => rmSync(winWork, { recursive: true, force: true }));
  mkdirSync(path.join(winWork, 'node_modules'), { recursive: true });
  const winShim = linkNshIntoNodeModulesBin('C:\\Users\\dev\\.nsh\\bin\\nsh.exe', {
    repoRoot: winWork,
    platform: 'win32',
  });
  assert.equal(existsSync(winShim), true);
  assert.match(readFileSync(winShim, 'utf8'), /"C:\\Users\\dev\\\.nsh\\bin\\nsh\.exe" %\*/);
  assert.match(readFileSync(path.join(winWork, 'node_modules', '.bin', 'nsh.ps1'), 'utf8'), /nsh\.exe/);
  assert.match(readFileSync(path.join(winWork, 'node_modules', '.bin', 'nsh'), 'utf8'), /C:\/Users\/dev\/\.nsh\/bin\/nsh\.exe/);

  const skippedSelf = findMatchingNsh({
    dir: path.join(work, 'missing'),
    repoRoot: work,
    env: { PATH: path.join(work, 'node_modules', '.bin') },
    platform: 'darwin',
    readVersion: (candidate) => (existsSync(candidate) ? { raw: `nsh ${NSH_VERSION.slice(1)}`, version: NSH_VERSION } : null),
  });
  assert.equal(skippedSelf, null, 'must ignore repo node_modules/.bin when probing existing nsh');
});

test('desktop:dev resolves RUSTUP_TOOLCHAIN=1.98.1 automatically when default rustc < 1.97', async () => {
  const {
    meetsMinRustVersion,
    parseRustcVersion,
    resolveDesktopDevRustEnvironment,
  } = await import('../desktop-nsh-dev.mjs');

  assert.deepEqual(parseRustcVersion('rustc 1.98.1 (abc 2026-01-01)'), [1, 98, 1]);
  assert.equal(meetsMinRustVersion([1, 96, 0]), false);
  assert.equal(meetsMinRustVersion([1, 97, 0]), true);
  assert.equal(meetsMinRustVersion([2, 0, 0]), true);

  assert.deepEqual(
    resolveDesktopDevRustEnvironment({ RUSTUP_TOOLCHAIN: 'nightly' }, {
      readRustcVersion: () => { throw new Error('must not probe rustc when RUSTUP_TOOLCHAIN is set'); },
    }),
    {},
  );
  assert.deepEqual(
    resolveDesktopDevRustEnvironment({}, {
      readRustcVersion: () => 'rustc 1.98.1 (abc)',
      readRustupToolchains: () => '',
    }),
    {},
  );
  assert.deepEqual(
    resolveDesktopDevRustEnvironment({}, {
      readRustcVersion: () => 'rustc 1.93.0 (abc)',
      readRustupToolchains: () => '1.93.0-aarch64-apple-darwin (default)\n1.98.1-aarch64-apple-darwin\n',
    }),
    { RUSTUP_TOOLCHAIN: '1.98.1' },
  );
  assert.throws(
    () => resolveDesktopDevRustEnvironment({}, {
      readRustcVersion: () => 'rustc 1.93.0 (abc)',
      readRustupToolchains: () => '1.93.0-aarch64-apple-darwin (default)\n',
    }),
    /rustup toolchain install 1\.98\.1/,
  );
});

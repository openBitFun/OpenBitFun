import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { desktopReleaseEnvironment, formatGithubEnv } from './desktop-release-env.mjs';
import { NSH_ASSETS, NSH_VERSION, nshAsset } from './install-nsh.mjs';

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
  assert.doesNotMatch(Object.values(scripts).join('\n'), /desktop-tauri-build|scripts\/dev\.cjs|tauri dev/);
});

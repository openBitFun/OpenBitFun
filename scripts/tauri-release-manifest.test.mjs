import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

const ARCHES = [['aarch64', 'aarch64', 'x64'], ['x86_64', 'x64', 'x64']];

function writeSigned(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.writeFileSync(`${file}.sig`, `signature of ${path.basename(file)}`);
}

// A native updater archive as `scripts/ci/package-native-macos-release.sh` makes
// it: one OpenBitFun.app with the native runner and UI bundle, plus the
// `openbitfun-desktop` link an installed Tauri build's installer looks for.
function writeUpdaterArchive(file, { legacyLink = true, extraTop = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-native-app-'));
  try {
    const contents = path.join(work, 'OpenBitFun.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources', 'nsh'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist/>');
    fs.writeFileSync(path.join(contents, 'MacOS', 'OpenBitFun'), 'runner', { mode: 0o755 });
    fs.writeFileSync(path.join(contents, 'Resources', 'nsh', 'bundle.nshc'), 'bundle');
    if (legacyLink) fs.symlinkSync('OpenBitFun', path.join(contents, 'MacOS', 'openbitfun-desktop'));
    const tops = ['OpenBitFun.app'];
    if (extraTop) {
      fs.writeFileSync(path.join(work, 'README.txt'), 'stray');
      tops.push('README.txt');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const result = spawnSync('tar', ['-czf', file, '-C', work, ...tops], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    fs.writeFileSync(`${file}.sig`, `signature of ${path.basename(file)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function nativeRelease(t, version = '1.2.3') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-native-release-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  // Laid out as the release job downloads the per-platform bundle artifacts.
  const assets = path.join(temp, 'release-assets');
  for (const [arch, dmgArch] of ARCHES) {
    const bundle = path.join(assets, `macos-${dmgArch === 'x64' ? 'x64' : 'arm64'}`, 'bundle');
    writeUpdaterArchive(path.join(bundle, 'macos', `OpenBitFun-nsh_${version}_${arch}.app.tar.gz`));
    writeSigned(path.join(bundle, 'dmg', `OpenBitFun_${version}_${dmgArch}.dmg`), `dmg ${arch}`);
  }
  writeSigned(path.join(assets, 'windows-x64', `OpenBitFun-nsh_${version}_x64-windows.zip`), 'windows zip');
  writeSigned(path.join(assets, 'linux-x64', `OpenBitFun-nsh_${version}_x86_64-linux.tar.gz`), 'linux x64');
  writeSigned(path.join(assets, 'linux-arm64', `OpenBitFun-nsh_${version}_aarch64-linux.tar.gz`), 'linux arm64');
  return { temp, assets, updater: path.join(temp, 'release-updater-assets'), out: path.join(temp, 'latest-v1.json') };
}

const NATIVE_UPDATER_PLATFORMS = 'darwin-aarch64-nsh,darwin-x86_64-nsh,darwin-aarch64,darwin-x86_64';
const NATIVE_MANUAL_PLATFORMS = 'darwin-aarch64,darwin-x86_64,windows-x86_64,linux-x86_64,linux-aarch64';

function collect(release, version = '1.2.3') {
  return run('scripts/collect-tauri-updater-assets.mjs', [
    '--assets-dir', release.assets, '--version', version, '--out-dir', release.updater,
    '--required-platforms', 'darwin-aarch64-nsh,darwin-x86_64-nsh',
  ]);
}

function generate(release, version = '1.2.3', extra = []) {
  return run('scripts/generate-tauri-latest-json.mjs', [
    '--assets-dir', release.updater,
    '--installer-assets-dir', release.assets,
    '--version', version, '--tag', `v${version}`, '--repo', 'GCWing/OpenBitFun',
    '--out', release.out,
    '--required-platforms', NATIVE_UPDATER_PLATFORMS,
    '--required-manual-platforms', NATIVE_MANUAL_PLATFORMS,
    ...extra,
  ]);
}

function verify(manifest, version = '1.2.3') {
  return run('scripts/verify-tauri-latest-json.mjs', [
    '--manifest', manifest, '--version', version,
    '--required-platforms', NATIVE_UPDATER_PLATFORMS,
    '--required-manual-platforms', NATIVE_MANUAL_PLATFORMS,
    '--bridge-platforms', 'darwin-aarch64,darwin-x86_64',
    '--forbidden-platform-prefixes', 'windows-,linux-',
  ]);
}

test('native release manifest bridges installed Tauri builds to the native macOS archive', (t) => {
  const release = nativeRelease(t);
  const collected = collect(release);
  assert.equal(collected.status, 0, collected.stderr);
  assert.deepEqual(fs.readdirSync(release.updater).sort(), [
    'OpenBitFun-nsh_1.2.3_aarch64.app.tar.gz',
    'OpenBitFun-nsh_1.2.3_aarch64.app.tar.gz.sig',
    'OpenBitFun-nsh_1.2.3_x86_64.app.tar.gz',
    'OpenBitFun-nsh_1.2.3_x86_64.app.tar.gz.sig',
  ]);
  const generated = generate(release);
  assert.equal(generated.status, 0, generated.stderr);

  const manifest = JSON.parse(fs.readFileSync(release.out, 'utf8'));
  assert.deepEqual(Object.keys(manifest.platforms), [
    'darwin-aarch64', 'darwin-aarch64-nsh', 'darwin-x86_64', 'darwin-x86_64-nsh',
  ]);
  for (const arch of ['aarch64', 'x86_64']) {
    const native = manifest.platforms[`darwin-${arch}-nsh`];
    assert.equal(native.url,
      `https://github.com/GCWing/OpenBitFun/releases/download/v1.2.3/OpenBitFun-nsh_1.2.3_${arch}.app.tar.gz`);
    // Signatures are copied byte for byte: they cover the archive bytes.
    assert.equal(native.signature, `signature of OpenBitFun-nsh_1.2.3_${arch}.app.tar.gz`);
    assert.deepEqual(manifest.platforms[`darwin-${arch}`], native, 'the Tauri key carries the same archive');
  }
  assert.deepEqual(Object.keys(manifest.manual_installers), [
    'darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-x86_64',
  ]);
  const base = 'https://github.com/GCWing/OpenBitFun/releases/download/v1.2.3';
  assert.deepEqual(manifest.manual_installers['darwin-aarch64'], {
    url: `${base}/OpenBitFun_1.2.3_aarch64.dmg`, signature_url: `${base}/OpenBitFun_1.2.3_aarch64.dmg.sig`,
  });
  assert.equal(manifest.manual_installers['darwin-x86_64'].url, `${base}/OpenBitFun_1.2.3_x64.dmg`);
  assert.equal(manifest.manual_installers['windows-x86_64'].url, `${base}/OpenBitFun-nsh_1.2.3_x64-windows.zip`);
  assert.equal(manifest.manual_installers['linux-x86_64'].url, `${base}/OpenBitFun-nsh_1.2.3_x86_64-linux.tar.gz`);
  assert.equal(manifest.manual_installers['linux-aarch64'].url, `${base}/OpenBitFun-nsh_1.2.3_aarch64-linux.tar.gz`);

  const verified = verify(release.out);
  assert.equal(verified.status, 0, verified.stderr);
});

test('Windows and Linux never get updater keys, and a diverging bridge is rejected', (t) => {
  const release = nativeRelease(t);
  assert.equal(collect(release).status, 0);
  assert.equal(generate(release).status, 0);
  const manifest = JSON.parse(fs.readFileSync(release.out, 'utf8'));
  const write = (next) => fs.writeFileSync(release.out, JSON.stringify(next));

  // An older Tauri package under the newer manifest version would make the
  // installed Tauri app reinstall it in a loop.
  for (const key of ['windows-x86_64', 'linux-x86_64', 'linux-x86_64-deb']) {
    write({ ...manifest, platforms: { ...manifest.platforms, [key]: { url: 'https://x/old', signature: 's' } } });
    const rejected = verify(release.out);
    assert.notEqual(rejected.status, 0, key);
    assert.match(rejected.stderr, /forbidden prefix/);
  }
  write({ ...manifest, platforms: { ...manifest.platforms, 'darwin-aarch64': { url: 'https://x/tauri.app.tar.gz', signature: 's' } } });
  assert.match(verify(release.out).stderr, /Bridge darwin-aarch64 must carry the same archive/);
  const { 'darwin-x86_64': _bridge, ...withoutBridge } = manifest.platforms;
  write({ ...manifest, platforms: withoutBridge });
  assert.notEqual(verify(release.out).status, 0);
});

test('native updater collection rejects archives either updater would refuse', (t) => {
  const release = nativeRelease(t);
  const archive = path.join(release.assets, 'macos-x64', 'bundle', 'macos', 'OpenBitFun-nsh_1.2.3_x86_64.app.tar.gz');
  writeUpdaterArchive(archive, { legacyLink: false });
  let result = collect(release);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing OpenBitFun\.app\/Contents\/MacOS\/openbitfun-desktop/);

  writeUpdaterArchive(archive, { extraTop: true });
  result = collect(release);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected one top-level \.app/);

  writeUpdaterArchive(archive);
  fs.unlinkSync(`${archive}.sig`);
  assert.match(collect(release).stderr, /not signed/);

  writeUpdaterArchive(archive);
  assert.notEqual(collect(release, '1.2.4').status, 0, 'an archive of another version is never published');

  // Tauri bundler outputs must not reach a native release.
  for (const name of ['OpenBitFun_1.2.3_amd64.AppImage', 'OpenBitFun_1.2.3_amd64.deb',
    'OpenBitFun_1.2.3_x64-setup.exe', 'OpenBitFun.app.tar.gz']) {
    const stray = path.join(release.assets, 'stray', name);
    writeSigned(stray, 'tauri');
    const rejected = collect(release);
    assert.notEqual(rejected.status, 0, name);
    assert.match(rejected.stderr, /Tauri updater artifact/);
    fs.rmSync(path.dirname(stray), { recursive: true, force: true });
  }
  assert.equal(collect(release).status, 0);
});

test('every manual download must be present and signed', (t) => {
  const release = nativeRelease(t);
  assert.equal(collect(release).status, 0);
  const zip = path.join(release.assets, 'windows-x64', 'OpenBitFun-nsh_1.2.3_x64-windows.zip');
  fs.unlinkSync(`${zip}.sig`);
  let result = generate(release);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing signed manual installer pair/);
  fs.unlinkSync(zip);
  result = generate(release);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required manual installers: windows-x86_64/);
});

test('desktop release metadata stays synchronized after native extraction', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const result = run('scripts/verify-release-version-sync.mjs', [
    '--version', version,
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test('updater manifest carries the version release notes for the update prompt', (t) => {
  const release = nativeRelease(t, '1.0.3');
  const notes = path.join(release.temp, '1.0.3.md');
  fs.writeFileSync(notes, '系统优化 AI 对话界面与整体性能，让对话更清晰、交互更流畅。\n');
  assert.equal(collect(release, '1.0.3').status, 0);
  const generated = generate(release, '1.0.3', ['--notes-file', notes]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(release.out, 'utf8')).notes,
    '系统优化 AI 对话界面与整体性能，让对话更清晰、交互更流畅。',
  );
});

test('stages GitHub release assets in a flat directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-release-assets-'));
  const first = path.join(temp, 'updater', 'latest.json');
  const second = path.join(temp, 'manual', 'installer.exe');
  const out = path.join(temp, 'staged');
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.mkdirSync(path.dirname(second), { recursive: true });
  fs.writeFileSync(first, 'manifest');
  fs.writeFileSync(second, 'installer');

  const result = run('scripts/stage-github-release-assets.mjs', [
    '--out-dir', out,
    first,
    second,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'), 'manifest');
  assert.equal(fs.readFileSync(path.join(out, 'installer.exe'), 'utf8'), 'installer');
});

test('rejects duplicate GitHub release asset names before upload', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-release-duplicates-'));
  const first = path.join(temp, 'macos-x64', 'OpenBitFun.app.tar.gz.sig');
  const second = path.join(temp, 'macos-arm64', 'OpenBitFun.app.tar.gz.sig');
  const out = path.join(temp, 'staged');
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.mkdirSync(path.dirname(second), { recursive: true });
  fs.writeFileSync(first, 'x64-signature');
  fs.writeFileSync(second, 'arm64-signature');

  const result = run('scripts/stage-github-release-assets.mjs', [
    '--out-dir', out,
    first,
    second,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate release asset name OpenBitFun\.app\.tar\.gz\.sig/);
  assert.match(result.stderr, /macos-x64/);
  assert.match(result.stderr, /macos-arm64/);
});

for (const version of ['1.0.0-beta', '1.0.0-beta.3']) {
test(`${version} Linux CLI and Relay manifests keep signed assets on the versioned repository release`, (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-beta-linux-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const tag = `v${version}`;
  const assets = [];
  for (const target of ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']) {
    for (const name of [`openbitfun-cli-${version}-${target}.tar.gz`, `openbitfun-relay-server-${target}.tar.gz`]) {
      for (const suffix of ['', '.sha256', '.sig', '.sha256.sig']) {
        const filename = path.join(temp, name + suffix);
        fs.writeFileSync(filename, `fixture ${name}${suffix}`);
        assets.push(filename);
      }
    }
  }
  const out = path.join(temp, 'linux-binaries-v1.json');
  const result = run('scripts/generate-linux-binaries-manifest.mjs', [
    '--assets-dir', temp, '--version', version, '--tag', tag,
    '--repo', 'test-owner/OpenBitFun', '--out', out,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.tag, tag);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['linux-aarch64', 'linux-x86_64']);
  for (const platform of Object.values(manifest.platforms)) {
    for (const artifact of [platform.cli, platform.relay]) {
      assert.equal(artifact.url, `https://github.com/test-owner/OpenBitFun/releases/download/${tag}/${artifact.filename}`);
      assert.equal(artifact.sha256Url, `${artifact.url}.sha256`);
      assert.equal(artifact.sigUrl, `${artifact.url}.sig`);
      assert.equal(artifact.sha256SigUrl, `${artifact.url}.sha256.sig`);
    }
  }
  const staged = path.join(temp, 'staged');
  const staging = run('scripts/stage-github-release-assets.mjs', ['--out-dir', staged, ...assets, out]);
  assert.equal(staging.status, 0, staging.stderr);
  assert.deepEqual(fs.readdirSync(staged).sort(), [...assets, out].map((file) => path.basename(file)).sort());
  fs.unlinkSync(assets.find((file) => file.endsWith('.tar.gz')));
  const missing = run('scripts/generate-linux-binaries-manifest.mjs', [
    '--assets-dir', temp, '--version', version, '--tag', tag,
    '--repo', 'test-owner/OpenBitFun', '--out', out,
  ]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Required Linux release asset was not found/);
});

}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
}

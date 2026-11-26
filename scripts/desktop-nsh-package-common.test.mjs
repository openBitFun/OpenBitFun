import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  backendEnv,
  backendResources,
  cargoOutDir,
  computeNativeUiFingerprint,
  copyUiBundle,
  dshProfileResource,
  flashgrepResource,
  nativeUiStampPath,
  parseArgs,
  planNativeUiBuild,
  productIcon,
  resolvePackageProduct,
  root,
  runnerTargetDir,
  shouldParallelizeCargo,
  stageRunnerBinary,
  writeWebBundleManifest,
} from './desktop-nsh-package-common.mjs';
import { bundleIdOf, readUiBundleManifest } from './write-ui-bundle-manifest.mjs';

const ACME = join(root, 'products', 'fixtures', 'acme', 'product.jsonc');

test('package arguments carry the product definition and keep the build options', () => {
  const options = parseArgs(['--', '--profile', 'release-fast', '--product-config', ACME, '--skip-build']);
  assert.equal(options.profile, 'release-fast');
  assert.equal(options.profileDir, 'release-fast');
  assert.equal(options.productConfig, ACME);
  assert.equal(options.skipBuild, true);
  assert.equal(options.updaterArchive, false);
  const defaults = parseArgs([]);
  assert.equal(defaults.profile, 'release');
  assert.equal(defaults.productConfig, undefined);
  assert.equal(parseArgs(['--profile', 'dev']).profileDir, 'debug');
});

test('only a custom product changes the backend build', () => {
  const openbitfun = resolvePackageProduct({});
  assert.deepEqual(openbitfun.productEnv, {});
  assert.equal(openbitfun.identity.fileStem, 'OpenBitFun');

  const acme = resolvePackageProduct({ productConfig: ACME });
  assert.equal(acme.productEnv.OPENBITFUN_PRODUCT_ID, 'acme');
  assert.equal(acme.productEnv.OPENBITFUN_DATA_NAMESPACE, 'acme');
  assert.equal(acme.productEnv.OPENBITFUN_HIDDEN_DATA_DIRECTORY, '.acme');
  assert.match(acme.productEnv.CARGO_TARGET_DIR, /target[\\/]\.product-cache[\\/]/);
  // The backend library of a custom product is read from its own target dir;
  // the product-agnostic runner keeps the regular one.
  const options = { profileDir: 'release', target: undefined };
  assert.equal(cargoOutDir(options, {}), join(root, 'target', 'release'));
  assert.equal(cargoOutDir(options, acme.productEnv), join(acme.productEnv.CARGO_TARGET_DIR, 'release'));

  const env = backendEnv(acme.productEnv, { TAURI_UPDATER_PUBKEY: 'key' });
  assert.equal(env.OPENBITFUN_NATIVE_UPDATER_PUBKEY, 'key');
  assert.equal(env.OPENBITFUN_PRODUCT_ID, 'acme');
});

test('every package ships the workspace search daemon of its target under flashgrep/', () => {
  const ensured = [];
  const ensure = ({ target }) => {
    ensured.push(target);
    return `/cache/${target}`;
  };
  assert.deepEqual(flashgrepResource('x86_64-pc-windows-msvc', { ensure }), [
    '/cache/x86_64-pc-windows-msvc',
    'flashgrep/flashgrep-x86_64-pc-windows-msvc.exe',
  ]);
  // Linux GNU application targets use the static musl daemon, as the backend looks it up.
  assert.deepEqual(flashgrepResource('aarch64-unknown-linux-gnu', { ensure }), [
    '/cache/aarch64-unknown-linux-gnu',
    'flashgrep/flashgrep-aarch64-unknown-linux-musl',
  ]);
  assert.deepEqual(flashgrepResource('aarch64-apple-darwin', { ensure })[1], 'flashgrep/flashgrep-aarch64-apple-darwin');
  assert.deepEqual(ensured, ['x86_64-pc-windows-msvc', 'aarch64-unknown-linux-gnu', 'aarch64-apple-darwin']);
});

test('the DeepSeek Harness profile is copied when built and reported when not', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'openbitfun-dsh-')), 'dist-profile');
  assert.equal(dshProfileResource(missing), null);
  mkdirSync(missing);
  writeFileSync(join(missing, '.openbitfun-bridge.json'), '{"profile":"openbitfun-acp"}');
  assert.deepEqual(dshProfileResource(missing), [missing, 'resources/dsh-profile']);

  const pairs = backendResources({
    webSite: '/web',
    flashgrep: ['/fg', 'flashgrep/flashgrep-aarch64-apple-darwin'],
    dshProfile: [missing, 'resources/dsh-profile'],
  });
  const destinations = pairs.map(([, dest]) => dest);
  assert.ok(destinations.includes('flashgrep/flashgrep-aarch64-apple-darwin'));
  assert.ok(destinations.includes('resources/dsh-profile'));
  assert.ok(destinations.includes('resources/worker_host.js'));
  assert.ok(destinations.includes('resources/agent-companion-pets'));
});

test('package resource paths are the ones the backend resolvers look for', () => {
  // Resource root: `Contents/Resources` (macOS, the executable's `../Resources`)
  // or the executable's directory (Windows, Linux).
  const search = readFileSync(
    join(root, 'src/crates/services/services-integrations/src/workspace_search/service.rs'),
    'utf8',
  );
  assert.match(search, /exe_dir\.join\("\.\.\/Resources\/flashgrep"\)\.join\(binary_name\)/);
  assert.match(search, /exe_dir\.join\("flashgrep"\)\.join\(binary_name\)/);
  const dsh = readFileSync(join(root, 'src/crates/interfaces/acp/src/client/dsh_profile.rs'), 'utf8');
  assert.match(dsh, /directory\.join\("resources"\)\.join\("dsh-profile"\)/);
  assert.match(dsh, /\.join\("Resources"\)\s*\.join\("resources"\)\s*\.join\("dsh-profile"\)/);
  const pets = readFileSync(join(root, 'src/apps/desktop/src/api/companion_pet_api.rs'), 'utf8');
  assert.match(pets, /const BUILTIN_DIR: &str = "agent-companion-pets"/);
  assert.match(pets, /parent\.join\("Resources"\)\.join\("resources"\)\.join\(BUILTIN_DIR\)/);
});

test('the packaged UI bundle carries the product identity in app.json', () => {
  const source = mkdtempSync(join(tmpdir(), 'openbitfun-nsh-out-'));
  writeFileSync(join(source, 'app.json'), JSON.stringify({ id: 'com.openbitfun.desktop', window: { title: 'OpenBitFun' } }));
  writeFileSync(join(source, 'bundle.nshc'), 'bytecode');
  writeFileSync(join(source, 'bundle.js'), 'plain');
  writeFileSync(join(source, 'bundle.js.map'), 'map');
  const dest = join(mkdtempSync(join(tmpdir(), 'openbitfun-nsh-pkg-')), 'nsh');
  const { identity } = resolvePackageProduct({ productConfig: ACME });
  copyUiBundle(source, dest, identity);
  const appJson = JSON.parse(readFileSync(join(dest, 'app.json'), 'utf8'));
  assert.deepEqual(appJson, { id: 'com.acme.desktop', name: 'Acme Desktop', window: { title: 'Acme Desktop' } });
  assert.ok(existsSync(join(dest, 'bundle.nshc')));
  assert.ok(!existsSync(join(dest, 'bundle.js')));
  assert.ok(!existsSync(join(dest, 'bundle.js.map')));
});

test('products without declared icons use the committed OpenBitFun icons', () => {
  const { identity } = resolvePackageProduct({});
  for (const platform of ['macos', 'windows', 'linux']) {
    assert.ok(existsSync(productIcon(identity, platform)), platform);
  }
  assert.equal(productIcon({ icons: { macos: '/brand/app.icns' } }, 'macos'), '/brand/app.icns');
});

test('the packaged web bundle carries its ui-bundle.json, over the untouched files and the product id', () => {
  const site = mkdtempSync(join(tmpdir(), 'nsh-web-'));
  writeFileSync(join(site, 'index.html'), '<!doctype html>');
  writeFileSync(join(site, 'index.html.br'), 'br');
  const bundleId = writeWebBundleManifest(site, { productId: 'acme' });
  const { manifest, bundleId: read } = readUiBundleManifest(site);
  assert.equal(read, bundleId);
  assert.equal(bundleIdOf(manifest), bundleId);
  assert.equal(manifest.product, 'acme');
  assert.equal(readFileSync(join(site, 'index.html'), 'utf8'), '<!doctype html>');
  // No web bundle: reported, nothing written, the package answers ui_bundle_unavailable.
  const empty = mkdtempSync(join(tmpdir(), 'nsh-web-empty-'));
  assert.equal(writeWebBundleManifest(empty, { productId: 'openbitfun' }), null);
  assert.equal(existsSync(join(empty, 'ui-bundle.json')), false);
});

test('native UI build planning skips up-to-date bundles and keeps stamps outside nshOut', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'openbitfun-native-ui-plan-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(join(work, 'src/nsh-ui/src'), { recursive: true });
  mkdirSync(join(work, 'src/apps/desktop-nsh/src'), { recursive: true });
  writeFileSync(join(work, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  writeFileSync(join(work, 'src/nsh-ui/App.tsx'), 'export const a = 1;\n');
  writeFileSync(join(work, 'src/apps/desktop-nsh/App.tsx'), 'export const b = 1;\n');

  const fp1 = computeNativeUiFingerprint({ rootDir: work, target: 'aarch64-apple-darwin', release: false, nshVersion: '0.7.0' });
  const fpRelease = computeNativeUiFingerprint({ rootDir: work, target: 'aarch64-apple-darwin', release: true, nshVersion: '0.7.0' });
  const fpWin = computeNativeUiFingerprint({ rootDir: work, target: 'x86_64-pc-windows-msvc', release: false, nshVersion: '0.7.0' });
  assert.equal(fp1.apple, true);
  assert.equal(fpWin.apple, false);
  assert.notEqual(fp1.fingerprint, fpRelease.fingerprint);
  assert.notEqual(fp1.fingerprint, fpWin.fingerprint);

  const nshOut = join(work, 'out', 'nsh');
  mkdirSync(nshOut, { recursive: true });
  writeFileSync(join(nshOut, 'bundle.nshc'), 'bytecode');
  writeFileSync(join(nshOut, 'app.json'), '{"name":"OpenBitFun"}');
  const stampFile = nativeUiStampPath(nshOut);
  assert.equal(stampFile.startsWith(`${nshOut}${join('/', '')}`), false, 'stamp must live outside nshOut');
  assert.equal(planNativeUiBuild({ nshOut, fingerprint: fp1.fingerprint, apple: true }).shouldBuild, true);

  writeFileSync(stampFile, JSON.stringify({ schema: 1, fingerprint: fp1.fingerprint }));
  assert.equal(planNativeUiBuild({ nshOut, fingerprint: fp1.fingerprint, apple: true }).shouldBuild, false);
  assert.equal(planNativeUiBuild({ nshOut, fingerprint: fp1.fingerprint, apple: true, force: true }).shouldBuild, true);
  // Non-Apple bundles also require font notices.
  assert.equal(planNativeUiBuild({ nshOut, fingerprint: fp1.fingerprint, apple: false }).shouldBuild, true);
});

test('runner builds in isolated target/desktop-nsh-runner and stages next to backend lib', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'openbitfun-runner-stage-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const env = { CARGO_TARGET_DIR: work };
  assert.equal(runnerTargetDir(env), join(work, 'desktop-nsh-runner'));

  const binName = process.platform === 'win32' ? 'openbitfun-nsh.exe' : 'openbitfun-nsh';
  const runnerSrc = join(runnerTargetDir(env), 'desktop-dev', binName);
  mkdirSync(join(runnerTargetDir(env), 'desktop-dev'), { recursive: true });
  writeFileSync(runnerSrc, 'runner-v1');
  const dest = stageRunnerBinary({ profileDir: 'desktop-dev', target: undefined, env });
  assert.equal(dest, join(work, 'desktop-dev', binName));
  assert.equal(readFileSync(dest, 'utf8'), 'runner-v1');
  // Re-staging unchanged binary is a no-op; missing target fails loudly.
  assert.equal(stageRunnerBinary({ profileDir: 'desktop-dev', target: undefined, env }), dest);
  assert.throws(
    () => stageRunnerBinary({ profileDir: 'desktop-dev', target: 'x86_64-pc-windows-msvc', env }),
    /Runner binary was not produced/,
  );

  assert.equal(shouldParallelizeCargo({ profile: 'desktop-dev', env: { CI: 'true' }, totalMemBytes: 8e9 }), true);
  assert.equal(shouldParallelizeCargo({ profile: 'release', env: { CI: 'true' }, totalMemBytes: 32e9 }), false);
  assert.equal(shouldParallelizeCargo({ profile: 'release', env: {}, totalMemBytes: 32 * 1024 ** 3 }), true);
  assert.equal(shouldParallelizeCargo({ profile: 'release', env: { OPENBITFUN_PARALLEL_CARGO: '0' }, totalMemBytes: 64 * 1024 ** 3 }), false);
  assert.equal(shouldParallelizeCargo({ profile: 'release', env: { OPENBITFUN_PARALLEL_CARGO: '1', CI: 'true' }, totalMemBytes: 8e9 }), true);
});

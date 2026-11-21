import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MANIFEST_FILE,
  buildUiBundleManifest,
  bundleIdOf,
  canonicalJson,
  isValidBundlePath,
  readUiBundleManifest,
  resolveBundleDir,
  sha256Hex,
  validateManifest,
  writeUiBundleManifest,
} from './write-ui-bundle-manifest.mjs';

const FIXTURE = new URL('../src/crates/adapters/obp/src/ui_bundle_fixture.json', import.meta.url);

test('canonical form and bundle id match the shared fixture (the Rust twin checks the same file)', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(canonicalJson(fixture.manifest), fixture.canonical);
  assert.equal(bundleIdOf(fixture.manifest), fixture.bundleId);
  validateManifest(fixture.manifest);
  // Key order of the input never matters.
  assert.equal(bundleIdOf(JSON.parse(fixture.canonical)), fixture.bundleId);
});

test('canonical numbers are safe integers and strings are well formed', () => {
  assert.equal(canonicalJson([1.0, -0, -7]), '[1,0,-7]');
  assert.throws(() => canonicalJson(1.5), /safe integer/);
  assert.throws(() => canonicalJson(2 ** 53), /safe integer/);
  assert.throws(() => canonicalJson('\uD800'), /lone surrogate/);
  assert.equal(canonicalJson({ b: '\u0001\u007f', a: '\u2028' }), '{"a":"\u2028","b":"\\u0001\u007f"}');
});

test('paths stay inside the bundle', () => {
  for (const good of ['index.html', 'a/b.js', 'browser.b998e17dc5/host.js', 'é/😀.css', 'a b/c']) {
    assert.ok(isValidBundlePath(good), good);
  }
  for (const bad of ['', '/index.html', 'a//b', './a', 'a/./b', '../a', 'a/..', 'a/../b', 'a\\b', 'C:/x', 'a\u0000b', 'a\nb', 'a\u007f', 'a/', 'a'.repeat(1025)]) {
    assert.ok(!isValidBundlePath(bad), JSON.stringify(bad));
  }
});

function bundle(files) {
  const out = mkdtempSync(join(tmpdir(), 'ui-bundle-'));
  const dir = join(out, 'OpenBitFun');
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return { out, dir };
}

test('the manifest lists runtime files with their br siblings, sorted, and skips siblings and dot-files', () => {
  const { out, dir } = bundle({
    'index.html': '<!doctype html>',
    'index.html.br': 'br-index',
    'index.html.gz': 'gz-index',
    'browser.b998e17dc5/z.js': 'z',
    'browser.b998e17dc5/a.js': 'a',
    'nsh.6b263a5662.wasm': 'wasm',
    'lonely.br': 'no base file',
    '.DS_Store': 'finder',
  });
  assert.equal(resolveBundleDir(out), dir);
  const { bundleDir, manifest, bundleId } = writeUiBundleManifest(out, { version: '9.9.9', nsh: '0.6.1' });
  assert.equal(bundleDir, dir);
  assert.deepEqual(manifest.files.map(file => file.path), [
    'browser.b998e17dc5/a.js',
    'browser.b998e17dc5/z.js',
    'index.html',
    'lonely.br',
    'nsh.6b263a5662.wasm',
  ]);
  const index = manifest.files.find(file => file.path === 'index.html');
  assert.equal(index.sha256, sha256Hex(Buffer.from('<!doctype html>')));
  assert.equal(index.size, 15);
  assert.deepEqual(index.br, { sha256: sha256Hex(Buffer.from('br-index')), size: 8 });
  assert.equal(manifest.files.find(file => file.path === 'nsh.6b263a5662.wasm').br, undefined);
  assert.deepEqual(
    { schema: manifest.schema, product: manifest.product, version: manifest.version, nsh: manifest.nsh, entry: manifest.entry },
    { schema: 1, product: 'openbitfun', version: '9.9.9', nsh: '0.6.1', entry: 'index.html' },
  );
  // What was written is what was returned, and re-reading agrees.
  const written = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8'));
  assert.deepEqual(written, manifest);
  assert.equal(readUiBundleManifest(dir).bundleId, bundleId);
  // Writing again over the same files (the old manifest is not a file of the
  // bundle) gives the same id.
  assert.equal(writeUiBundleManifest(dir, { version: '9.9.9', nsh: '0.6.1' }).bundleId, bundleId);
  // Any byte change gives another id.
  writeFileSync(join(dir, 'browser.b998e17dc5/a.js'), 'A');
  assert.notEqual(bundleIdOf(buildUiBundleManifest(dir, { version: '9.9.9', nsh: '0.6.1' })), bundleId);
  assert.throws(() => readUiBundleManifest(dir), /a\.js|does not match/);
});

test('invalid manifests are refused', () => {
  const file = path => ({ path, sha256: '0'.repeat(64), size: 1 });
  const base = files => ({ schema: 1, product: 'p', version: 'v', nsh: 'n', entry: 'index.html', files });
  assert.throws(() => validateManifest({ ...base([file('index.html')]), schema: 2 }), /schema 2/);
  assert.throws(() => validateManifest(base([file('../x'), file('index.html')])), /invalid file path/);
  assert.throws(() => validateManifest(base([file('index.html'), file('a.js')])), /sorted/);
  assert.throws(() => validateManifest(base([file('a.js')])), /entry/);
  assert.throws(() => validateManifest(base([{ ...file('index.html'), size: 1.5 }])), /sha256\/size/);
  validateManifest({ ...base([file('index.html')]), future: { x: 1 } });
});

test('a directory without a bundle is an error, not an empty manifest', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ui-bundle-empty-'));
  assert.throws(() => writeUiBundleManifest(empty), /no web bundle/);
});

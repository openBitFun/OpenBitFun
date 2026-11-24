import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  computeDesktopWebSourceFingerprint,
  planDesktopWebBuild,
  swapBundleDirectory,
} from './build-desktop-web-ui.mjs';
import { writeUiBundleManifest } from './write-ui-bundle-manifest.mjs';

function makeFixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'openbitfun-desktop-web-'));
  mkdirSync(path.join(dir, 'src', 'nsh-ui', 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'src', 'nsh-ui', 'test'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  writeFileSync(path.join(dir, 'scripts', 'write-ui-bundle-manifest.mjs'), '// manifest writer');
  writeFileSync(path.join(dir, 'src', 'nsh-ui', 'WebApp.tsx'), 'export const app = 1;\n');
  writeFileSync(path.join(dir, 'src', 'nsh-ui', 'src', 'scene.tsx'), 'export const scene = "v1";\n');
  writeFileSync(path.join(dir, 'src', 'nsh-ui', 'test', 'scene.test.tsx'), 'test("ignored", () => {});\n');
  return dir;
}

test('source fingerprint changes on UI source edits and ignores test files', () => {
  const repo = makeFixtureRepo();
  try {
    const first = computeDesktopWebSourceFingerprint({ rootDir: repo, nshVersion: '0.6.1' });
    // Editing a test file does not invalidate the web bundle.
    writeFileSync(path.join(repo, 'src', 'nsh-ui', 'test', 'scene.test.tsx'), 'test("changed", () => {});\n');
    const afterTestEdit = computeDesktopWebSourceFingerprint({ rootDir: repo, nshVersion: '0.6.1' });
    assert.equal(afterTestEdit, first);

    // Editing a runtime UI file invalidates the web bundle.
    writeFileSync(path.join(repo, 'src', 'nsh-ui', 'src', 'scene.tsx'), 'export const scene = "v2";\n');
    const afterUiEdit = computeDesktopWebSourceFingerprint({ rootDir: repo, nshVersion: '0.6.1' });
    assert.notEqual(afterUiEdit, first);

    // Changing NSH toolchain version invalidates the web bundle.
    const afterNshBump = computeDesktopWebSourceFingerprint({ rootDir: repo, nshVersion: '0.6.2' });
    assert.notEqual(afterNshBump, afterUiEdit);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('planDesktopWebBuild skips up-to-date bundles, rebuilds on drift, and respects opt-out', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openbitfun-desktop-web-plan-'));
  try {
    const outDir = path.join(dir, 'web');
    const bundleDir = path.join(outDir, 'OpenBitFun');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><html>v1</html>');
    const { bundleId } = writeUiBundleManifest(bundleDir, { version: '2.0.0', nsh: '0.6.1' });
    writeFileSync(
      path.join(outDir, '.build-stamp.json'),
      JSON.stringify({ schema: 1, fingerprint: 'fp-1', bundleDirName: 'OpenBitFun', bundleId, nsh: '0.6.1' }),
    );

    assert.deepEqual(planDesktopWebBuild({ outDir, fingerprint: 'fp-1', env: {} }), {
      shouldBuild: false,
      reason: 'up to date',
      bundleId,
    });
    assert.equal(planDesktopWebBuild({ outDir, fingerprint: 'fp-2', env: {} }).shouldBuild, true);
    assert.equal(planDesktopWebBuild({ outDir, fingerprint: 'fp-1', force: true, env: {} }).shouldBuild, true);
    assert.equal(
      planDesktopWebBuild({ outDir, fingerprint: 'fp-2', env: { OPENBITFUN_DESKTOP_WEB_UI: 'off' } }).shouldBuild,
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('swapBundleDirectory replaces the previous bundle atomically without leaving stale files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openbitfun-desktop-web-swap-'));
  try {
    const outDir = path.join(dir, 'web');
    const oldBundle = path.join(outDir, 'OpenBitFun');
    mkdirSync(oldBundle, { recursive: true });
    writeFileSync(path.join(oldBundle, 'app.old.js'), 'old');
    writeFileSync(path.join(oldBundle, 'index.html'), 'old');

    const staged = path.join(dir, 'web.staging', 'OpenBitFun');
    mkdirSync(staged, { recursive: true });
    writeFileSync(path.join(staged, 'app.new.js'), 'new');
    writeFileSync(path.join(staged, 'index.html'), 'new');

    const { finalBundleDir } = swapBundleDirectory(staged, outDir);
    assert.equal(finalBundleDir, oldBundle);
    assert.equal(existsSync(path.join(finalBundleDir, 'app.old.js')), false);
    assert.equal(readFileSync(path.join(finalBundleDir, 'app.new.js'), 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop-nsh:build keeps the web UI bundle in lockstep with the native bundle', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['desktop-nsh:web'], /build-desktop-web-ui\.mjs/);
  assert.match(pkg.scripts['desktop-nsh:build'], /desktop-nsh:bundle/);
  assert.match(pkg.scripts['desktop-nsh:build'], /desktop-nsh:web/);
});

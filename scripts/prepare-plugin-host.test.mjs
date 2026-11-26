import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  computePluginHostFingerprints,
  planPluginHostPrepare,
  preparePluginHost,
} from './prepare-plugin-host.mjs';

function makeHostFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'openbitfun-plugin-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{"name":"ext-host"}\n');
  writeFileSync(path.join(dir, 'bun.lock'), 'lock-v1\n');
  writeFileSync(path.join(dir, 'tsconfig.json'), '{}\n');
  writeFileSync(path.join(dir, 'src', 'main.ts'), 'export const v = 1;\n');
  return dir;
}

test('preparePluginHost skips install and build when fingerprints are current', (t) => {
  const hostDir = makeHostFixture(t);
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'install') {
      mkdirSync(path.join(hostDir, 'node_modules'), { recursive: true });
    } else if (args[0] === 'run' && args[1] === 'build') {
      mkdirSync(path.join(hostDir, 'dist'), { recursive: true });
      writeFileSync(path.join(hostDir, 'dist', 'extension-host.js'), 'bundle-v1');
    }
    return { status: 0 };
  };

  const first = preparePluginHost({ hostDir, run });
  assert.equal(first.installed, true);
  assert.equal(first.built, true);
  assert.deepEqual(calls, [
    ['bun', 'install', '--frozen-lockfile'],
    ['bun', 'run', 'build'],
  ]);

  // Warm run does zero subprocesses.
  calls.length = 0;
  const second = preparePluginHost({ hostDir, run });
  assert.equal(second.installed, false);
  assert.equal(second.built, false);
  assert.deepEqual(calls, []);

  // Source edit rebuilds without reinstalling node_modules.
  writeFileSync(path.join(hostDir, 'src', 'main.ts'), 'export const v = 2;\n');
  const third = preparePluginHost({ hostDir, run });
  assert.equal(third.installed, false);
  assert.equal(third.built, true);
  assert.deepEqual(calls, [['bun', 'run', 'build']]);

  // Lockfile change triggers both install and build.
  calls.length = 0;
  writeFileSync(path.join(hostDir, 'bun.lock'), 'lock-v2\n');
  const fourth = preparePluginHost({ hostDir, run });
  assert.equal(fourth.installed, true);
  assert.equal(fourth.built, true);
  assert.deepEqual(calls, [
    ['bun', 'install', '--frozen-lockfile'],
    ['bun', 'run', 'build'],
  ]);
});

test('preparePluginHost supports optional skip when bun is unavailable and detects deleted outputs', (t) => {
  const hostDir = makeHostFixture(t);
  const skipped = preparePluginHost({
    hostDir,
    optional: true,
    run: () => ({ status: 1, error: new Error('ENOENT') }),
  });
  assert.equal(skipped.skipped, true);
  assert.equal(existsSync(path.join(hostDir, 'dist', 'extension-host.js')), false);

  const fp1 = computePluginHostFingerprints(hostDir);
  const plan = planPluginHostPrepare({ hostDir });
  assert.equal(plan.needsInstall, true);
  assert.equal(plan.needsBuild, true);
  assert.equal(plan.installFingerprint, fp1.installFingerprint);
});

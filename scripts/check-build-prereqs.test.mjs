import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const scriptPath = path.join(repoRoot, 'scripts/check-build-prereqs.mjs');

function createFakeNsh(binDir, version = '0.6.1') {
  mkdirSync(binDir, { recursive: true });
  const fakeScript = path.join(binDir, 'fake-nsh.cjs');
  writeFileSync(
    fakeScript,
    `console.log('nsh ${version} (test)');\n`,
  );
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(binDir, 'nsh.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-nsh.cjs" %*\r\n`,
    );
  } else {
    const nshPath = path.join(binDir, 'nsh');
    writeFileSync(
      nshPath,
      `#!/usr/bin/env node\nrequire('./fake-nsh.cjs');\n`,
    );
    chmodSync(nshPath, 0o755);
  }
}

function createTestRoot({
  nodeModules = false,
  nsh = nodeModules,
  pluginHostDist = false,
  sherpaOnnx = null,
  virtualStoreEntries = null,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'openbitfun-build-prereqs-'));

  if (nodeModules) {
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  }

  if (nsh) {
    createFakeNsh(path.join(root, 'node_modules', '.bin'));
  }

  // Maps a virtual store package path, relative to the root, to the files it
  // should contain. An empty file list models a package whose files are gone.
  if (virtualStoreEntries) {
    for (const [relativeDir, files] of Object.entries(virtualStoreEntries)) {
      const packageDir = path.join(root, relativeDir);
      mkdirSync(packageDir, { recursive: true });
      for (const file of files) {
        writeFileSync(path.join(packageDir, file), '{}');
      }
    }
  }

  if (pluginHostDist) {
    const distDir = path.join(
      root,
      'src',
      'apps',
      'extension-host',
      'dist',
    );
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'extension-host.js'), '');
  }

  if (sherpaOnnx) {
    for (const version of sherpaOnnx) {
      const libDir = path.join(
        root,
        'target',
        'sherpa-onnx-prebuilt',
        version,
        'lib',
      );
      mkdirSync(libDir, { recursive: true });
      writeFileSync(path.join(libDir, 'libsherpa-onnx-c-api.a'), '');
    }
  }

  return root;
}

function createFakePnpm() {
  const binDir = mkdtempSync(path.join(tmpdir(), 'openbitfun-fake-pnpm-'));
  const fakePnpmPath = path.join(binDir, 'fake-pnpm.cjs');
  writeFileSync(
    fakePnpmPath,
    `
const { chmodSync, existsSync, mkdirSync, writeFileSync } = require('fs');
const path = require('path');
const args = process.argv.slice(2);
function writeFakeNsh() {
  const binDir = path.join('node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, 'fake-nsh.cjs'), "console.log('nsh 0.6.1 (test)');\\n");
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(binDir, 'nsh.cmd'),
      '@echo off\\r\\n"' + process.execPath + '" "%~dp0fake-nsh.cjs" %*\\r\\n',
    );
  } else {
    const nshPath = path.join(binDir, 'nsh');
    writeFileSync(nshPath, "#!/usr/bin/env node\\nrequire('./fake-nsh.cjs');\\n");
    chmodSync(nshPath, 0o755);
  }
}
if (args[0] === 'install') {
  mkdirSync('node_modules', { recursive: true });
  writeFakeNsh();
  const restorePath = process.env.FAKE_PNPM_RESTORE_PATH;
  if (restorePath) {
    // Records whether the broken package was still present when install ran,
    // which is what pnpm itself would trip over.
    if (process.env.FAKE_PNPM_REPORT_PATH) {
      writeFileSync(
        process.env.FAKE_PNPM_REPORT_PATH,
        JSON.stringify({ dirExistedWhenInstallRan: existsSync(restorePath) }),
      );
    }
    mkdirSync(restorePath, { recursive: true });
    writeFileSync(path.join(restorePath, 'package.json'), '{}');
  }
} else if (args[0] === 'run' && args[1] === 'plugin-host:prepare') {
  mkdirSync('src/apps/extension-host/dist', { recursive: true });
  writeFileSync('src/apps/extension-host/dist/extension-host.js', '');
} else if (args[0] === 'run' && args[1] === 'nsh:install') {
  writeFakeNsh();
}
`,
  );
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(binDir, 'pnpm.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-pnpm.cjs" %*\r\n`,
    );
  } else {
    const pnpmPath = path.join(binDir, 'pnpm');
    writeFileSync(
      pnpmPath,
      `#!/usr/bin/env node\nrequire('./fake-pnpm.cjs');\n`,
    );
    chmodSync(pnpmPath, 0o755);
  }
  return binDir;
}

function runCheck(
  root,
  { fix = false, extraPath = null, sherpaEnv = null, extraEnv = null } = {},
) {
  const env = {
    ...process.env,
    OPENBITFUN_BUILD_PREREQS_TEST_ROOT: root,
  };
  if (extraPath) {
    env.PATH = `${extraPath}${path.delimiter}${env.PATH || ''}`;
  }
  if (sherpaEnv !== null) {
    if (sherpaEnv === '') {
      delete env.SHERPA_ONNX_LIB_DIR;
    } else {
      env.SHERPA_ONNX_LIB_DIR = sherpaEnv;
    }
  }
  if (extraEnv) {
    Object.assign(env, extraEnv);
  }

  const args = fix ? [scriptPath, '--fix'] : [scriptPath];

  return spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8',
  });
}

test('passes when all prerequisites are present (including sherpa-onnx prebuilt)', (t) => {
  const root = createTestRoot({
    nodeModules: true,
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
    virtualStoreEntries: {
      'node_modules/.pnpm/typescript@5.8.3/node_modules/typescript': ['package.json'],
      'node_modules/.pnpm/@openbitfun+ui@0.1.0/node_modules/@openbitfun/ui': [
        'package.json',
      ],
    },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Build prerequisite check passed/);
  assert.doesNotMatch(result.stderr, /\[WARN\]/);
});

test('fails when a pnpm virtual store package has no files', (t) => {
  const root = createTestRoot({
    nodeModules: true,
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
    virtualStoreEntries: {
      'node_modules/.pnpm/typescript@5.8.3/node_modules/typescript': [],
    },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] pnpm virtual store/);
  assert.match(
    result.stderr,
    /node_modules[\\/]\.pnpm[\\/]typescript@5\.8\.3[\\/]node_modules[\\/]typescript/,
  );
  assert.match(result.stderr, /Fix: pnpm install/);
  assert.match(result.stderr, /does not repair this/);
});

test('--fix removes broken virtual store packages before running pnpm install', (t) => {
  const binDir = createFakePnpm();
  const brokenRelativeDir =
    'node_modules/.pnpm/typescript@5.8.3/node_modules/typescript';
  const root = createTestRoot({
    nodeModules: true,
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
    virtualStoreEntries: { [brokenRelativeDir]: [] },
  });
  const reportPath = path.join(root, 'fake-pnpm-report.json');
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  const result = runCheck(root, {
    fix: true,
    extraPath: binDir,
    sherpaEnv: '',
    extraEnv: {
      FAKE_PNPM_RESTORE_PATH: path.join(root, brokenRelativeDir),
      FAKE_PNPM_REPORT_PATH: reportPath,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    /Removing broken package directory node_modules[\\/]\.pnpm[\\/]typescript@5\.8\.3[\\/]node_modules[\\/]typescript/,
  );
  assert.match(result.stdout, /\$ pnpm install/);
  assert.match(result.stdout, /All errors resolved/);
  // The empty directory has to be gone before install runs; pnpm does not
  // repair a package directory that still exists with no files.
  assert.equal(
    JSON.parse(readFileSync(reportPath, 'utf8')).dirExistedWhenInstallRan,
    false,
  );
});

test('fails when root node_modules is missing', (t) => {
  const root = createTestRoot({
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] root node_modules/);
  assert.match(result.stderr, /Fix: pnpm install/);
});

test('does not require the DeepSeek profile for cargo check', (t) => {
  const root = createTestRoot({
    nodeModules: true,
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /dsh bridge profile/);
  assert.doesNotMatch(result.stderr, /prepare:dsh-profile/);
});

test('fails when OpenCode extension Host dist is missing', (t) => {
  const root = createTestRoot({
    nodeModules: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] OpenCode extension Host dist/);
  assert.match(result.stderr, /Fix: pnpm run plugin-host:prepare/);
});

test('warns when sherpa-onnx prebuilt dir does not exist (first build)', (t) => {
  const root = createTestRoot({
    nodeModules: true,
    pluginHostDist: true,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /\[WARN\] sherpa-onnx/);
  assert.match(result.stderr, /first build will download from GitHub/);
});

test('exits with error code when both errors and warnings are present', (t) => {
  const root = createTestRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runCheck(root, { sherpaEnv: '' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\]/);
  assert.match(result.stderr, /\[WARN\] sherpa-onnx/);
});

test('--fix runs fix commands, re-verifies, and exits 0 when errors resolved', (t) => {
  const binDir = createFakePnpm();
  const root = createTestRoot();
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  const result = runCheck(root, { fix: true, extraPath: binDir, sherpaEnv: '' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Attempting fixes/);
  assert.match(result.stdout, /\$ pnpm install/);
  assert.match(result.stdout, /\$ pnpm run plugin-host:prepare/);
  assert.doesNotMatch(result.stdout, /prepare:dsh-profile/);
  assert.match(result.stdout, /Re-checking prerequisites/);
  assert.match(result.stdout, /All errors resolved/);
});

test('fails when pinned NSH CLI is missing and --fix runs pnpm run nsh:install', (t) => {
  const binDir = createFakePnpm();
  const root = createTestRoot({
    nodeModules: true,
    nsh: false,
    pluginHostDist: true,
    sherpaOnnx: ['sherpa-onnx-v1.13.4-osx-arm64-static-lib'],
  });
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  const isolatedEnv = {
    OPENBITFUN_NSH_DIR: path.join(root, 'missing-nsh'),
    PATH: [binDir, path.dirname(process.execPath)].join(path.delimiter),
  };

  const failed = runCheck(root, { sherpaEnv: '', extraEnv: isolatedEnv });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /\[FAIL\] NSH CLI/);
  assert.match(failed.stderr, /Fix: pnpm run nsh:install/);

  const fixed = runCheck(root, { fix: true, sherpaEnv: '', extraEnv: isolatedEnv });
  assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
  assert.match(fixed.stdout, /\$ pnpm run nsh:install/);
  assert.match(fixed.stdout, /All errors resolved/);
});

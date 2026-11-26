import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { COMPOSER_ICON, ROOT, macosSourceDigest, readMacosFallback } from './macos-icon-assets.mjs';
import { requireModernIconTools, verifyMacosIconBundle } from './macos-icon-bundle.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', windowsHide: true, ...options,
});

test('macOS uses a full-bleed Composer source and a current independent legacy export', async () => {
  const source = json(join(COMPOSER_ICON, 'icon.json'));
  assert.deepEqual(source['supported-platforms'], { squares: ['macOS'] });
  assert.equal(source.fill.solid, 'srgb:0.00000,0.00000,0.00000,1.00000');
  const mark = await sharp(join(COMPOSER_ICON, 'Assets/Mark.png')).metadata();
  assert.equal(mark.width, 1024);
  assert.equal(mark.height, 1024);
  assert.equal(mark.hasAlpha, true);
  assert.ok(readMacosFallback().length > 0);
  assert.equal(json(join(ROOT, 'assets/brand/macos/generated.json')).sourceSha256, macosSourceDigest());
});

test('Windows autocrlf checkout preserves the committed macOS icon source digest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-icon-checkout-'));
  const files = [
    '.gitattributes',
    'scripts/macos-icon-assets.mjs',
    'assets/brand/macos/openbitfun.icon/icon.json',
    'assets/brand/macos/openbitfun.icon/Assets/Mark.png',
    'assets/brand/macos/legacy-canvas.json',
    'assets/brand/macos/generated.json',
    'assets/brand/exports/openbitfun-app-icon.icns',
  ];
  const git = (...args) => run('git', args, { cwd: directory });
  try {
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(directory, file));
    }
    git('add', '--', ...files);
    git('config', 'core.autocrlf', 'true');
    for (const file of files) rmSync(join(directory, file));
    git('checkout-index', '--all', '--force');
    const verify = () => run(process.execPath, ['--input-type=module', '-e',
      "import { readMacosFallback } from './scripts/macos-icon-assets.mjs'; readMacosFallback();"],
    { cwd: directory });
    verify();

    // Rebuilding an immutable tag predating the attributes must also work
    // when the release runner disables conversion before checkout.
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(directory, '.gitattributes'), '');
    git('add', '--', '.gitattributes');
    for (const file of files) rmSync(join(directory, file));
    git('checkout-index', '--all', '--force');
    verify();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the native desktop bundle uses the committed legacy ICNS export', () => {
  const packaging = readFileSync(join(ROOT, 'scripts/package-desktop-nsh-macos.mjs'), 'utf8');
  const common = readFileSync(join(ROOT, 'scripts/desktop-nsh-package-common.mjs'), 'utf8');
  // A product definition may declare its own icons; the default product uses the committed export.
  assert.match(packaging, /\[productIcon\(identity, "macos"\), "AppIcon\.icns"\]/);
  assert.match(common, /macos: "icns"/);
  assert.match(common, /src\/apps\/desktop\/icons\/openbitfun-app-icon\.\$\{extension\}/);
  assert.match(packaging, /<key>CFBundleIconFile<\/key><string>AppIcon<\/string>/);
  assert.deepEqual(readFileSync(join(ROOT, 'src/apps/desktop/icons/openbitfun-app-icon.icns')), readMacosFallback());
});

test('missing, old, and unparseable actool fail instead of silently dropping modern icons', () => {
  assert.throws(() => requireModernIconTools(() => { throw new Error('not found'); }), /full Xcode 26/);
  for (const output of ['short-bundle-version: 16.4', 'bundle-version: 24411']) {
    assert.throws(() => requireModernIconTools(() => output), /refusing to silently omit/);
  }
  for (const version of ['26.2', '27.0']) {
    const calls = [];
    requireModernIconTools((command, args) => {
      calls.push([command, args]);
      return `/* com.apple.actool.version */\nshort-bundle-version: ${version}\n`;
    });
    assert.deepEqual(calls[1], ['xcrun', ['--find', 'assetutil']]);
  }
});

test('bundle validation rejects a missing catalog, wrong icon name, and mismatched fallback', () => {
  const app = mkdtempSync(join(tmpdir(), 'openbitfun-icon-validation-'));
  const resources = join(app, 'Contents/Resources');
  mkdirSync(resources, { recursive: true });
  let plist = { CFBundleIconName: 'Icon', CFBundleIconFile: 'app.icns' };
  let assets = [{ AssetType: 'Icon Image', Name: 'Icon' }];
  const execute = command => JSON.stringify(command.endsWith('plutil') ? plist : assets);
  const fallback = Buffer.from('fixture legacy data');
  const verify = () => verifyMacosIconBundle(app, { execute, fallback });
  try {
    assert.throws(verify, /ENOENT/);
    writeFileSync(join(resources, 'Assets.car'), 'fixture catalog');
    writeFileSync(join(resources, 'app.icns'), fallback);
    verify();
    assets = [{ AssetType: 'Image', Name: 'Icon' }];
    assert.throws(verify, /no Icon Image/);
    assets = [{ AssetType: 'Icon Image', Name: 'WrongName' }];
    assert.throws(verify, /no Icon Image/);
    assets = [{ AssetType: 'Icon Image', Name: 'Icon' }];
    writeFileSync(join(resources, 'app.icns'), 'wrong fallback');
    assert.throws(verify, /differs/);
    plist = { CFBundleIconFile: 'app.icns' };
    assert.throws(verify, /both CFBundleIconName/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('Apple iconutil decodes all ten legacy/Retina representations with Dock margins', {
  skip: process.platform !== 'darwin',
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-icon-decode-'));
  try {
    const iconset = join(directory, 'fallback.iconset');
    run('/usr/bin/iconutil', ['--convert', 'iconset', '--output', iconset,
      join(ROOT, 'assets/brand/exports/openbitfun-app-icon.icns')]);
    const files = readdirSync(iconset).filter(file => file.endsWith('.png'));
    assert.equal(files.length, 10);
    for (const file of files) {
      const { data, info } = await sharp(join(iconset, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const size = info.width;
      assert.equal(info.height, size);
      let first = -1;
      let last = -1;
      for (let x = 0; x < size; x++) {
        assert.equal(data[x * 4 + 3], 0, `${file} top margin`);
        if (data[(Math.floor(size / 2) * size + x) * 4 + 3] >= 128) {
          if (first < 0) first = x;
          last = x;
        }
      }
      assert.ok(first >= size * 0.07 && first <= size * 0.14, `${file} body size`);
      assert.ok(Math.abs(first - (size - 1 - last)) <= 1, `${file} centered body`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

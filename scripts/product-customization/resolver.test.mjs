import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { ProductDefinitionError, resolveProductDefinition } from './resolver.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ACME = join(ROOT, 'products', 'fixtures', 'acme', 'product.jsonc');

test('default and custom members resolve through one deterministic contract', () => {
  const openbitfun = resolveProductDefinition({ rootDir: ROOT, member: 'desktop' });
  const desktop = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' });
  const cli = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'cli' });

  assert.equal(openbitfun.assembly.productId, 'openbitfun');
  assert.equal(openbitfun.assembly.dataNamespace, 'openbitfun');
  assert.equal(openbitfun.assembly.binaryName, 'openbitfun-desktop');
  assert.equal(openbitfun.assembly.bundleId, 'com.openbitfun.desktop');
  assert.equal(desktop.assembly.bundleId, 'com.acme.desktop');
  assert.equal(cli.assembly.binaryName, 'acme');
  assert.equal(cli.assembly.bundleId, undefined);
  assert.notEqual(desktop.assembly.assemblyDigest, cli.assembly.assemblyDigest);
  assert.equal(
    resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' })
      .assembly.assemblyDigest,
    desktop.assembly.assemblyDigest,
  );
});

test('localized names are validated against the shared locale contract', () => {
  const resolution = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' });
  assert.equal(resolution.productNames['en-US'], 'Acme Desktop');
  assert.equal(resolution.productNames['zh-CN'], 'Acme 桌面版');
  assert.match(resolution.assembly.localeDigest, /^[a-f0-9]{64}$/);
});

test('schema version one rejects future owner sections instead of pretending to support them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-product-c0a-'));
  const source = readFileSync(ACME, 'utf8').replace(
    /\n}\s*$/,
    ',\n  "assets": { "desktopAppIcon": "icon.png" }\n}\n',
  );
  const config = join(directory, 'product.jsonc');
  writeFileSync(config, source, 'utf8');

  assert.throws(
    () => resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'desktop' }),
    (error) => error instanceof ProductDefinitionError && error.code === 'unknown_field',
  );
});

test('locale paths cannot escape the product definition directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-product-c0a-'));
  const source = readFileSync(ACME, 'utf8').replace('"./locales"', '"../"');
  const config = join(directory, 'product.jsonc');
  writeFileSync(config, source, 'utf8');

  assert.throws(
    () => resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'desktop' }),
    (error) => error instanceof ProductDefinitionError && error.code === 'resource_path_escape',
  );
});

test('invalid member and unsafe binary identity fail with stable codes', () => {
  assert.throws(
    () => resolveProductDefinition({ rootDir: ROOT, member: 'server' }),
    (error) => error instanceof ProductDefinitionError && error.code === 'invalid_member',
  );

  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-product-c0a-'));
  cpSync(join(ROOT, 'products', 'fixtures', 'acme', 'locales'), join(directory, 'locales'), {
    recursive: true,
  });
  const source = readFileSync(ACME, 'utf8').replace('"binaryName": "acme"', '"binaryName": "CON"');
  const config = join(directory, 'product.jsonc');
  writeFileSync(config, source, 'utf8');
  assert.throws(
    () => resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'cli' }),
    (error) => error instanceof ProductDefinitionError && error.code === 'invalid_binary_name',
  );
});

test('product and data identities reject display names and path fragments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-product-identity-'));
  cpSync(join(ROOT, 'products', 'fixtures', 'acme', 'locales'), join(directory, 'locales'), {
    recursive: true,
  });
  const source = readFileSync(ACME, 'utf8').replace('"productId": "acme"', '"productId": "Acme/CLI"');
  const config = join(directory, 'product.jsonc');
  writeFileSync(config, source, 'utf8');

  assert.throws(
    () => resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'cli' }),
    (error) => error instanceof ProductDefinitionError && error.code === 'invalid_stable_id',
  );
});

function acmeWithIcons(icons, { iconFiles = ['app.icns', 'app.ico', 'app.png'] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'openbitfun-product-icons-'));
  cpSync(join(ROOT, 'products', 'fixtures', 'acme', 'locales'), join(directory, 'locales'), {
    recursive: true,
  });
  mkdirSync(join(directory, 'icons'));
  const sources = { 'app.icns': 'icns', 'app.ico': 'ico', 'app.png': 'png' };
  for (const name of iconFiles) {
    cpSync(join(ROOT, 'src', 'apps', 'desktop', 'icons', `openbitfun-app-icon.${sources[name]}`), join(directory, 'icons', name));
  }
  const source = readFileSync(ACME, 'utf8').replace(
    '"bundleId": "com.acme.desktop"',
    `"bundleId": "com.acme.desktop",\n      "icons": ${JSON.stringify(icons)}`,
  );
  const config = join(directory, 'product.jsonc');
  writeFileSync(config, source, 'utf8');
  return { directory, config };
}

const ACME_ICONS = { macos: './icons/app.icns', windows: './icons/app.ico', linux: './icons/app.png' };

test('desktop icons resolve to owned files and enter the assembly digest', () => {
  const { directory, config } = acmeWithIcons(ACME_ICONS);
  const withIcons = resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'desktop' });
  const without = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' });
  assert.equal(withIcons.desktopIcons.macos, realpathSync.native(join(directory, 'icons', 'app.icns')));
  assert.equal(withIcons.desktopIcons.windows, realpathSync.native(join(directory, 'icons', 'app.ico')));
  assert.equal(withIcons.desktopIcons.linux, realpathSync.native(join(directory, 'icons', 'app.png')));
  assert.match(withIcons.assembly.iconDigest, /^[a-f0-9]{64}$/);
  assert.equal(without.desktopIcons, null);
  assert.equal(without.assembly.iconDigest, undefined);
  assert.notEqual(withIcons.assembly.assemblyDigest, without.assembly.assemblyDigest);
  // The CLI member ships no desktop icons.
  const cli = resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'cli' });
  assert.equal(cli.desktopIcons, null);
  assert.equal(cli.assembly.iconDigest, undefined);
});

test('desktop icons are complete, typed and stay inside the definition directory', () => {
  const cases = [
    [{ macos: './icons/app.icns', windows: './icons/app.ico' }, 'missing_required_field'],
    [{ ...ACME_ICONS, ios: './icons/app.png' }, 'unknown_field'],
    [{ ...ACME_ICONS, macos: './icons/app.png' }, 'invalid_resource_type'],
    [{ ...ACME_ICONS, linux: '../outside.png' }, 'resource_path_escape'],
    [{ ...ACME_ICONS, windows: './icons/missing.ico' }, 'resource_not_found'],
  ];
  for (const [icons, code] of cases) {
    const { config } = acmeWithIcons(icons);
    assert.throws(
      () => resolveProductDefinition({ rootDir: ROOT, productConfig: config, member: 'desktop' }),
      (error) => error instanceof ProductDefinitionError && error.code === code,
      code,
    );
  }
});

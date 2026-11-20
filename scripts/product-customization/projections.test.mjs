import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  desktopPackageIdentity,
  ensureProductOutputDirectory,
  productBuildEnvironment,
  projectNshAppJson,
} from './projections.mjs';
import { resolveProductDefinition } from './resolver.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ACME = join(ROOT, 'products', 'fixtures', 'acme', 'product.jsonc');

test('CLI package output uses one deterministic bounded product directory', () => {
  const resolution = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'cli' });
  const first = ensureProductOutputDirectory(resolution);
  const second = ensureProductOutputDirectory(resolution);

  assert.equal(first, second);
  assert.ok(existsSync(first));
  assert.match(first, /target[\\/]product-assembly[\\/]/);
});

test('build environment isolates custom Cargo output without overriding the default', () => {
  const defaultResolution = resolveProductDefinition({ rootDir: ROOT, member: 'cli' });
  const customResolution = resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'cli' });
  const defaultEnvironment = productBuildEnvironment(defaultResolution);
  const customEnvironment = productBuildEnvironment(customResolution);

  assert.equal(defaultEnvironment.CARGO_TARGET_DIR, undefined);
  assert.match(customEnvironment.CARGO_TARGET_DIR, /target[\\/]\.product-cache[\\/]/);
  assert.equal(customEnvironment.OPENBITFUN_PRODUCT_ID, 'acme');
  assert.equal(customEnvironment.OPENBITFUN_DATA_NAMESPACE, 'acme');
  assert.equal(customEnvironment.OPENBITFUN_HIDDEN_DATA_DIRECTORY, '.acme');
  assert.equal(customEnvironment.OPENBITFUN_PRODUCT_BINARY_NAME, 'acme');
  assert.equal(customEnvironment.OPENBITFUN_PRODUCT_DISPLAY_NAME, 'Acme CLI');
});

test('desktop packages take the product identity from the desktop member', () => {
  const openbitfun = desktopPackageIdentity(resolveProductDefinition({ rootDir: ROOT, member: 'desktop' }));
  assert.deepEqual(
    {
      displayName: openbitfun.displayName,
      fileStem: openbitfun.fileStem,
      bundleId: openbitfun.bundleId,
      binaryName: openbitfun.binaryName,
      productId: openbitfun.productId,
      icons: openbitfun.icons,
      isDefaultProduct: openbitfun.isDefaultProduct,
    },
    {
      displayName: 'OpenBitFun',
      fileStem: 'OpenBitFun',
      bundleId: 'com.openbitfun.desktop',
      binaryName: 'openbitfun-desktop',
      productId: 'openbitfun',
      icons: null,
      isDefaultProduct: true,
    },
  );
  const acme = desktopPackageIdentity(resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' }));
  assert.equal(acme.displayName, 'Acme Desktop');
  assert.equal(acme.fileStem, 'Acme-Desktop');
  assert.equal(acme.bundleId, 'com.acme.desktop');
  assert.equal(acme.binaryName, 'acme-desktop');
  assert.equal(acme.isDefaultProduct, false);
  assert.throws(
    () => desktopPackageIdentity(resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'cli' })),
    /invalid_member/,
  );
});

test('the NSH app description carries the product id, name and window title', () => {
  const acme = desktopPackageIdentity(resolveProductDefinition({ rootDir: ROOT, productConfig: ACME, member: 'desktop' }));
  const built = {
    id: 'com.openbitfun.desktop',
    window: { title: 'OpenBitFun', titleBar: { style: 'hidden', height: 44 }, restoreBounds: true },
  };
  const projected = projectNshAppJson(built, acme);
  assert.equal(projected.id, 'com.acme.desktop');
  assert.equal(projected.name, 'Acme Desktop');
  assert.deepEqual(projected.window, { ...built.window, title: 'Acme Desktop' });
  assert.equal(built.id, 'com.openbitfun.desktop', 'the build output object is not mutated');
});

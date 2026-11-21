#!/usr/bin/env node
// Writes `ui-bundle.json` (schema 1) into a web package of `src/nsh-ui`: the
// manifest a device hands a browser (`ui_bundle_manifest`) so the browser runs
// exactly the UI that device ships, loading its files by hash through the
// server's pool and verifying every byte (see
// `docs/architecture/unified-client-architecture.md`, "Browsers load the web
// UI from the device").
//
// Every web packaging path calls it after the bundle's files are final:
// `pnpm run desktop-nsh:web`, the desktop packages (`desktop-nsh-package-common.mjs`),
// the CLI build (`cli-product.mjs`, `src/apps/cli/install.*`, which embed the
// bundle) and the web controller (`build-web-controller.mjs`).
//
//   node scripts/write-ui-bundle-manifest.mjs <dir> [--product id] [--version v] [--nsh v]
//
// `<dir>` is the bundle (it holds `index.html`) or an `nsh package -o` output
// holding exactly one bundle directory.
//
// Format. `files` lists every runtime file except the `.br`/`.gz` siblings of
// another file, the manifest itself and dot-files, sorted by path (UTF-16 code
// units, JavaScript's default sort); paths are POSIX and relative with no
// `.`/`..`/empty segments, no backslash, colon or control character. `br` is
// present when `<path>.br` exists. The bundle id is the lowercase hex SHA-256
// of the canonical manifest bytes (`canonicalJson`: keys sorted, no
// whitespace, UTF-8, numbers only as safe integers). The Rust twin is
// `openbitfun_obp::ui_bundle`; both are checked against
// `src/crates/adapters/obp/src/ui_bundle_fixture.json`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_FILE = 'ui-bundle.json';
export const MANIFEST_SCHEMA = 1;
const MAX_PATH_LENGTH = 1024;
const SIBLING_EXTENSIONS = ['.br', '.gz'];

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Canonical JSON text: sorted keys, no whitespace, safe integers only. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(`number ${value} is not a safe integer; manifests carry integers only`);
      }
      return String(value);
    case 'string':
      if (!value.isWellFormed()) throw new Error('a string holds a lone surrogate');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map(key => {
        if (!key.isWellFormed()) throw new Error('a key holds a lone surrogate');
        return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
      }).join(',')}}`;
    }
    default:
      throw new Error(`${typeof value} is not a JSON value`);
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The bundle id of a manifest: SHA-256 of its canonical UTF-8 bytes. */
export function bundleIdOf(manifest) {
  return sha256Hex(Buffer.from(canonicalJson(manifest), 'utf8'));
}

export function isValidBundlePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && Buffer.byteLength(path, 'utf8') <= MAX_PATH_LENGTH
    // eslint-disable-next-line no-control-regex
    && !/[\\:\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

const isSha256 = text => typeof text === 'string' && /^[0-9a-f]{64}$/.test(text);
const isSize = size => Number.isSafeInteger(size) && size >= 0;

/** Throws unless `manifest` is a valid schema-1 manifest (unknown fields allowed). */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('the manifest is not a JSON object');
  if (manifest.schema !== MANIFEST_SCHEMA) throw new Error(`manifest schema ${manifest.schema} is not supported`);
  for (const key of ['product', 'version', 'entry']) {
    if (typeof manifest[key] !== 'string') throw new Error(`\`${key}\` is not a string`);
  }
  if (!Array.isArray(manifest.files)) throw new Error('`files` is not an array');
  let previous = null;
  for (const file of manifest.files) {
    if (!isValidBundlePath(file?.path)) throw new Error(`invalid file path ${JSON.stringify(file?.path)}`);
    if (!isSha256(file.sha256) || !isSize(file.size)) throw new Error(`file ${file.path} has no valid sha256/size`);
    if (file.br != null && (!isSha256(file.br.sha256) || !isSize(file.br.size))) {
      throw new Error(`file ${file.path}.br has no valid sha256/size`);
    }
    if (previous !== null && !(previous < file.path)) throw new Error(`\`files\` is not sorted by path or lists ${file.path} twice`);
    previous = file.path;
  }
  if (!manifest.files.some(file => file.path === manifest.entry)) throw new Error(`the entry ${manifest.entry} is not one of the files`);
  canonicalJson(manifest);
  return manifest;
}

function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listFiles(dir, relative));
    else if (entry.isFile()) found.push(relative);
    else throw new Error(`unsupported entry in the web bundle (symlink or special file): ${relative}`);
  }
  return found;
}

/** The bundle directory of `dir`: itself, or its only child holding `index.html`. */
export function resolveBundleDir(dir) {
  const absolute = resolve(dir);
  if (existsSync(join(absolute, 'index.html'))) return absolute;
  const children = existsSync(absolute)
    ? readdirSync(absolute, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    : [];
  const bundles = children.filter(entry => existsSync(join(absolute, entry.name, 'index.html')));
  if (bundles.length === 1) return join(absolute, bundles[0].name);
  throw new Error(`no web bundle (a directory with index.html) in ${absolute}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The NSH toolchain version (`nsh --version`), or "unknown". */
export function nshVersion() {
  const result = spawnSync('nsh', ['--version'], { encoding: 'utf8', windowsHide: true });
  return String(result.stdout ?? '').match(/\b(\d+\.\d+\.\d+[^\s]*)/)?.[1] ?? 'unknown';
}

/** Builds the manifest of the bundle in `bundleDir` (no write). */
export function buildUiBundleManifest(bundleDir, { product = 'openbitfun', version, nsh } = {}) {
  const paths = listFiles(bundleDir).filter(path => path !== MANIFEST_FILE);
  const present = new Set(paths);
  const isSibling = path => SIBLING_EXTENSIONS.some(extension => path.endsWith(extension) && present.has(path.slice(0, -extension.length)));
  const files = paths
    .filter(path => !isSibling(path))
    .sort()
    .map(path => {
      const bytes = readFileSync(join(bundleDir, path));
      const file = { path, sha256: sha256Hex(bytes), size: bytes.length };
      if (present.has(`${path}.br`)) {
        const br = readFileSync(join(bundleDir, `${path}.br`));
        file.br = { sha256: sha256Hex(br), size: br.length };
      }
      return file;
    });
  const manifest = {
    schema: MANIFEST_SCHEMA,
    product,
    version: version ?? readJson(join(root, 'package.json')).version,
    nsh: nsh ?? nshVersion(),
    entry: 'index.html',
    files,
  };
  return validateManifest(manifest);
}

/**
 * Writes `ui-bundle.json` into the bundle of `dir` (atomically) and returns
 * `{ bundleDir, manifest, bundleId }`.
 */
export function writeUiBundleManifest(dir, options = {}) {
  const bundleDir = resolveBundleDir(dir);
  const manifest = buildUiBundleManifest(bundleDir, options);
  const target = join(bundleDir, MANIFEST_FILE);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(staging, target);
  return { bundleDir, manifest, bundleId: bundleIdOf(manifest) };
}

/** Reads the manifest of a bundle directory and checks every file against it. */
export function readUiBundleManifest(bundleDir) {
  const manifest = validateManifest(readJson(join(bundleDir, MANIFEST_FILE)));
  const check = (path, expected) => {
    const bytes = readFileSync(join(bundleDir, path));
    if (bytes.length !== expected.size || sha256Hex(bytes) !== expected.sha256) {
      throw new Error(`${path} does not match ${MANIFEST_FILE}`);
    }
  };
  for (const file of manifest.files) {
    check(file.path, file);
    if (file.br) check(`${file.path}.br`, file.br);
  }
  return { manifest, bundleId: bundleIdOf(manifest) };
}

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dir = argv.find((arg, index) => !arg.startsWith('--') && !argv[index - 1]?.startsWith('--'));
  if (!dir) {
    console.error('usage: node scripts/write-ui-bundle-manifest.mjs <dir> [--product id] [--version v] [--nsh v]');
    process.exit(2);
  }
  try {
    const { bundleDir, manifest, bundleId } = writeUiBundleManifest(dir, {
      product: option(argv, 'product'),
      version: option(argv, 'version'),
      nsh: option(argv, 'nsh'),
    });
    console.log(`[ui-bundle] ${manifest.files.length} files, bundleId ${bundleId}: ${join(bundleDir, MANIFEST_FILE)}`);
  } catch (error) {
    console.error(`[ui-bundle] ${error.message}`);
    process.exit(1);
  }
}

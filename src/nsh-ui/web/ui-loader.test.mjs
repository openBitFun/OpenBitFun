// The UI loader (`ui-loader.js`) under Node's WebCrypto with fakes for Cache
// Storage, IndexedDB and the pool: the bundleId against the shared fixture,
// manifest checks, verification before anything is served or cached, the
// `.br` copy first, the failure redirect, and 30-day pruning.
//
//   node --test src/nsh-ui/web/ui-loader.test.mjs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const source = readFileSync(join(here, 'ui-loader.js'), 'utf8');

function loadLoader() {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    TextEncoder,
    Response,
    Headers,
    Request,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
  });
  vm.runInContext(source, context, { filename: 'ui-loader.js' });
  return context.ObfUiLoader;
}

const loader = loadLoader();
const subtle = globalThis.crypto.subtle;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'https://super.openbitfun.com/b/';
const LAUNCHER = 'https://super.openbitfun.com/';
const CAS = 'https://super.openbitfun.com/cas/';

test('the bundleId matches the shared fixture (JS writer, Rust and this loader agree)', async () => {
  const fixture = JSON.parse(readFileSync(join(root, 'src/crates/adapters/obp/src/ui_bundle_fixture.json'), 'utf8'));
  assert.equal(loader.canonicalJson(fixture.manifest), fixture.canonical);
  assert.equal(await loader.bundleIdOf(subtle, fixture.manifest), fixture.bundleId);
  // Key order in the received JSON never matters.
  const reordered = JSON.parse(JSON.stringify(fixture.manifest, Object.keys(fixture.manifest).reverse()));
  reordered.files = fixture.manifest.files;
  reordered.zeta = fixture.manifest.zeta;
  assert.equal(await loader.bundleIdOf(subtle, reordered), fixture.bundleId);
});

test('canonical JSON refuses what the writer refuses', () => {
  assert.throws(() => loader.canonicalJson({ size: 1.5 }), /safe integer/);
  assert.throws(() => loader.canonicalJson({ size: 2 ** 53 }), /safe integer/);
  assert.throws(() => loader.canonicalJson({ text: '\ud800' }), /lone surrogate/);
  assert.throws(() => loader.canonicalJson({ ['\udc00']: 1 }), /lone surrogate/);
  assert.equal(loader.canonicalJson({ b: [1, { d: null, c: 'x' }], a: true }), '{"a":true,"b":[1,{"c":"x","d":null}]}');
});

test('paths: POSIX, relative, no escapes', () => {
  for (const good of ['index.html', 'a/b.js', 'a b/ünï.js', 'browser.b998e17dc5/host.js']) {
    assert.equal(loader.validPath(good), true, good);
  }
  for (const bad of ['', '/index.html', '../x', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'c:x', 'a\u0001', 'a/', '.', '..']) {
    assert.equal(loader.validPath(bad), false, JSON.stringify(bad));
  }
});

function file(path, bytes, br) {
  const entry = { path, sha256: sha(bytes), size: bytes.length };
  if (br) entry.br = { sha256: sha(br), size: br.length };
  return entry;
}

test('manifest checks: newer schema is its own state, invalid ones are refused', () => {
  const ok = { schema: 1, entry: 'index.html', files: [file('index.html', Buffer.from('x'))] };
  loader.checkManifest(ok);
  loader.checkManifest({ ...ok, future: { field: 1 } });
  assert.throws(() => loader.checkManifest({ ...ok, schema: 2 }), /^Error: ui_bundle_schema:/);
  assert.throws(() => loader.checkManifest({ ...ok, entry: 'missing.html' }), /ui_bundle_invalid/);
  assert.throws(() => loader.checkManifest({ ...ok, files: [{ ...ok.files[0], path: '../index.html' }] }), /ui_bundle_invalid/);
  assert.throws(() => loader.checkManifest({ ...ok, files: [ok.files[0], ok.files[0]] }), /twice/);
  assert.throws(() => loader.checkManifest({ ...ok, files: [{ ...ok.files[0], sha256: 'ABC' }] }), /sha256/);
  assert.throws(() => loader.checkManifest({ schema: 1 }), /ui_bundle_invalid/);
});

test('MIME types come from the extension', () => {
  assert.equal(loader.mimeOf('nsh.6b263a5662.wasm'), 'application/wasm');
  assert.equal(loader.mimeOf('index.html'), 'text/html; charset=utf-8');
  assert.equal(loader.mimeOf('browser.b998e17dc5/host.js'), 'text/javascript; charset=utf-8');
  assert.equal(loader.mimeOf('nsh-page.6c2c70f7ae.css'), 'text/css; charset=utf-8');
  assert.equal(loader.mimeOf('manifest.webmanifest'), 'application/manifest+json');
  assert.equal(loader.mimeOf('LICENSES'), 'application/octet-stream');
});

test('bundle URLs', () => {
  const id = 'a'.repeat(64);
  assert.deepEqual({ ...loader.parseBundleUrl(`${SCOPE}${id}/index.html?x=1`, SCOPE) }, { bundleId: id, path: 'index.html' });
  assert.deepEqual({ ...loader.parseBundleUrl(`${SCOPE}${id}/`, SCOPE) }, { bundleId: id, path: '' });
  assert.deepEqual({ ...loader.parseBundleUrl(`${SCOPE}${id}/a%20b/%C3%BCn%C3%AF.js`, SCOPE) }, { bundleId: id, path: 'a b/ünï.js' });
  assert.equal(loader.parseBundleUrl(`${SCOPE}nothex/index.html`, SCOPE), null);
  assert.equal(loader.parseBundleUrl('https://super.openbitfun.com/obp/api/v1/session', SCOPE), null);
  assert.equal(loader.parseBundleUrl(`https://elsewhere.example/app/b/${id}/index.html`, SCOPE), null);
});

/** A fake worker environment: records, caches, the pool and a clock. */
function environment({ pool = new Map(), now = 1_700_000_000_000 } = {}) {
  const records = new Map();
  const caches = new Map();
  const fetched = [];
  const navigated = [];
  const clock = { now };
  const env = {
    subtle,
    now: () => clock.now,
    scopeUrl: SCOPE,
    casUrl: CAS,
    launcherUrl: LAUNCHER,
    records: {
      get: async id => (records.has(id) ? structuredClone(records.get(id)) : undefined),
      put: async record => void records.set(record.bundleId, structuredClone(record)),
      remove: async id => void records.delete(id),
      all: async () => [...records.values()].map(record => structuredClone(record)),
    },
    caches: {
      open: async name => {
        if (!caches.has(name)) caches.set(name, new Map());
        const store = caches.get(name);
        return {
          match: async key => (store.has(key) ? store.get(key).clone() : undefined),
          put: async (key, response) => void store.set(key, response),
        };
      },
      delete: async name => caches.delete(name),
    },
    fetch: async (url, init) => {
      fetched.push({ url, init });
      const hash = new URL(url).pathname.split('/').pop();
      const entry = pool.get(hash);
      if (typeof entry === 'function') return entry(url);
      if (!entry) return new Response('missing', { status: 404 });
      // `Content-Encoding: br` decoded by the browser: the body is the file.
      return new Response(entry, { status: 200 });
    },
    navigateClient: async (clientId, url) => void navigated.push({ clientId, url }),
  };
  return { env, records, caches, fetched, navigated, clock, pool };
}

function bundle() {
  const index = Buffer.from('<!doctype html><title>device</title>');
  const app = Buffer.from('console.log("device ui")');
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const appBr = Buffer.from('fake-br-bytes');
  const manifest = {
    schema: 1,
    product: 'openbitfun',
    version: '1.0.11',
    nsh: '0.6.1',
    entry: 'index.html',
    files: [file('app.1234567890.js', app, appBr), file('index.html', index), file('nsh.6b263a5662.wasm', wasm)],
  };
  return { manifest, index, app, appBr, wasm };
}

const navigate = url => ({ method: 'GET', url, mode: 'navigate' });
const get = url => ({ method: 'GET', url, mode: 'cors' });

test('store recomputes the id and serves verified files, caching them', async () => {
  const { manifest, index, app, wasm } = bundle();
  const world = environment();
  world.pool.set(sha(index), index);
  // The `.br` copy is asked for first; the pool decodes to the file.
  world.pool.set(manifest.files[0].br.sha256, app);
  world.pool.set(sha(wasm), wasm);
  const ui = loader.createUiLoader(world.env);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1', bundleId: 'f'.repeat(64) });
  assert.equal(bundleId, await loader.bundleIdOf(subtle, manifest));
  assert.equal(world.records.get(bundleId).deviceId, 'desk-1');

  const page = await ui.handle(navigate(`${SCOPE}${bundleId}/index.html`), 'c1');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.match(page.headers.get('Content-Security-Policy'), /wasm-unsafe-eval/);
  assert.equal(Buffer.from(await page.arrayBuffer()).toString(), index.toString());
  assert.equal(world.fetched[0].url, `${CAS}${sha(index)}?device=desk-1`);
  assert.equal(world.fetched[0].init.credentials, 'same-origin');

  const script = await ui.handle(get(`${SCOPE}${bundleId}/app.1234567890.js`), 'c1');
  assert.equal(script.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  assert.equal(world.fetched[1].url, `${CAS}${manifest.files[0].br.sha256}?device=desk-1`);
  const module = await ui.handle(get(`${SCOPE}${bundleId}/nsh.6b263a5662.wasm`), 'c1');
  assert.equal(module.headers.get('Content-Type'), 'application/wasm');

  // The directory is the entry; a second load comes from Cache Storage.
  const before = world.fetched.length;
  const again = await ui.handle(navigate(`${SCOPE}${bundleId}/`), 'c1');
  assert.equal(Buffer.from(await again.arrayBuffer()).toString(), index.toString());
  assert.equal(world.fetched.length, before);
  // Requests outside a stored bundle go to the network untouched.
  assert.equal(await ui.handle(get('https://super.openbitfun.com/obp/api/v1/devices'), 'c1'), null);
  assert.equal((await ui.handle(get(`${SCOPE}${bundleId}/not-listed.js`), 'c1')).status, 404);
});

test('the plain file is the fallback when the pool has no .br copy', async () => {
  const { manifest, app } = bundle();
  const world = environment();
  world.pool.set(sha(app), app);
  const ui = loader.createUiLoader(world.env);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1' });
  const response = await ui.handle(get(`${SCOPE}${bundleId}/app.1234567890.js`), 'c1');
  assert.equal(response.status, 200);
  assert.deepEqual(
    world.fetched.map(entry => new URL(entry.url).pathname.split('/').pop()),
    [manifest.files[0].br.sha256, sha(app)],
  );
});

test('a mismatch is never served or cached; the page goes back to the launcher naming the file', async () => {
  const { manifest, index, app } = bundle();
  const world = environment();
  world.pool.set(sha(index), Buffer.from('<!doctype html><script>evil()</script>'));
  world.pool.set(manifest.files[0].br.sha256, Buffer.from('tampered'));
  world.pool.set(sha(app), app);
  const ui = loader.createUiLoader(world.env);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1' });

  const page = await ui.handle(navigate(`${SCOPE}${bundleId}/index.html`), 'c1');
  assert.equal(page.status, 302);
  const target = new URL(page.headers.get('Location'));
  assert.equal(`${target.origin}${target.pathname}`, LAUNCHER);
  const reason = new URLSearchParams(target.hash.slice(1));
  assert.equal(reason.get('ui-error'), 'verification');
  assert.equal(reason.get('file'), 'index.html');

  // A tampered `.br` copy is a hard failure too, not a reason to try another copy.
  const script = await ui.handle(get(`${SCOPE}${bundleId}/app.1234567890.js`), 'c7');
  assert.equal(script.status, 502);
  assert.equal(world.navigated[0].clientId, 'c7');
  assert.equal(new URLSearchParams(new URL(world.navigated[0].url).hash.slice(1)).get('file'), 'app.1234567890.js');
  assert.equal(world.caches.get(`obf-ui-${bundleId}`).size, 0);
});

test('a missing file names the file; a signed-out pool says so; an unknown bundle goes back to the launcher', async () => {
  const { manifest } = bundle();
  const world = environment();
  const ui = loader.createUiLoader(world.env);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1' });
  const page = await ui.handle(navigate(`${SCOPE}${bundleId}/index.html`), 'c1');
  const reason = new URLSearchParams(new URL(page.headers.get('Location')).hash.slice(1));
  assert.equal(reason.get('ui-error'), 'unavailable');
  assert.equal(reason.get('file'), 'index.html');

  world.pool.set(sha(Buffer.from('<!doctype html><title>device</title>')), () => new Response('', { status: 401 }));
  const signedOut = await ui.handle(navigate(`${SCOPE}${bundleId}/index.html`), 'c1');
  assert.equal(new URLSearchParams(new URL(signedOut.headers.get('Location')).hash.slice(1)).get('ui-error'), 'signed_out');

  const unknown = await ui.handle(navigate(`${SCOPE}${'e'.repeat(64)}/index.html`), 'c1');
  assert.equal(unknown.status, 302);
  assert.equal(unknown.headers.get('Location'), LAUNCHER);
});

test('a record altered in storage is not used', async () => {
  const { manifest, index } = bundle();
  const world = environment();
  world.pool.set(sha(index), index);
  const ui = loader.createUiLoader(world.env);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1' });
  const altered = world.records.get(bundleId);
  altered.manifest.files[1].sha256 = 'd'.repeat(64);
  world.records.set(bundleId, altered);
  const fresh = loader.createUiLoader(world.env);
  const response = await fresh.handle(navigate(`${SCOPE}${bundleId}/index.html`), 'c1');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), LAUNCHER);
});

test('a newer manifest schema is refused with its own code; devices are remembered per bundle', async () => {
  const { manifest } = bundle();
  const world = environment();
  const ui = loader.createUiLoader(world.env);
  await assert.rejects(ui.storeManifest({ manifest: { ...manifest, schema: 2 }, deviceId: 'desk-1' }), /^Error: ui_bundle_schema:/);
  await assert.rejects(ui.storeManifest({ manifest, deviceId: '' }), /ui_bundle_invalid/);
  const { bundleId } = await ui.storeManifest({ manifest, deviceId: 'desk-1' });
  await ui.storeManifest({ manifest, deviceId: 'cli-2' });
  assert.deepEqual(world.records.get(bundleId).devices, ['cli-2', 'desk-1']);
  assert.equal(world.records.get(bundleId).deviceId, 'cli-2');
});

test('bundles unused for 30 days are dropped with their cached files', async () => {
  const old = bundle();
  const world = environment();
  world.pool.set(sha(old.index), old.index);
  const ui = loader.createUiLoader(world.env);
  const first = await ui.storeManifest({ manifest: old.manifest, deviceId: 'desk-1' });
  await ui.handle(navigate(`${SCOPE}${first.bundleId}/index.html`), 'c1');
  assert.equal(world.caches.has(`obf-ui-${first.bundleId}`), true);

  world.clock.now += 29 * 24 * 3600 * 1000;
  const next = { ...old.manifest, version: '1.0.12' };
  const second = await ui.storeManifest({ manifest: next, deviceId: 'desk-1' });
  assert.equal(world.records.has(first.bundleId), true);

  world.clock.now += 2 * 24 * 3600 * 1000;
  await ui.storeManifest({ manifest: next, deviceId: 'desk-1' });
  assert.equal(world.records.has(first.bundleId), false);
  assert.equal(world.caches.has(`obf-ui-${first.bundleId}`), false);
  assert.equal(world.records.has(second.bundleId), true);
});

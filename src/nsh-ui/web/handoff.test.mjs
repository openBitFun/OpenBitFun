// The page realm's half of the device-UI handoff (`host.js`): handoff v1 is
// a frozen cross-version contract, so it is tested with literal v1 payloads.
// It also covers how a device UI page under `/b/<bundleId>/` finds its
// controller parameters and its device.
//
//   node --test src/nsh-ui/web/handoff.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bundlePageOf,
  bundlePageParams,
  controllerPageState,
  readControllerHandoff,
  writeControllerHandoff,
} from '../host.js';

const KEY = 'obf.controller.handoff.v1';
const ID = '7de424f309d96a12332bcfee931587ac88555143b9d7d404794c4abc876e0771';

function storage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: key => void map.delete(key),
    map,
  };
}

function place(href) {
  const url = new URL(href);
  return { href: url.href, origin: url.origin, protocol: url.protocol, host: url.host, pathname: url.pathname, hash: url.hash };
}

test('handoff v1 payloads are read as written by any launcher version', () => {
  assert.deepEqual(readControllerHandoff(storage({ [KEY]: '{"v":1,"deviceId":"desk-1","at":1700000000000}' })), {
    v: 1,
    deviceId: 'desk-1',
    at: 1700000000000,
  });
  // A later launcher only ever adds fields; they are kept, never required.
  assert.deepEqual(
    readControllerHandoff(storage({ [KEY]: '{"v":1,"deviceId":"desk-1","at":5,"entry":"sessions","extra":{"x":1}}' })),
    { v: 1, deviceId: 'desk-1', at: 5, entry: 'sessions', extra: { x: 1 } },
  );
  // `at` is informational.
  assert.equal(readControllerHandoff(storage({ [KEY]: '{"v":1,"deviceId":"desk-1"}' })).at, null);
});

test('anything but a v1 handoff with a device is no handoff', () => {
  for (const text of [
    null,
    '',
    'not json',
    '[]',
    'null',
    '{"deviceId":"desk-1","at":1}',
    '{"v":2,"deviceId":"desk-1","at":1}',
    '{"v":"1","deviceId":"desk-1","at":1}',
    '{"v":1,"at":1}',
    '{"v":1,"deviceId":"","at":1}',
    '{"v":1,"deviceId":7,"at":1}',
  ]) {
    assert.equal(readControllerHandoff(storage(text === null ? {} : { [KEY]: text })), null, String(text));
  }
  assert.equal(readControllerHandoff(null), null);
  assert.equal(
    readControllerHandoff({
      getItem() {
        throw new Error('SecurityError');
      },
    }),
    null,
  );
});

test('the launcher writes exactly the v1 shape', () => {
  const store = storage();
  writeControllerHandoff(store, 'desk-1', 1700000000123);
  assert.equal(store.map.get(KEY), '{"v":1,"deviceId":"desk-1","at":1700000000123}');
  assert.deepEqual(readControllerHandoff(store), { v: 1, deviceId: 'desk-1', at: 1700000000123 });
});

test('a device UI page knows its launcher, bundle and controller parameters', () => {
  const page = place(`https://super.openbitfun.com/b/${ID}/index.html#device=desk-1`);
  assert.deepEqual(bundlePageOf(page), { launcher: 'https://super.openbitfun.com/', bundleId: ID });
  assert.deepEqual(bundlePageParams(page), {
    controller: {
      api: 'https://super.openbitfun.com/obp/api/v1',
      gateway: 'wss://super.openbitfun.com/obp',
      uiBundleId: ID,
      bundlePage: true,
    },
  });
  assert.deepEqual(bundlePageOf(place(`https://super.openbitfun.com/b/${ID}/facades/a.js`))?.bundleId, ID);
  // The launcher itself, a desktop-served page and a dev page are not.
  assert.equal(bundlePageOf(place('https://super.openbitfun.com/')), null);
  assert.equal(bundlePageOf(place('http://192.168.1.5:8790/index.html')), null);
  assert.equal(bundlePageOf(place('https://super.openbitfun.com/b/not-a-bundle/index.html')), null);
  assert.equal(bundlePageParams(place('https://super.openbitfun.com/')), null);
});

test('page state: the handoff names the device; the fragment covers a new tab; launcher fragments are one-shot facts', () => {
  const page = place(`https://super.openbitfun.com/b/${ID}/index.html#device=desk-1`);
  const handed = controllerPageState(page, storage({ [KEY]: '{"v":1,"deviceId":"desk-1","at":1}' }));
  assert.deepEqual(handed, { handoff: { v: 1, deviceId: 'desk-1', at: 1 }, showDevices: false, uiError: null });
  const newTab = controllerPageState(page, storage());
  assert.equal(newTab.handoff.deviceId, 'desk-1');
  // Explicit `#device=` wins over a stale sessionStorage handoff for another device.
  const explicit = controllerPageState(
    place(`https://super.openbitfun.com/b/${ID}/index.html#device=desk-2`),
    storage({ [KEY]: '{"v":1,"deviceId":"desk-1","at":1}' }),
  );
  assert.deepEqual(explicit.handoff, { v: 1, deviceId: 'desk-2', at: null });
  assert.equal(controllerPageState(place(`https://super.openbitfun.com/b/${ID}/index.html`), storage()).handoff, null);

  // The launcher never connects from a handoff (it picks the device itself).
  const launcher = controllerPageState(
    place('https://super.openbitfun.com/#ui-error=verification&file=app.1234567890.js&bundle=' + ID),
    storage({ [KEY]: '{"v":1,"deviceId":"desk-1","at":1}' }),
  );
  assert.equal(launcher.handoff, null);
  assert.deepEqual(launcher.uiError, { reason: 'verification', file: 'app.1234567890.js', bundleId: ID });
  assert.equal(controllerPageState(place('https://super.openbitfun.com/#switch=1'), storage()).showDevices, true);
});

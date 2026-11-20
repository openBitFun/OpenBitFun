// Shared node:test support for DOM fixtures of shipped browser code (MiniApp shell,
// MiniApp chrome, injected MiniApp SDK). Installs a jsdom window as the global
// environment, the way a jsdom test environment does, without a test framework.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const { JSDOM } = createRequire(import.meta.url)('jsdom');

// Node ships its own versions of these; DOM code must receive jsdom's (jsdom checks
// that dispatched events and abort signals are its own instances).
const DOM_OWNED = new Set(['Event', 'EventTarget', 'MessageEvent', 'CustomEvent', 'ErrorEvent', 'AbortController', 'AbortSignal', 'DOMException']);

/** Install jsdom globals; returns a restore function. */
export function installDom({ url = 'http://localhost/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, pretendToBeVisual: true });
  const { window } = dom;
  const added = [];
  const shadowed = new Map();
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key.startsWith('_') || (key in globalThis && !DOM_OWNED.has(key))) continue;
    if (key in globalThis) shadowed.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    // Proxy to the window so spies and stubs installed on `window.x` reach bare `x`.
    Object.defineProperty(globalThis, key, {
      configurable: true, get: () => window[key], set: value => { window[key] = value; },
    });
    added.push(key);
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'self']) {
    if (added.includes(key)) continue;
    if (key in globalThis) shadowed.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'self' ? window : window[key] });
    added.push(key);
  }
  return () => {
    for (const key of added) {
      delete globalThis[key];
      const original = shadowed.get(key);
      if (original) Object.defineProperty(globalThis, key, original);
    }
    window.close();
  };
}

/** Drain queued microtasks (promise continuations) without running timers. */
export async function flush(rounds = 12) {
  for (let index = 0; index < rounds; index++) await Promise.resolve();
}

/** Expected-value predicate, e.g. `like(value => typeof value === 'string')`. */
export const like = predicate => Object.assign(value => predicate(value), { [likeMarker]: true });
const likeMarker = Symbol('like');

function matches(actual, expected, path) {
  if (typeof expected === 'function' && expected[likeMarker]) {
    assert.ok(expected(actual), `${path}: value ${JSON.stringify(actual)} does not satisfy the expected predicate`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected an array`);
    assert.equal(actual.length, expected.length, `${path}: array length`);
    expected.forEach((item, index) => matches(actual[index], item, `${path}[${index}]`));
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path}: expected an object, got ${JSON.stringify(actual)}`);
    for (const [key, value] of Object.entries(expected)) matches(actual[key], value, `${path}.${key}`);
  } else {
    assert.ok(Object.is(actual, expected), `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Recursive subset match (object keys present in `expected` must match; arrays match exactly). */
export function assertMatch(actual, expected, message = 'value') {
  matches(actual, expected, message);
}

/** Boolean form of assertMatch. */
export function isMatch(actual, expected) {
  try { matches(actual, expected, 'value'); return true; } catch { return false; }
}

/** Arguments of every call recorded by a node:test mock function. */
export const calls = fn => fn.mock.calls.map(call => call.arguments);

/** True when some recorded call's arguments deep-equal `args`. */
export const calledWith = (fn, ...args) => calls(fn).some(actual => isDeepStrictEqual(actual, args));

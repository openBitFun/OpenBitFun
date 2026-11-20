// Subject: the injected MiniApp SDK template in
// src/crates/contracts/product-domains/src/miniapp/bridge_builder.rs. Executes the
// actual template, which catches runtime behavior Rust's string-presence checks cannot.
// Moved from the retired React desktop UI's miniAppAgentInjectedRuntime.test.ts and
// miniAppBridgeImages.test.ts.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { assertMatch, calls, flush, installDom } from './test-support/dom.mjs';
import { injectedScript } from './test-support/miniapp-bridge.mjs';

const script = injectedScript();

describe('injected MiniApp Agent runtime', () => {
  let restoreDom;
  beforeEach(() => { restoreDom = installDom(); });
  afterEach(() => { document.body.replaceChildren(); mock.restoreAll(); mock.timers.reset(); restoreDom(); });

  function runtime() {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    const replies = mock.method(win.parent, 'postMessage', () => {});
    class CanvasContext {
      text = '';
      fillText(text) { this.text = text; }
      strokeText(text) { this.text = text; }
      clearRect() { this.text = ''; }
    }
    const originalDraw = CanvasContext.prototype.fillText;
    new Function('window', 'document', 'KeyboardEvent', 'CanvasRenderingContext2D', script)(
      win, doc, win.KeyboardEvent, CanvasContext,
    );
    const app = win.app;
    let next = 0;
    const request = (method, action, source = win.parent, schemaVersion = 'agent.v1') => {
      const requestId = `test-${++next}`;
      win.dispatchEvent(new win.MessageEvent('message', {
        source, data: { type: 'openbitfun:miniapp-agent-request', requestId, schemaVersion, method, action },
      }));
      return requestId;
    };
    const answer = id => calls(replies).map(([data]) => data).find(data => data.requestId === id);
    return { iframe, win, doc, app, request, answer, CanvasContext, originalDraw };
  }

  it('only accepts the parent window and the supported schema before invoking handlers or input', async () => {
    const rt = runtime();
    const observe = mock.fn(() => ({ count: 1 }));
    const act = mock.fn(() => ({ changed: true }));
    const input = mock.fn();
    rt.app.agent.expose({ observe, act });
    rt.doc.addEventListener('keydown', input);
    for (const method of ['observe', 'act', 'input']) {
      const forged = rt.request(method, { type: 'delete', key: 'w' }, rt.win);
      assert.equal(rt.answer(forged), undefined);
      for (const version of ['agent.v2', null]) {
        const unsupported = rt.request(method, { type: 'delete', key: 'w' }, rt.win.parent, version);
        assertMatch(rt.answer(unsupported), { ok: false, error: 'Unsupported agent bridge schema version' });
      }
    }
    await flush();
    assert.equal(observe.mock.callCount(), 0);
    assert.equal(act.mock.callCount(), 0);
    assert.equal(input.mock.callCount(), 0);
    const accepted = rt.request('act', { type: 'save' });
    await flush();
    assert.deepEqual(calls(act), [[{ type: 'save' }]]);
    assertMatch(rt.answer(accepted), { ok: true, value: { changed: true } });
  });

  // The retired React UI also compared these events with its window-mode key runtime;
  // that counterpart no longer exists, so only the injected tab-mode events are pinned.
  for (const [key, expectedKey, code] of [
    ['w', 'w', 'KeyW'], ['W', 'W', 'KeyW'], ['1', '1', 'Digit1'],
    ['Space', ' ', 'Space'], [' ', ' ', 'Space'], ['Left', 'ArrowLeft', 'ArrowLeft'],
    ['Enter', 'Enter', 'Enter'], ['Alt', 'Alt', 'AltLeft'], ['control', 'control', 'ControlLeft'],
  ]) {
    it(`sends normalized key events for ${JSON.stringify(key)}`, async () => {
      const rt = runtime();
      const events = [];
      for (const type of ['keydown', 'keypress', 'keyup']) {
        rt.doc.addEventListener(type, event => {
          events.push({ type, key: event.key, code: event.code, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
        });
      }
      const id = rt.request('input', { key, modifiers: ['Control', 'Shift'] });
      await flush();
      assertMatch(rt.answer(id), { ok: true });
      assertMatch(events[0], { type: 'keydown', key: expectedKey, code, ctrlKey: true, shiftKey: true });
      assert.equal(events.at(-1)?.type, 'keyup');
    });
  }

  it('holds a window key before releasing it and completing the request', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const advance = async ms => { for (let step = 0; step < ms; step++) { mock.timers.tick(1); await flush(); } };
    const rt = runtime();
    const released = mock.fn();
    rt.doc.addEventListener('keyup', released);
    const id = rt.request('input', { key: 'w', holdMs: 50 });
    await flush();
    await advance(49);
    assert.equal(released.mock.callCount(), 0);
    assert.equal(rt.answer(id), undefined);
    await advance(1);
    assert.equal(released.mock.callCount(), 1);
    assertMatch(rt.answer(id), { ok: true });
  });

  it('does not intercept Canvas drawing or report cleared text as live state', async () => {
    const rt = runtime();
    assert.equal(rt.CanvasContext.prototype.fillText, rt.originalDraw);
    const canvas = new rt.CanvasContext();
    canvas.fillText('Game Over');
    canvas.clearRect();
    const automatic = rt.request('observe');
    await flush();
    assertMatch(rt.answer(automatic), {
      ok: true, value: { state: null, auto: { canvasText: [], canvasTextUnavailable: true } },
    });
    assert.ok(!JSON.stringify(rt.answer(automatic)).includes('Game Over'));
    rt.app.agent.expose({ observe: () => ({ phase: 'playing' }) });
    const declared = rt.request('observe');
    await flush();
    assertMatch(rt.answer(declared), { ok: true, value: { state: { phase: 'playing' } } });
  });
});

describe('injected MiniApp SDK image message ownership', () => {
  const imageScript = injectedScript({
    app_id_esc: '"test"', app_data_esc: '"test"', workspace_esc: '"test"', appearance_mode_esc: '"test"', platform_esc: '"test"',
  });
  const drain = () => flush(20);
  function harness() {
    const handlers = new Set();
    const requests = [];
    const run = mock.fn(async params => ({ sessionId: params.sessionId || 'new-session', turnId: 'turn-1' }));
    const deliver = data => [...handlers].forEach(handler => handler({ data }));
    const window = {
      addEventListener: (_name, handler) => handlers.add(handler),
      removeEventListener: (_name, handler) => handlers.delete(handler),
      parent: { postMessage: request => {
        requests.push(request);
        if (!request.id) return;
        void Promise.resolve().then(() => request.method === 'agent.run' ? run(request.params) : null).then(
          result => deliver({ id: request.id, result }),
          error => deliver({ id: request.id, error: { message: error.message } }),
        );
      } },
    };
    vm.runInNewContext(imageScript, { window, document: { documentElement: { setAttribute() {}, style: { setProperty() {} } } } });
    const send = payload => deliver({ type: 'openbitfun:event', event: 'chat:userMessage', payload });
    return { app: window.app, send, requests, run };
  }
  const runArgs = run => calls(run).map(([params]) => params);
  const images = Array.from({ length: 5 }, (_, index) => ({
    id: `ref-${index}`, data_url: `data:image/png;base64,${btoa(`image-${index}`)}`, mime_type: 'image/png',
  }));

  it('preserves all five images for legacy async text-only handlers and releases them after completion', async () => {
    const { app, send, run, requests } = harness();
    app.chat.onUserMessage(async () => {
      await Promise.resolve();
      await app.agent.run('internal prompt', { sessionId: 'deck' });
      await app.agent.run('continue', { sessionId: 'deck' });
    });
    send({ requestId: 'first', sessionId: 'deck', imageContexts: images });
    send({ requestId: 'first', sessionId: 'deck', imageContexts: images });
    await drain();
    assert.equal(run.mock.callCount(), 2);
    assertMatch(runArgs(run)[0], { imageContexts: images, chatRequestId: 'first' });
    assert.ok(!('imageContexts' in runArgs(run)[1]));
    assert.equal(requests.some(request => request.method === 'chat.completeUserMessage' && !request.params.error), true);
    await app.agent.run('unrelated', { sessionId: 'deck' });
    assert.ok(!('imageContexts' in runArgs(run)[2]));
    assert.ok(!('chatRequestId' in runArgs(run)[2]));
  });

  it('retains images after a rejected submission, then attaches them to the accepted retry', async () => {
    const { app, send, run } = harness();
    run.mock.mockImplementationOnce(async () => { throw new Error('offline'); });
    app.chat.onUserMessage(async () => {
      try { await app.agent.run('first', { sessionId: 'deck' }); } catch { /* retry */ }
      await app.agent.run('retry', { sessionId: 'deck' });
    });
    send({ requestId: 'retry-message', sessionId: 'deck', imageContexts: images });
    await drain();
    assert.deepEqual(runArgs(run).map(params => params.imageContexts), [images, images]);
  });

  for (const explicitImages of [images, []]) {
    it(`does not re-inherit images after an accepted explicit attachment choice (${explicitImages.length} images)`, async () => {
      const { app, send, run } = harness();
      app.chat.onUserMessage(async () => {
        await app.agent.run('first turn', { sessionId: 'deck', imageContexts: explicitImages });
        await app.agent.run('follow-up', { sessionId: 'deck' });
      });
      send({ requestId: 'explicit', sessionId: 'deck', imageContexts: images });
      await drain();
      assert.deepEqual(runArgs(run)[0].imageContexts, explicitImages);
      assert.ok(!('imageContexts' in runArgs(run)[1]));
    });
  }

  it('does not attach another topic’s images and lets explicit request ids disambiguate concurrent messages', async () => {
    const { app, send, run } = harness();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    app.chat.onUserMessage(async payload => {
      await gate;
      await app.agent.run(payload.requestId, { sessionId: payload.sessionId, chatRequestId: payload.requestId });
    });
    send({ requestId: 'one', sessionId: 'deck', imageContexts: images });
    send({ requestId: 'two', sessionId: 'deck', imageContexts: [{ ...images[0], id: 'two' }] });
    await assert.rejects(app.agent.run('ambiguous', { sessionId: 'deck' }), /Concurrent MiniApp image messages/);
    await app.agent.run('other topic', { sessionId: 'other-deck' });
    assert.ok(!('imageContexts' in runArgs(run)[0]));
    release();
    await drain();
    assertMatch(runArgs(run)[1], { chatRequestId: 'one', imageContexts: images });
    assertMatch(runArgs(run)[2], { chatRequestId: 'two', imageContexts: [{ ...images[0], id: 'two' }] });
    await assert.rejects(app.agent.run('stale', { chatRequestId: 'one' }), /no longer active/);
  });

  it('keeps explicit images and text-only legacy messages compatible', async () => {
    const { app, send, run } = harness();
    app.chat.onUserMessage(async payload => {
      await app.agent.run('task', { sessionId: 'deck', imageContexts: payload.imageContexts });
    });
    send({ requestId: 'legacy', sessionId: 'deck' });
    await drain();
    assert.equal(runArgs(run)[0].imageContexts, undefined);
    send({ requestId: 'image', sessionId: 'deck', imageContexts: images });
    await drain();
    assertMatch(runArgs(run)[1], { imageContexts: images, chatRequestId: 'image' });
  });
});

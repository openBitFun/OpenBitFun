// Subject: the MiniApp shell page script (src/apps/miniapp-shell/src/shell.html) with the
// shared titlebar and dedicated chat, driving real SDK/app source through the shell relay.
// Moved from the retired React desktop UI's MiniAppShell.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { assertMatch, calledWith, calls, flush, installDom, isMatch, like } from './test-support/dom.mjs';
import { bootBusinessApp } from './test-support/miniapp-bridge.mjs';
import { mountTitlebar } from '../src/shared/miniapp-chrome/titlebar.js';
import { mountMiniAppChat } from '../src/apps/miniapp-shell/src/miniapp-chat.js';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const icons = readJson('../src/shared/miniapp-chrome/icons.generated.json');
const windowLabels = readJson('../src/shared/miniapp-chrome/labels.generated.json');
const chatLabels = readJson('../src/apps/miniapp-shell/src/chat-labels.json');
const html = readFileSync(new URL('../src/apps/miniapp-shell/src/shell.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('(() => {'), html.indexOf('</script>'));
const labels = { ...windowLabels['en-US'], titlebar: 'Window controls', openTab: 'Return to app', retry: 'Retry', transferWarning: 'Save first', transferring: 'Opening', transferFailed: 'Transfer failed' };
const bootstrap = {
  presentationCapabilities: ['miniapp_custom_chrome_v1'], locale: 'en-US', appearanceMode: 'dark', ui: labels,
  instance: { primaryView: { kind: 'window' } },
  app: { name: 'Notes', compiled_html: '<html>Notes</html>', chrome: { titlebar: { title: 'Custom Notes' } } },
};
const anyString = like(value => typeof value === 'string');
const containing = text => like(value => typeof value === 'string' && value.includes(text));
/** toHaveBeenCalledWith('miniapp_shell_call', { request: { operation, params: objectContaining(params) } }). */
const calledShell = (call, operation, params) => calls(call).some(([command, value, ...rest]) => (
  rest.length === 0 && command === 'miniapp_shell_call'
  && Object.keys(value).join() === 'request' && Object.keys(value.request).sort().join() === 'operation,params'
  && value.request.operation === operation && isMatch(value.request.params, params)
));
/** Advance mocked timers one millisecond at a time, draining promises in between. */
const advance = async ms => { for (let step = 0; step < ms; step++) { mock.timers.tick(1); await flush(); } };

let restoreDom;
let originalUrl, originalRaf, originalCaf;
beforeEach(() => {
  restoreDom = installDom();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  document.body.innerHTML = html.split('</head><body>')[1].split('<script')[0];
  mock.method(window, 'confirm', () => true);
  originalUrl = globalThis.URL; originalRaf = globalThis.requestAnimationFrame; originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.URL = { createObjectURL: () => 'blob:miniapp', revokeObjectURL: mock.fn() };
});
afterEach(() => {
  globalThis.URL = originalUrl; globalThis.requestAnimationFrame = originalRaf; globalThis.cancelAnimationFrame = originalCaf;
  mock.timers.reset(); mock.restoreAll();
  restoreDom();
});

function run(overrides = {}, platform = 'windows') {
  const call = mock.fn(async (_command, { request }) => {
    if (overrides[request.operation]) return overrides[request.operation](request);
    if (request.operation === 'bootstrap') return bootstrap;
    if (request.operation === 'windowState') return { maximized: false, fullscreen: false };
    if (request.operation === 'poll') return new Promise(() => {});
    return null;
  });
  Object.assign(window, { __TAURI__: { core: { invoke: call } }, __MINIAPP_PLATFORM__: platform });
  new Function('mountTitlebar', 'icons', 'windowLabels', 'mountMiniAppChat', 'chatLabels', source)(mountTitlebar, icons, windowLabels, mountMiniAppChat, chatLabels);
  return call;
}
const operationsOf = call => calls(call).map(([, value]) => value.request.operation);

describe('MiniApp Shell presentation handoff', () => {
  it('runs real business actions through the Shell relay without reloading its unsaved document', async () => {
    let answerPoll;
    const call = run({
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
      agentClaim: () => ({ accepted: true }),
      permissions: () => ({ requests: [] }),
    });
    await flush();
    const frame = document.querySelector('iframe');
    const rt = await bootBusinessApp(frame);
    frame.dispatchEvent(new Event('load')); await flush();
    const draft = 'Unsaved: alice@example.com';
    const input = rt.input('test-text', draft);
    const write = mock.method(rt.doc, 'write');
    const initialSource = frame.getAttribute('src');
    const beforeBoots = operationsOf(call).filter(operation => operation === 'bootstrap').length;
    let sequence = 0;
    const request = async (method, action) => {
      const requestId = `business-${++sequence}`;
      answerPoll({ events: [{ sequence, event: 'agentRequest', payload: {
        requestId, schemaVersion: 'agent.v1', method, action, expiresAt: Date.now() + 10000,
      } }], cursor: sequence });
      await flush();
      const answer = calls(call).find(([, v]) => v.request.operation === 'agentResponse' && v.request.params?.requestId === requestId);
      assert.notEqual(answer, undefined);
      // Start the next long poll, but stay ahead of the 350ms persistence timer.
      await advance(50);
      return answer[1].request.params;
    };
    assertMatch(await request('observe'), { ok: true, value: { state: { text: { value: draft } } } });
    assertMatch(await request('act', { type: 'apply-pattern', id: 'email' }), {
      ok: true, value: { applied: true, state: { matchCount: 1, text: { value: draft } } },
    });
    assertMatch(await request('act', { type: 'set-input', input: { replacement: '[email]' } }), {
      ok: true, value: { state: { replacementPreview: { value: 'Unsaved: [email]' } } },
    });
    assert.equal(rt.doc.getElementById('replace-output')?.textContent, 'Unsaved: [email]');
    assert.equal(input.value, draft);
    assert.equal(rt.storage.set.mock.callCount(), 0);
    assert.equal(document.querySelector('iframe'), frame);
    assert.equal(frame.contentDocument, rt.doc);
    assert.equal(frame.contentWindow, rt.win);
    assert.equal(frame.getAttribute('src'), initialSource);
    assert.equal(write.mock.callCount(), 0);
    assert.equal(operationsOf(call).filter(operation => operation === 'bootstrap').length, beforeBoots);
    assert.equal(operationsOf(call).some(operation => ['tab', 'close'].includes(operation)), false);
  });

  it('does not replay a completed Agent mutation after content reload', async () => {
    let answerPoll;
    const claimed = new Set();
    const call = run({
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
      agentClaim: request => {
        const id = String(request.params?.requestId);
        if (claimed.has(id)) return { accepted: false };
        claimed.add(id); return { accepted: true };
      },
    });
    await flush();
    const frame = document.querySelector('iframe');
    frame.dispatchEvent(new Event('load')); await flush();
    const posts = [];
    mock.method(frame.contentWindow, 'postMessage', payload => { posts.push(payload); });
    const batch = { events: [{ sequence: 1, event: 'agentRequest', payload: {
      requestId: 'completed', method: 'act', action: { type: 'increment' }, expiresAt: Date.now() + 10000,
    } }], cursor: 1 };
    answerPoll(batch); await flush();
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
      type: 'openbitfun:miniapp-agent-response', requestId: 'completed', ok: true, value: 1,
    } })); await flush();
    assert.equal(operationsOf(call).filter(operation => operation === 'agentResponse').length, 1);
    document.querySelector('#retry').click(); await flush();
    frame.dispatchEvent(new Event('load')); await flush();
    mock.method(frame.contentWindow, 'postMessage', payload => { posts.push(payload); });
    answerPoll(batch); await flush();
    assert.equal(posts.filter(p => p.type === 'openbitfun:miniapp-agent-request').length, 1);
  });

  it('consumes reload events and resets the cursor only for a different host/view', async () => {
    let answerPoll;
    let epoch = 'host-1';
    const call = run({
      bootstrap: () => ({ ...bootstrap, hostEpoch: epoch, view: { viewId: 'view-1' } }),
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
    });
    await flush();
    answerPoll({ events: [{ sequence: 7, event: 'reload', payload: {} }], cursor: 7 }); await flush();
    const polls = () => calls(call).filter(([, v]) => v.request.operation === 'poll');
    assert.equal(polls().at(-1)?.[1].request.params?.after, 7);
    document.querySelector('#retry').click(); await flush();
    assert.equal(polls().at(-1)?.[1].request.params?.after, 7);
    epoch = 'host-2';
    document.querySelector('#retry').click(); await flush();
    assert.equal(polls().at(-1)?.[1].request.params?.after, 0);
  });

  it('ends pending Agent requests before replacement content bootstraps', async () => {
    let answerPoll;
    const call = run({
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
      agentClaim: () => ({ accepted: true }),
    });
    await flush();
    const frame = document.querySelector('iframe');
    frame.dispatchEvent(new Event('load')); await flush();
    answerPoll({ events: [{ sequence: 1, event: 'agentRequest', payload: { requestId: 'pending', method: 'act', expiresAt: Date.now() + 10000 } }], cursor: 1 }); await flush();
    document.querySelector('#retry').click(); await flush();
    const replies = () => calls(call).filter(([, v]) => v.request.operation === 'agentResponse');
    assert.equal(replies().length, 1);
    assertMatch(replies()[0][1].request.params, { requestId: 'pending', code: 'SURFACE_UNAVAILABLE' });
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'openbitfun:miniapp-agent-response', requestId: 'pending', ok: true, value: 'late' } }));
    await flush();
    assert.equal(replies().length, 1);
  });

  it('does not deliver an expired request after awaiting its claim', async () => {
    let answerPoll;
    let answerClaim;
    const call = run({
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
      agentClaim: () => new Promise(resolve => { answerClaim = resolve; }),
    });
    await flush();
    const frame = document.querySelector('iframe');
    frame.dispatchEvent(new Event('load')); await flush();
    const post = mock.method(frame.contentWindow, 'postMessage');
    answerPoll({ events: [{ sequence: 1, event: 'agentRequest', payload: {
      requestId: 'expired', method: 'act', expiresAt: Date.now() + 100,
    } }], cursor: 1 }); await flush();
    mock.timers.setTime(Date.now() + 1000);
    answerClaim({ accepted: true }); await flush();
    assert.equal(post.mock.callCount(), 0);
    assert.ok(calledShell(call, 'agentResponse', { requestId: 'expired', code: 'BRIDGE_TIMEOUT' }));
  });

  it('fences a claim that completes after the content document changes', async () => {
    let answerPoll;
    let answerClaim;
    const call = run({
      poll: () => new Promise(resolve => { answerPoll = resolve; }),
      agentClaim: () => new Promise(resolve => { answerClaim = resolve; }),
    });
    await flush();
    const frame = document.querySelector('iframe');
    frame.dispatchEvent(new Event('load')); await flush();
    answerPoll({ events: [{ sequence: 1, event: 'agentRequest', payload: { requestId: 'old', method: 'act' } }], cursor: 1 }); await flush();
    document.querySelector('#retry').click(); await flush();
    frame.dispatchEvent(new Event('load')); await flush();
    const post = mock.method(frame.contentWindow, 'postMessage');
    answerClaim({ accepted: true }); await flush();
    assert.equal(post.mock.callCount(), 0);
    assert.ok(calledShell(call, 'agentResponse', { requestId: 'old', code: 'SURFACE_UNAVAILABLE' }));
  });

  it('gates the dedicated launcher on the existing authorized SDK claim', async () => {
    run({ local: () => Promise.reject(new Error('MiniApp lacks permission')) });
    await flush();
    const frame = document.querySelector('iframe');
    const post = mock.method(frame.contentWindow, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { id: 'foreign', method: 'chat.claimComposer' } }));
    assert.equal(document.querySelector('#miniapp-chat').hidden, true);
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: 'claim', method: 'chat.claimComposer' } }));
    await flush();
    assert.equal(document.querySelector('#miniapp-chat').hidden, true);
    assert.ok(calls(post).some(([payload, origin, ...rest]) => rest.length === 0 && origin === '*'
      && isMatch(payload, { id: 'claim', error: { message: containing('lacks permission') } })));
  });

  it('keeps the old SDK message route and does not request snapshots from an old host', async () => {
    const call = run();
    await flush();
    const frame = document.querySelector('iframe');
    const post = mock.method(frame.contentWindow, 'postMessage');
    const rpc = async (method, params = {}) => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: method, method, params } }));
      await flush();
    };
    await rpc('chat.claimComposer');
    assert.equal(document.querySelector('#miniapp-chat').hidden, false);
    await rpc('chat.setComposerDraft', { text: 'Build an outline' });
    document.querySelector('#miniapp-chat form').requestSubmit();
    assert.ok(calls(post).some(([payload, origin, ...rest]) => rest.length === 0 && origin === '*'
      && isMatch(payload, { type: 'openbitfun:event', event: 'chat:userMessage', payload: { text: 'Build an outline', requestId: anyString } })));
    await rpc('chat.focusSession', { sessionId: 'owned' });
    assert.equal(operationsOf(call).some(operation => operation === 'chatSnapshot'), false);
    await rpc('chat.releaseComposer');
    assert.equal(document.querySelector('#miniapp-chat').hidden, true);
  });

  it('does not let a late authorization restore a released composer', async () => {
    let authorize;
    run({ local: () => new Promise(resolve => { authorize = resolve; }) });
    await flush();
    const frame = document.querySelector('iframe');
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: 'claim', method: 'chat.claimComposer' } }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: 'release', method: 'chat.releaseComposer' } }));
    authorize(); await flush();
    assert.equal(document.querySelector('#miniapp-chat').hidden, true);
  });

  it('requests an app-owned snapshot only when the host advertises it', async () => {
    const snapshot = mock.fn(() => ({ sessionId: 'owned', turns: [{ id: 'turn', user: 'Saved question', status: 'completed', rounds: [{ id: 'round', text: 'Saved answer' }] }] }));
    run({ bootstrap: () => ({ ...bootstrap, presentationCapabilities: ['miniapp_custom_chrome_v1', 'miniapp_chat_snapshot_v1'] }), chatSnapshot: snapshot });
    await flush();
    const frame = document.querySelector('iframe');
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: 'claim', method: 'chat.claimComposer' } }));
    await flush();
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { id: 'focus', method: 'chat.focusSession', params: { sessionId: 'owned' } } }));
    await flush();
    assert.ok(calledWith(snapshot, { operation: 'chatSnapshot', params: { sessionId: 'owned' } }));
    assert.ok(document.querySelector('#miniapp-chat').textContent.includes('Saved answer'));
  });

  it('keeps the source open until the host releases it and coalesces return clicks', async () => {
    let release;
    const call = run({ tab: () => new Promise(() => {}), poll: () => new Promise(resolve => { release = resolve; }) });
    await flush();
    document.querySelector('iframe').dispatchEvent(new Event('load'));
    await flush();
    const transfer = document.querySelector('[data-window-action="tab"]');
    transfer.click(); transfer.click();
    await flush();
    assert.equal(operationsOf(call).filter(operation => operation === 'tab').length, 1);
    assert.ok(!operationsOf(call).includes('close'));
    release({ released: true });
    await flush();
    assert.ok(operationsOf(call).includes('close'));
  });

  it('retains and re-enables the source when the destination fails', async () => {
    const call = run({ tab: () => Promise.reject(new Error('Destination unavailable')) });
    await flush();
    document.querySelector('iframe').dispatchEvent(new Event('load'));
    await flush();
    const transfer = document.querySelector('[data-window-action="tab"]');
    transfer.click();
    await flush();
    assert.equal(transfer.disabled, false);
    assert.ok(document.querySelector('#status-text')?.textContent.includes('Destination unavailable'));
    assert.ok(!operationsOf(call).includes('close'));
  });

  it('uses the default custom titlebar when an older host does not advertise chrome support', async () => {
    run({ bootstrap: () => ({ ...bootstrap, presentationCapabilities: undefined }) });
    await flush();
    assert.equal(document.querySelector('.miniapp-titlebar__title')?.textContent, 'Notes');
    assert.equal(document.querySelector('[data-window-action="close"]')?.disabled, false);
  });

  it('keeps close usable on connection failure', async () => {
    const call = run({ bootstrap: () => Promise.reject(new Error('Host offline')) });
    await flush();
    const close = document.querySelector('[data-window-action="close"]');
    assert.equal(close.disabled, false);
    close.click();
    await flush();
    assert.ok(operationsOf(call).includes('close'));
  });

  it('preserves native macOS controls and resize while keeping the return icon on host failure', async () => {
    const call = run({ bootstrap: () => Promise.reject(new Error('Host offline')) }, 'macos');
    await flush();
    assert.equal(document.querySelector('.miniapp-titlebar')?.getAttribute('data-platform'), 'macos');
    assert.equal(document.querySelector('.window-controls'), null);
    assert.equal(document.querySelector('#resize-borders')?.childElementCount, 0);
    assert.equal(document.querySelector('#resize-borders')?.hidden, true);
    assert.equal(document.querySelector('[data-window-action="tab"]')?.disabled, true);
    document.querySelector('#titlebar').dispatchEvent(new MouseEvent('dblclick', { button: 0 }));
    await flush();
    assert.ok(operationsOf(call).includes('titlebarDoubleClick'));
  });
});

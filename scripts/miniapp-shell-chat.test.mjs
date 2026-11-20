// Subject: src/apps/miniapp-shell/src/miniapp-chat.js (MiniApp shell dedicated chat).
// Moved from the retired React desktop UI's MiniAppShellChat.test.ts.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { calledWith, calls, installDom } from './test-support/dom.mjs';
import { mountMiniAppChat } from '../src/apps/miniapp-shell/src/miniapp-chat.js';

const translations = JSON.parse(readFileSync(new URL('../src/apps/miniapp-shell/src/chat-labels.json', import.meta.url), 'utf8'));
const labels = translations['en-US'];
const empty = (sessionId = 'session') => ({ sessionId, turns: [], runtime: { streamId: 'runtime', cursor: 0, events: [] } });
const started = (turnId = 'turn', sessionId = 'session') => ({ sessionId, turnId, sourceEvent: 'dialog-turn-started', userInput: 'Question' });
const chunk = (value, cursor, sessionId = 'session') => ({
  sessionId, turnId: 'turn', roundId: 'round', sourceEvent: 'text-chunk', text: value,
  __openbitfunRuntimeStreamId: 'runtime', __openbitfunRuntimeEventCursor: cursor,
});
function fixture(loadSnapshot = mock.fn(async id => empty(id)), snapshotSupported = true) {
  const root = document.createElement('div'); document.body.append(root);
  const onSend = mock.fn(), onStop = mock.fn(async () => {});
  const chat = mountMiniAppChat(root, { onSend, onStop, loadSnapshot });
  chat.configure({ labels, appName: 'Slides', snapshotSupported });
  const input = root.querySelector('textarea');
  const form = root.querySelector('form');
  const launcher = root.querySelector('.miniapp-chat__launcher');
  const panel = root.querySelector('[role="dialog"]');
  return { chat, root, input, form, launcher, panel, onSend, onStop, loadSnapshot };
}
const has = (root, text) => root.textContent.includes(text);
let restoreDom;
beforeEach(() => { restoreDom = installDom(); });
afterEach(() => { restoreDom(); });

describe('MiniApp Shell dedicated chat', () => {
  it('uses Hi and FlowChat anatomy and keeps Enter submission compatible with multiline and IME input', async () => {
    const { chat, root, input, launcher, panel, onSend } = fixture();
    chat.claim();
    assert.equal(root.classList.contains('openbitfun-fmc'), true);
    assert.equal(launcher.dataset.openbitfunComponent, 'launcher-button');
    assert.equal(panel.classList.contains('openbitfun-fmc__panel'), true);
    chat.setDraft('First line\nSecond line');
    const composer = root.querySelector('[data-openbitfun-component="chat-composer"]');
    assert.equal(composer.querySelector('[data-openbitfun-part="surface"]').getAttribute('data-openbitfun-layout'), 'expanded');
    assert.equal(composer.querySelector('[data-openbitfun-part="content"] textarea'), input);
    assert.equal(composer.querySelector('button[type="submit"]').getAttribute('data-openbitfun-variant'), 'primary');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    assert.equal(onSend.mock.callCount(), 0);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(onSend.mock.callCount(), 1);
    await chat.focusSession('session');
    chat.acceptedRun({ sessionId: 'session', turnId: 'turn' }, chat.getRequestId());
    chat.event(started()); chat.event(chunk('FlowChat reply', 1));
    assert.ok(root.querySelector('.user-message-item-shell .user-message-item__content').textContent.includes('First line'));
    assert.equal(root.querySelector('.model-round-item .flow-text-block .text-content').textContent, 'FlowChat reply');
    root.querySelector('header button').click();
    assert.equal(panel.inert, true);
    assert.equal(panel.classList.contains('openbitfun-fmc__panel--open'), false);
    assert.ok(has(root, 'FlowChat reply'));
  });

  it('only appears after a claim and safely renders app-owned welcome text', () => {
    const { chat, root, launcher, panel, input } = fixture();
    assert.equal(root.hidden, true);
    chat.claim({ title: '<img src=x onerror=alert(1)>', welcome: { title: 'Create slides', suggestions: [{ label: 'Outline', prompt: 'Draft an outline' }] } });
    assert.equal(root.hidden, false);
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(panel.inert, true);
    launcher.click();
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.equal(panel.inert, false);
    assert.equal(root.querySelector('img'), null);
    assert.ok(root.querySelector('.miniapp-chat__title').textContent.includes('<img'));
    root.querySelector('.miniapp-chat__suggestions button').click();
    assert.equal(input.value, 'Draft an outline');
    chat.release();
    assert.equal(root.hidden, true);
  });

  it('routes the first message without requiring a pre-existing session and waits for SDK completion', async () => {
    const { chat, input, form, onSend, root } = fixture();
    chat.claim(); chat.setDraft('First request'); form.requestSubmit();
    assert.equal(onSend.mock.callCount(), 1);
    const submission = calls(onSend)[0][0];
    assert.equal(submission.text, 'First request');
    assert.equal(submission.message, 'First request');
    await chat.focusSession('session');
    chat.acceptedRun({ sessionId: 'session', turnId: 'turn' }, chat.getRequestId());
    chat.event(started());
    chat.event({ sessionId: 'session', turnId: 'turn', sourceEvent: 'dialog-turn-completed', success: true });
    assert.ok(has(root, labels.processing));
    assert.deepEqual(chat.complete({ requestId: 'stale' }), { completed: false });
    assert.deepEqual(chat.complete({ requestId: submission.requestId }), { completed: true });
    input.value = 'Follow-up'; input.dispatchEvent(new Event('input'));
    form.requestSubmit();
    assert.equal(onSend.mock.callCount(), 2);
  });

  it('filters other sessions and preserves work when the panel collapses', async () => {
    const { chat, root, panel, onStop } = fixture();
    chat.claim(); await chat.focusSession('session');
    chat.event(started()); chat.event(chunk('Correct answer', 1)); chat.event(chunk('Private other app', 2, 'other'));
    assert.ok(has(root, 'Correct answer'));
    assert.ok(!has(root, 'Private other app'));
    root.querySelector('header button').click();
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(onStop.mock.callCount(), 0);
    chat.setApproval(true);
    assert.equal(root.querySelector('button').getAttribute('aria-label'), labels.approval);
    assert.equal(root.querySelector('button').dataset.attention, 'true');
  });

  it('merges the authoritative snapshot and newer live events exactly once', async () => {
    let resolve;
    const { chat, root } = fixture(mock.fn(() => new Promise(done => { resolve = done; })));
    chat.claim();
    const focus = chat.focusSession('session');
    chat.event(chunk('Hello', 4)); chat.event(chunk(' world', 6));
    resolve({ sessionId: 'session', turns: [], runtime: { streamId: 'runtime', cursor: 5, activeTurnId: 'turn', events: [started(), chunk('Hello', 5)] } });
    await focus;
    assert.ok(has(root, 'Hello world'));
    assert.ok(!has(root, 'HelloHello'));
    chat.event(chunk(' world', 6));
    assert.ok(!has(root, 'world world'));
  });

  it('keeps a new submission separate from the previous turn replay and binds the accepted run', async () => {
    const previous = { sessionId: 'session', turns: [], runtime: {
      streamId: 'runtime', cursor: 5, events: [started('previous'), { sessionId: 'session', turnId: 'previous', sourceEvent: 'dialog-turn-completed', success: true }],
    } };
    const { chat, root, form } = fixture(mock.fn(async () => previous));
    chat.claim(); chat.setDraft('New request'); form.requestSubmit();
    await chat.focusSession('session');
    const userRows = () => [...root.querySelectorAll('[data-role="user"] p')].map(row => row.textContent);
    assert.deepEqual(userRows(), ['Question', 'New request']);
    chat.acceptedRun({ sessionId: 'session', turnId: 'current' }, chat.getRequestId());
    chat.event(started('current'));
    assert.deepEqual(userRows(), ['Question', 'New request']);
    // A later recovery includes this turn; the local pending row is no longer duplicated.
    assert.equal(root.querySelectorAll('[data-role="user"]').length, 2);
  });

  it('replaces superseded attempt text and ignores non-chat events', async () => {
    const { chat, root } = fixture();
    chat.claim(); await chat.focusSession('session'); chat.event(started());
    chat.event({ ...chunk('Superseded', 1), attemptId: 'first' });
    chat.event({ ...chunk('Replacement', 2), attemptId: 'retry' });
    chat.event({ sessionId: 'session', turnId: 'other-turn', sourceEvent: 'token-usage-updated' });
    assert.ok(!has(root, 'Superseded')); assert.ok(has(root, 'Replacement'));
    assert.equal(root.querySelectorAll('[data-role="assistant"]').length, 1);
  });

  it('ignores an old snapshot and events after switching the app topic', async () => {
    const replies = new Map();
    const { chat, root } = fixture(mock.fn(id => new Promise(resolve => replies.set(id, resolve))));
    chat.claim(); const first = chat.focusSession('first'); const second = chat.focusSession('second');
    replies.get('second')({ sessionId: 'second', turns: [{ id: 'new', user: 'New topic', status: 'completed', rounds: [] }] });
    await second;
    replies.get('first')({ sessionId: 'first', turns: [{ id: 'old', user: 'Old topic', status: 'completed', rounds: [] }] });
    await first;
    chat.event(chunk('Old answer', 1, 'first'));
    assert.ok(has(root, 'New topic'));
    assert.ok(!has(root, 'Old topic')); assert.ok(!has(root, 'Old answer'));
  });

  it('keeps SDK input usable with an older host and clearly reports limited recovery', async () => {
    const { chat, root, input, form, onSend, loadSnapshot } = fixture(undefined, false);
    chat.claim(); await chat.focusSession('session');
    assert.equal(loadSnapshot.mock.callCount(), 0);
    assert.ok(has(root, labels.liveOnly));
    input.value = 'Legacy request'; input.dispatchEvent(new Event('input')); form.requestSubmit();
    assert.equal(onSend.mock.callCount(), 1);
    chat.event(started()); chat.event(chunk('Live reply', 1));
    assert.ok(has(root, 'Live reply'));
  });

  it('retains messages on a failed restore, retries on reconnect, and cancels only the active turn', async () => {
    const load = mock.fn(async id => empty(id));
    const { chat, root, onStop } = fixture(load);
    chat.claim(); await chat.focusSession('session'); chat.event(started()); chat.event(chunk('Keep this', 1));
    load.mock.mockImplementationOnce(async () => { throw new Error('Host unavailable'); });
    await chat.resync();
    assert.ok(has(root, 'Keep this')); assert.ok(has(root, 'Host unavailable'));
    root.querySelectorAll('.miniapp-chat__actions button')[0].click();
    await Promise.resolve();
    assert.ok(calledWith(onStop, { sessionId: 'session', turnId: 'turn' }));
    chat.setConnected(false);
    assert.ok(has(root, labels.offline));
    chat.setConnected(true); await chat.resync();
    assert.equal(load.mock.callCount(), 3);
  });

  it('clears and releases presentation without cancelling the Agent', async () => {
    const { chat, root, onStop } = fixture();
    chat.claim(); await chat.focusSession('session'); chat.event(started()); chat.event(chunk('Answer', 1));
    chat.clearSession(); assert.ok(!has(root, 'Answer'));
    chat.release(); chat.event(chunk('Late answer', 2));
    assert.equal(root.hidden, true); assert.equal(onStop.mock.callCount(), 0);
    assert.throws(() => chat.setDraft('Late draft'), /has not claimed/);
  });

  it('does not associate an earlier submission response with a newly claimed composer', async () => {
    const { chat, form, root } = fixture();
    chat.claim(); chat.setDraft('Earlier request'); form.requestSubmit();
    const earlier = chat.getRequestId();
    chat.release(); chat.claim(); chat.setDraft('Current request'); form.requestSubmit();
    await chat.focusSession('session');
    chat.acceptedRun({ sessionId: 'session', turnId: 'earlier' }, earlier);
    chat.event(started('earlier'));
    assert.equal(root.querySelectorAll('[data-role="user"]').length, 2);
    chat.acceptedRun({ sessionId: 'session', turnId: 'current' }, chat.getRequestId());
    chat.event(started('current'));
    assert.equal(root.querySelectorAll('[data-role="user"]').length, 2);
    assert.ok(!has(root, 'Earlier request'));
    assert.ok(has(root, 'Current request'));
  });

  it('settles an old request without displaying its failure in a different topic', async () => {
    const { chat, form, root } = fixture();
    chat.claim(); await chat.focusSession('first');
    chat.setDraft('First topic request'); form.requestSubmit();
    const requestId = chat.getRequestId();
    chat.clearSession(); await chat.focusSession('second');
    assert.deepEqual(chat.complete({ requestId, error: 'Failure in the first topic' }), { completed: true });
    assert.ok(!has(root, 'Failure in the first topic'));
  });
});

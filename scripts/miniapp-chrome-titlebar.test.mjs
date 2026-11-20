// Subject: src/shared/miniapp-chrome/titlebar.js (MiniApp shell window chrome).
// Moved from the retired React desktop UI's MiniAppTitlebar.test.tsx.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { calls, installDom } from './test-support/dom.mjs';
import { mountTitlebar } from '../src/shared/miniapp-chrome/titlebar.js';

const icons = JSON.parse(readFileSync(new URL('../src/shared/miniapp-chrome/icons.generated.json', import.meta.url), 'utf8'));
const labels = { titlebar: 'Window controls', openTab: 'Return to app', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' };
const mounted = [];
let restoreDom;
beforeEach(() => { restoreDom = installDom(); });
afterEach(() => { mounted.forEach(bar => bar.destroy()); mounted.length = 0; document.body.replaceChildren(); restoreDom(); });

function render(preview = false, platform = 'windows') {
  const element = document.createElement('header');
  document.body.append(element);
  const onAction = mock.fn(), onWindowAction = mock.fn(), onDrag = mock.fn();
  const bar = mountTitlebar(element, {
    chrome: { titlebar: { title: '<script>untrusted</script>', density: 'compact', controlsPosition: 'start', actions: [
      { id: 'export', label: 'Export', labels: { 'zh-CN': '导出' }, icon: 'download' },
    ] } },
    title: 'App', icon: 'Box', icons, locale: 'zh-CN', labels, platform, preview, onAction, onWindowAction, onDrag,
  });
  mounted.push(bar);
  return { element, bar, onAction, onWindowAction, onDrag };
}

describe('MiniApp shared titlebar', () => {
  it('renders app text safely and keeps app actions separate from window authority', () => {
    const { element, onAction, onWindowAction } = render();
    assert.equal(element.querySelector('script'), null);
    assert.ok(element.textContent.includes('<script>untrusted</script>'));
    element.querySelector('[aria-label="导出"]').click();
    assert.deepEqual(calls(onAction), [['export']]);
    assert.equal(onWindowAction.mock.callCount(), 0);
    element.querySelector('[data-window-action="tab"]').click();
    assert.deepEqual(calls(onWindowAction), [['tab']]);
    assert.equal(element.querySelector('[data-window-action="tab"]')?.textContent, '');
  });

  it('keeps controls usable while a transfer is pending and reflects native maximize state', () => {
    const { element, bar, onWindowAction } = render();
    bar.setTransferring(true);
    assert.equal(element.querySelector('[data-window-action="tab"]').disabled, true);
    element.querySelector('[data-window-action="close"]').click();
    assert.deepEqual(calls(onWindowAction), [['close']]);
    bar.setMaximized(true);
    assert.equal(element.querySelector('[data-window-action="maximize"]')?.getAttribute('aria-label'), 'Restore');
    bar.setTransferring(false);
    assert.equal(element.querySelector('[data-window-action="tab"]').disabled, false);
  });

  it('leaves macOS traffic lights to AppKit and handles platform titlebar gestures', () => {
    const { element, bar, onWindowAction } = render(false, 'macos');
    assert.equal(element.querySelector('.window-controls'), null);
    assert.equal(element.querySelectorAll('[data-window-action]').length, 1);
    assert.notEqual(element.querySelector('[data-window-action="tab"]'), null);
    assert.doesNotThrow(() => bar.setMaximized(true));
    bar.setFullscreen(true);
    assert.equal(element.dataset.fullscreen, 'true');
    element.dispatchEvent(new MouseEvent('dblclick', { button: 0 }));
    assert.deepEqual(calls(onWindowAction), [['titlebarDoubleClick']]);
  });

  it('uses main-window Windows captions at the right regardless of legacy control placement', () => {
    const { element, onWindowAction } = render();
    assert.equal(element.dataset.controlsPosition, undefined);
    assert.equal(element.lastElementChild?.classList.contains('window-controls--windows'), true);
    const captions = [...element.querySelectorAll('.window-controls__btn')];
    assert.deepEqual(captions.map(button => button.dataset.windowAction), ['minimize', 'maximize', 'close']);
    assert.equal(captions.some(button => button.classList.contains('miniapp-titlebar__button')), false);
    element.dispatchEvent(new MouseEvent('dblclick', { button: 0 }));
    assert.deepEqual(calls(onWindowAction), [['maximize']]);
  });

  it('drags only noninteractive titlebar space and makes draft window controls inert', () => {
    const active = render();
    active.element.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    active.element.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    assert.equal(active.onDrag.mock.callCount(), 1);
    const preview = render(true);
    preview.element.dispatchEvent(new MouseEvent('dblclick', { button: 0 }));
    preview.element.querySelectorAll('button').forEach(button => button.click());
    assert.equal(preview.onWindowAction.mock.callCount(), 0);
    assert.equal(preview.onAction.mock.callCount(), 0);
  });
});

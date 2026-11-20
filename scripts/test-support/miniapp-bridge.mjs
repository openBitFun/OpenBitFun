// Fixtures that execute the real injected MiniApp SDK template from
// src/crates/contracts/product-domains/src/miniapp/bridge_builder.rs, expanding only
// the Rust format! parameters. Moved from the retired React desktop UI's MiniApp tests.
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { flush } from './dom.mjs';

const root = new URL('../../', import.meta.url);
export const readSource = path => readFileSync(new URL(path, root), 'utf8');
const builder = readSource('src/crates/contracts/product-domains/src/miniapp/bridge_builder.rs');
const template = builder.split('r#"')[1].split('"#,')[0];
const keyContract = readSource('src/shared/miniapp-agent/keys.json');

/** Expand the template the way format! does; unknown parameters are an error. */
export function injectedScript(overrides = {}) {
  const values = {
    app_id_esc: '"demo"', app_data_esc: '"/data"', workspace_esc: '"/workspace"',
    appearance_mode_esc: '"light"', platform_esc: '"macos"',
    agent_key_contract: keyContract,
    ...overrides,
  };
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (match, name) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    if (!(name in values)) throw new Error(`Unknown bridge template parameter: ${name}`);
    return values[name];
  });
}

const regexRoot = 'src/crates/contracts/product-domains/src/miniapp/builtin/assets/regex-playground';
export const regexHtml = readSource(`${regexRoot}/index.html`);
export const regexSource = readSource(`${regexRoot}/ui.js`);
const businessScript = injectedScript({ app_id_esc: '"builtin-regex-playground"' });

/** Execute real SDK/app source in an iframe. Only transport delivery and storage IO are fixtures. */
export async function bootBusinessApp(frame, source = regexSource, html = regexHtml, legacy = false, saved = null) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  doc.open(); doc.write(html); doc.close();
  // jsdom does not supply postMessage source identity or layout scrolling.
  const parentPosts = mock.method(win.parent, 'postMessage', data => {
    window.dispatchEvent(new MessageEvent('message', { source: win, data }));
  });
  mock.method(win, 'postMessage', data => {
    win.dispatchEvent(new win.MessageEvent('message', { source: win.parent, data }));
  });
  Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} });
  new Function('window', 'document', 'KeyboardEvent', businessScript)(win, doc, win.KeyboardEvent);
  const app = win.app;
  const storage = { get: mock.fn(async () => saved), set: mock.fn(async () => undefined) };
  app.storage = storage;
  if (legacy) delete app.agent.expose;
  new Function('window', 'document', 'app', source)(win, doc, app);
  await flush(20);
  const input = (id, value) => {
    const element = doc.getElementById(id);
    element.value = value;
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
    return element;
  };
  return { frame, win, doc, storage, input, parentPosts };
}

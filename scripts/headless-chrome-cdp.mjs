// A disposable headless Chrome for the browser fixture scripts
// (`test-browser-snapshot.mjs`, `test-browser-workflow.mjs`), driven over the
// Chrome DevTools Protocol with Node's built-in WebSocket: no Puppeteer or
// WebDriver dependency. The production browser tools under test
// (`src/crates/assembly/core/src/agentic/tools/browser_control`) speak CDP to
// the same browser through its DevTools endpoint.
//
// CHROME_PATH selects the browser; otherwise the usual Chrome, Chromium and
// Edge locations are tried.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function chromeExecutable(env = process.env, platform = process.platform) {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      join(env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    ],
  }[platform];
  if (candidates) {
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) return found;
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const which = spawnSync('which', [name], { encoding: 'utf8', windowsHide: true });
      if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
    }
  }
  throw new Error('No Chrome or Chromium found; set CHROME_PATH to its executable.');
}

class CdpConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  static async open(url) {
    const connection = new CdpConnection();
    connection.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      connection.#socket.addEventListener('open', resolve, { once: true });
      connection.#socket.addEventListener('error', () => reject(new Error(`CDP connection failed: ${url}`)), { once: true });
    });
    connection.#socket.addEventListener('message', event => connection.#receive(JSON.parse(event.data)));
    return connection;
  }

  #receive(message) {
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
  }

  /** Resolves with the params of the next `method` event of `sessionId`. */
  waitFor(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#listeners.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = message => {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          this.#listeners.delete(listener);
          resolve(message.params);
        }
      };
      this.#listeners.add(listener);
    });
  }

  close() {
    this.#socket.close();
  }
}

export class Page {
  constructor(connection, targetId, sessionId) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.connection.send(method, params, this.sessionId);
  }

  async setViewport({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  /** Navigates and waits for the page's load event. */
  async goto(url) {
    const loaded = this.connection.waitFor('Page.loadEventFired', this.sessionId);
    const result = await this.send('Page.navigate', { url });
    if (result.errorText) throw new Error(`Navigation to ${url} failed: ${result.errorText}`);
    await loaded;
  }

  /** Replaces the document with `html` and waits until it finished loading. */
  async setContent(html) {
    const { frameTree } = await this.send('Page.getFrameTree');
    await this.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await this.evaluate(() => (document.readyState === 'complete'
      ? undefined
      : new Promise(resolve => window.addEventListener('load', () => resolve(), { once: true }))));
  }

  /**
   * Evaluates an expression string, or calls a function with JSON arguments,
   * in the page; resolves with the (awaited) value.
   */
  async evaluate(script, ...args) {
    const expression = typeof script === 'function'
      ? `(${script})(...${JSON.stringify(args)})`
      : String(script);
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  }

  async url() {
    const { targetInfo } = await this.connection.send('Target.getTargetInfo', { targetId: this.targetId });
    return targetInfo.url;
  }

  async screenshot({ type = 'png', quality } = {}) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: type,
      ...(quality !== undefined ? { quality } : {}),
    });
    return Buffer.from(data, 'base64');
  }
}

export class Browser {
  constructor(child, wsEndpoint, userDataDir, connection) {
    this.child = child;
    this.endpoint = wsEndpoint;
    this.userDataDir = userDataDir;
    this.connection = connection;
  }

  wsEndpoint() {
    return this.endpoint;
  }

  async #attach(targetId) {
    const { sessionId } = await this.connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.connection, targetId, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    return page;
  }

  async pages() {
    const { targetInfos } = await this.connection.send('Target.getTargets');
    const pages = [];
    for (const info of targetInfos.filter(target => target.type === 'page')) {
      pages.push(await this.#attach(info.targetId));
    }
    return pages;
  }

  async newPage() {
    const { targetId } = await this.connection.send('Target.createTarget', { url: 'about:blank' });
    return this.#attach(targetId);
  }

  async close() {
    try {
      await Promise.race([
        this.connection.send('Browser.close'),
        new Promise(resolve => setTimeout(resolve, 5_000)),
      ]);
    } catch {
      // The browser may close the socket before answering.
    }
    this.connection.close();
    if (this.child.exitCode === null) {
      await Promise.race([
        new Promise(resolve => this.child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 5_000)),
      ]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
    // Release our pipes; crash/update helpers that inherited them must not keep the test alive.
    this.child.stderr?.destroy();
    rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Launches a disposable headless browser with its own profile and DevTools port. */
export async function launchChrome({ executablePath = chromeExecutable() } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'openbitfun-headless-chrome-'));
  const child = spawn(executablePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const wsEndpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not report a DevTools endpoint:\n${output}`)), 30_000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code}) before its DevTools endpoint was ready:\n${output}`));
    });
    child.stderr.setEncoding('utf8');
    // Keep draining stderr for the browser's lifetime; only the start is kept.
    child.stderr.on('data', chunk => {
      if (output.length > 64 * 1024) return;
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  child.removeAllListeners('exit');
  const connection = await CdpConnection.open(wsEndpoint);
  return new Browser(child, wsEndpoint, userDataDir, connection);
}

#!/usr/bin/env node
// Native desktop smoke test: launches the native NSH app (`openbitfun-nsh`
// with the backend library) in an isolated temporary profile, drives the
// backend over the loopback OBP owner connection, then quits the app through
// the shell and checks the process exits cleanly.
//
// Plain Node >= 22, no dependencies: the loopback listener authenticates with
// `Authorization: Bearer <owner token>`, which the global WebSocket cannot
// send, so a minimal RFC 6455 client lives below.
//
// Usage: node tests/e2e/native/smoke.mjs [--profile debug|release-fast|release]
//          [--packaged] [--app <path>] [--nsh-app-dir <dir>] [--keep-profile]
//          [--timeout <ms>]

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILES = ['debug', 'release-fast', 'release'];
const USAGE = `Usage: node tests/e2e/native/smoke.mjs [options]

Options:
  --profile <name>     Cargo profile build to run: ${PROFILES.join(' | ')} (default: release-fast)
  --packaged           Run the packaged app (target/desktop-nsh/...) instead of a profile build
  --app <path>         Explicit runner executable or .app bundle
  --nsh-app-dir <dir>  NSH UI bundle for a profile build (default: the newer of
                       target/desktop-nsh/nsh and target/desktop-nsh/nsh-release)
  --keep-profile       Keep the temporary profile directory after the run
  --timeout <ms>       Startup timeout (default: 120000)
  --help               Show this help

Environment equivalents: OPENBITFUN_E2E_APP, OPENBITFUN_E2E_PROFILE,
OPENBITFUN_E2E_PACKAGED=1, OPENBITFUN_E2E_NSH_APP_DIR, OPENBITFUN_E2E_KEEP_PROFILE=1.`;

const CALL_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const options = {
    app: process.env.OPENBITFUN_E2E_APP || null,
    profile: process.env.OPENBITFUN_E2E_PROFILE || 'release-fast',
    packaged: process.env.OPENBITFUN_E2E_PACKAGED === '1',
    nshAppDir: process.env.OPENBITFUN_E2E_NSH_APP_DIR || null,
    keepProfile: process.env.OPENBITFUN_E2E_KEEP_PROFILE === '1',
    timeoutMs: 120_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--app') options.app = value();
    else if (arg === '--profile') options.profile = value();
    else if (arg === '--packaged') options.packaged = true;
    else if (arg === '--nsh-app-dir') options.nshAppDir = value();
    else if (arg === '--keep-profile') options.keepProfile = true;
    else if (arg === '--timeout') options.timeoutMs = Number(value());
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }
  if (!PROFILES.includes(options.profile)) {
    throw new Error(`--profile must be one of ${PROFILES.join(', ')}; got ${options.profile}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout must be a positive number of milliseconds');
  }
  return options;
}

const exe = name => (process.platform === 'win32' ? `${name}.exe` : name);
const backendLibName = () =>
  process.platform === 'darwin'
    ? 'libopenbitfun_desktop_lib.dylib'
    : process.platform === 'win32'
      ? 'openbitfun_desktop_lib.dll'
      : 'libopenbitfun_desktop_lib.so';

function packagedRunner() {
  const base = path.join(ROOT, 'target/desktop-nsh');
  if (process.platform === 'darwin') {
    return { runner: path.join(base, 'OpenBitFun.app/Contents/MacOS/OpenBitFun'), build: 'pnpm run desktop-nsh:package:mac' };
  }
  if (process.platform === 'win32') {
    return { runner: path.join(base, 'windows/OpenBitFun/openbitfun-desktop.exe'), build: 'pnpm run desktop-nsh:package:windows' };
  }
  return { runner: path.join(base, 'linux/OpenBitFun/openbitfun-nsh'), build: 'pnpm run desktop-nsh:package:linux' };
}

/**
 * The newest NSH UI bundle the build scripts produce: `target/desktop-nsh/nsh`
 * (`pnpm run desktop-nsh:bundle`) or `target/desktop-nsh/nsh-release` (the
 * packaging scripts). A stale bundle may not attach the shell the backend
 * expects, so the newer one wins.
 */
function newestNshBundle() {
  const stamp = dir => {
    for (const name of ['bundle.nshc', 'bundle.js', 'app.json']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return fs.statSync(file).mtimeMs;
    }
    return -1;
  };
  const candidates = ['target/desktop-nsh/nsh', 'target/desktop-nsh/nsh-release']
    .map(rel => path.join(ROOT, rel))
    .filter(dir => fs.existsSync(path.join(dir, 'app.json')))
    .sort((a, b) => stamp(b) - stamp(a));
  return candidates[0] ?? null;
}

/** Resolves the runner to launch and the NSH_APP_DIR it needs (null for packaged layouts). */
function resolveLaunch(options) {
  const fail = message => {
    throw new Error(message);
  };
  if (options.app) {
    let runner = path.resolve(options.app);
    if (runner.endsWith('.app')) runner = path.join(runner, 'Contents/MacOS/OpenBitFun');
    if (!fs.existsSync(runner)) fail(`App not found: ${runner}`);
    const nshAppDir = options.nshAppDir ? path.resolve(options.nshAppDir) : null;
    return { runner, nshAppDir, packaged: true, label: `app ${runner}` };
  }
  if (options.packaged) {
    const { runner, build } = packagedRunner();
    if (!fs.existsSync(runner)) fail(`Packaged app not found: ${runner}\nBuild it with: ${build}`);
    return { runner, nshAppDir: null, packaged: true, label: `packaged ${path.relative(ROOT, runner)}` };
  }
  const dir = path.join(ROOT, 'target', options.profile);
  const runner = path.join(dir, exe('openbitfun-nsh'));
  const cargoProfile = options.profile === 'debug' ? '' : ` --profile ${options.profile}`;
  if (!fs.existsSync(runner)) {
    fail(
      `Runner not found: ${runner}\nBuild it with: RUSTUP_TOOLCHAIN=1.98.1 cargo build --manifest-path src/apps/desktop-nsh/native/Cargo.toml --features runner --target-dir target${cargoProfile}`,
    );
  }
  const lib = path.join(dir, backendLibName());
  if (!fs.existsSync(lib)) {
    fail(`Backend library not found: ${lib}\nBuild it with: cargo build -p openbitfun-desktop --lib${cargoProfile}`);
  }
  const nshAppDir = options.nshAppDir ? path.resolve(options.nshAppDir) : newestNshBundle();
  if (!nshAppDir || !fs.existsSync(path.join(nshAppDir, 'app.json'))) {
    fail(`NSH UI bundle not found: ${nshAppDir ?? 'target/desktop-nsh/nsh'}\nBuild it with: pnpm run desktop-nsh:bundle`);
  }
  return {
    runner,
    nshAppDir,
    label: `${options.profile} ${path.relative(ROOT, runner)}, NSH_APP_DIR=${path.relative(ROOT, nshAppDir) || nshAppDir}`,
  };
}

/** A one-commit Git worktree (the caller's Git identity and signing settings are not used). */
function initGitWorkspace(dir) {
  const git = args => {
    const result = spawnSync('git', ['-c', 'user.name=OpenBitFun E2E', '-c', 'user.email=e2e@openbitfun.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
      cwd: dir, encoding: 'utf8', windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
    }
  };
  git(['init', '-q']);
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'e2e smoke workspace']);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const real = p => fs.realpathSync.native(p);
const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// ---------------------------------------------------------------------------
// Minimal RFC 6455 client: text frames, client masking, ping/pong, close.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsClient {
  constructor(socket, head) {
    this.socket = socket;
    this.buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    this.onText = () => {};
    this.onClose = () => {};
    socket.setNoDelay(true);
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on('close', () => this.finish(1006, 'socket closed'));
    socket.on('error', () => this.finish(1006, 'socket error'));
    if (this.buffer.length) setImmediate(() => this.drain());
  }

  static connect({ port, token, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const key = randomBytes(16).toString('base64');
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/obp',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
          Authorization: `Bearer ${token}`,
        },
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`WebSocket upgrade timed out after ${timeoutMs} ms`)));
      req.on('error', reject);
      req.on('response', res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (body += chunk));
        res.on('end', () => reject(new Error(`WebSocket upgrade refused: HTTP ${res.statusCode} ${body.slice(0, 300)}`)));
      });
      req.on('upgrade', (res, socket, head) => {
        const expected = createHash('sha1').update(key + WS_GUID).digest('base64');
        if (res.headers['sec-websocket-accept'] !== expected) {
          socket.destroy();
          reject(new Error('WebSocket upgrade returned a wrong Sec-WebSocket-Accept'));
          return;
        }
        resolve(new WsClient(socket, head));
      });
      req.end();
    });
  }

  drain() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
      } else {
        payload = Buffer.from(payload);
      }
      this.buffer = this.buffer.subarray(offset + length);
      this.handleFrame(fin, opcode, payload);
    }
  }

  handleFrame(fin, opcode, payload) {
    if (opcode === 0x9) return this.sendFrame(0xa, payload); // ping -> pong
    if (opcode === 0xa) return undefined; // pong
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      if (!this.closed) this.sendFrame(0x8, payload.subarray(0, 2));
      this.socket.end();
      return this.finish(code, payload.subarray(2).toString('utf8'));
    }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      this.fragments.push(payload);
      if (!fin) return undefined;
      const message = Buffer.concat(this.fragments);
      this.fragments = [];
      return this.onText(message.toString('utf8'));
    }
    return undefined;
  }

  sendFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const mask = randomBytes(4);
    const length = payload.length;
    const header =
      length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    if (length < 126) header[1] = 0x80 | length;
    else if (length < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    const body = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1) body[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, body]));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.sendFrame(0x8, payload);
    this.closed = true;
    setTimeout(() => this.socket.destroy(), 1000).unref();
  }

  finish(code, reason) {
    if (this.finished) return;
    this.finished = true;
    this.closed = true;
    this.onClose(code, reason);
  }
}

// ---------------------------------------------------------------------------
// OBP JSON-RPC 2.0 session.

class ObpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.closeInfo = null;
    ws.onText = text => this.onMessage(text);
    ws.onClose = (code, reason) => {
      this.closeInfo = { code, reason };
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(Object.assign(new Error(`connection closed (code ${code})`), { closed: true }));
      }
      this.pending.clear();
    };
  }

  onMessage(text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame.method === 'event') {
      this.events.push(frame.params);
      // Credit flow control (hello `ack: true`): acknowledge what was read.
      if (typeof frame.params?.seq === 'number') {
        this.ws.sendText(JSON.stringify({ jsonrpc: '2.0', method: 'ack', params: { seq: frame.params.seq } }));
      }
      return;
    }
    const entry = this.pending.get(frame.id);
    if (!entry) return;
    this.pending.delete(frame.id);
    clearTimeout(entry.timer);
    if (frame.error) {
      entry.reject(Object.assign(new Error(frame.error.message || 'JSON-RPC error'), { rpc: frame.error }));
    } else {
      entry.resolve(frame.result);
    }
  }

  request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.closeInfo) return Promise.reject(new Error('connection is closed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.sendText(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  call(command, args = {}, timeoutMs) {
    return this.request('call', { command, args }, timeoutMs);
  }
}

// ---------------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function summarize(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > 140 ? `${text.slice(0, 140)}... (${text.length} chars)` : text;
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

function tail(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function findListenerPort(logDir) {
  for (const file of listFiles(logDir).filter(f => f.endsWith('.log'))) {
    const match = /OBP loopback listener started: url=http:\/\/127\.0\.0\.1:(\d+)/.exec(
      fs.readFileSync(file, 'utf8'),
    );
    if (match) return Number(match[1]);
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const launch = resolveLaunch(options);
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  const log = message => console.log(`[smoke ${elapsed()}] ${message}`);

  const tmp = real(fs.mkdtempSync(path.join(os.tmpdir(), 'openbitfun-e2e-smoke-')));
  const dirs = {
    user: path.join(tmp, 'user'),
    home: path.join(tmp, 'home'),
    osHome: path.join(tmp, 'os-home'),
    logs: path.join(tmp, 'logs'),
    workspace: path.join(tmp, 'workspace'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dirs.workspace, 'README.md'), '# e2e smoke workspace\n');
  // Workspace search (Flashgrep) indexes Git worktrees only: give the packaged
  // run's workspace a commit, so the search step reaches the bundled daemon.
  if (launch.packaged) initGitWorkspace(dirs.workspace);
  const runLog = path.join(tmp, 'runner-output.log');
  const runLogStream = fs.createWriteStream(runLog);
  const tokenFile = path.join(dirs.user, 'data', 'obp', 'owner-token');
  const port = await freePort();

  log(`launch: ${launch.label}`);
  log(`profile: ${tmp}`);

  const env = { ...process.env };
  // Never inherit a real profile or listener override from the caller's shell.
  for (const name of ['OPENBITFUN_USER_ROOT', 'OPENBITFUN_HOME', 'OPENBITFUN_LOG_DIR', 'OPENBITFUN_OBP_LISTENER', 'OPENBITFUN_WEBDRIVER_PORT', 'NSH_APP_DIR']) {
    delete env[name];
  }
  Object.assign(env, {
    OPENBITFUN_E2E_STORAGE_GUARD: '1',
    OPENBITFUN_E2E_USER_ROOT: dirs.user,
    OPENBITFUN_E2E_HOME: dirs.home,
    OPENBITFUN_E2E_LOG_DIR: dirs.logs,
    OPENBITFUN_OBP_PORT: String(port),
    // The NSH shell keeps its UI storage under the OS home (Application
    // Support / XDG / APPDATA): point that at the temporary profile too.
    HOME: dirs.osHome,
    XDG_DATA_HOME: path.join(dirs.osHome, '.local/share'),
    XDG_CONFIG_HOME: path.join(dirs.osHome, '.config'),
    XDG_CACHE_HOME: path.join(dirs.osHome, '.cache'),
  });
  if (process.platform === 'win32') {
    Object.assign(env, {
      USERPROFILE: dirs.osHome,
      APPDATA: path.join(dirs.osHome, 'AppData/Roaming'),
      LOCALAPPDATA: path.join(dirs.osHome, 'AppData/Local'),
    });
  }
  if (launch.nshAppDir) env.NSH_APP_DIR = launch.nshAppDir;

  const child = spawn(launch.runner, [], { env, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let exitInfo = null;
  const exited = new Promise(resolve => {
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      resolve(exitInfo);
    });
    child.on('error', error => {
      exitInfo = { code: null, signal: null, error };
      resolve(exitInfo);
    });
  });
  child.stdout.pipe(runLogStream, { end: false });
  child.stderr.pipe(runLogStream, { end: false });

  const results = [];
  let session = null;
  let failure = null;

  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, ms: Date.now() - t0 });
      log(`PASS ${name} (${Date.now() - t0} ms)${detail ? `: ${detail}` : ''}`);
    } catch (error) {
      results.push({ name, ok: false, ms: Date.now() - t0 });
      log(`FAIL ${name}: ${error.message}`);
      throw error;
    }
  };

  try {
    await step('owner token written under the temporary profile', async () => {
      const deadline = Date.now() + options.timeoutMs;
      while (!fs.existsSync(tokenFile)) {
        if (exitInfo) throw new Error(`app exited before the listener started: ${JSON.stringify(exitInfo)}`);
        if (Date.now() > deadline) throw new Error(`no owner token at ${tokenFile} after ${options.timeoutMs} ms`);
        await sleep(200);
      }
      assert(isInside(real(tokenFile), tmp), 'owner token lies inside the temporary profile');
      return path.relative(tmp, tokenFile);
    });

    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    assert(token.length >= 32, 'owner token is non-trivial');

    await step('connect ws://127.0.0.1/obp with the owner bearer token', async () => {
      // The token is written just before the listener binds: retry briefly.
      const deadline = Date.now() + 30_000;
      let lastError;
      while (Date.now() < deadline) {
        if (exitInfo) throw new Error(`app exited: ${JSON.stringify(exitInfo)}`);
        const actualPort = findListenerPort(dirs.logs) ?? port;
        try {
          session = new ObpSession(await WsClient.connect({ port: actualPort, token, timeoutMs: 5000 }));
          return `port ${actualPort}${actualPort !== port ? ` (requested ${port} was taken)` : ''}`;
        } catch (error) {
          lastError = error;
          if (/HTTP 4\d\d/.test(error.message)) throw error;
          await sleep(250);
        }
      }
      throw lastError ?? new Error('could not connect');
    });

    let hello;
    await step('hello (protocol 1, owner scope, isolated data dir)', async () => {
      hello = await session.request('hello', { protocol: 1, client: 'e2e-smoke', ack: true });
      assert(hello.protocol === 1, `hello.protocol is 1 (got ${hello.protocol})`);
      assert(hello.scope === 'owner', `hello.scope is owner (got ${hello.scope})`);
      assert(typeof hello.backend?.version === 'string' && hello.backend.version, 'hello.backend.version is set');
      assert(typeof hello.backend?.instanceId === 'string' && hello.backend.instanceId, 'hello.backend.instanceId is set');
      assert(Array.isArray(hello.capabilities), 'hello.capabilities is an array');
      const dataDir = hello.backend.dataDir;
      assert(typeof dataDir === 'string' && dataDir, 'owner hello carries backend.dataDir');
      assert(isInside(real(dataDir), tmp), `backend data dir ${dataDir} lies inside the temporary profile (storage guard active)`);
      return `version ${hello.backend.version}, platform ${hello.backend.platform}, dataDir ${path.relative(tmp, real(dataDir))}`;
    });

    await step('call get_app_version', async () => {
      const version = await session.call('get_app_version', { request: {} });
      assert(typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version), `version string (got ${summarize(version)})`);
      return version;
    });

    await step('call get_system_info', async () => {
      const info = await session.call('get_system_info');
      assert(typeof info?.platform === 'string' && info.platform, 'platform is set');
      assert(typeof info?.arch === 'string' && info.arch, 'arch is set');
      return `${info.platform}/${info.arch}`;
    });

    await step('call get_config (full config read)', async () => {
      const config = await session.call('get_config', { request: { path: null } });
      assert(config && typeof config === 'object' && !Array.isArray(config), `config is an object (got ${summarize(config)})`);
      return `${Object.keys(config).length} top-level keys: ${Object.keys(config).slice(0, 6).join(', ')}`;
    });

    let opened;
    await step('call open_workspace (temporary local folder)', async () => {
      opened = await session.call('open_workspace', { request: { createLocal: true, path: dirs.workspace } });
      assert(typeof opened?.id === 'string' && opened.id, 'workspace id is set');
      assert(typeof opened?.rootPath === 'string', 'workspace rootPath is set');
      assert(real(opened.rootPath) === real(dirs.workspace), `rootPath is the temporary workspace (got ${opened.rootPath})`);
      return `id ${opened.id}, name ${opened.name}`;
    });

    await step('call get_opened_workspaces', async () => {
      const list = await session.call('get_opened_workspaces');
      assert(Array.isArray(list), 'opened workspaces is an array');
      assert(list.some(item => item.id === opened.id), 'opened workspaces include the temporary workspace');
      return `${list.length} opened`;
    });

    await step('call get_recent_workspaces', async () => {
      const list = await session.call('get_recent_workspaces');
      assert(Array.isArray(list), 'recent workspaces is an array');
      for (const item of list) {
        assert(isInside(real(item.rootPath), tmp), `recent workspace ${item.rootPath} lies inside the temporary profile`);
      }
      return `${list.length} recent`;
    });

    await step('call list_sessions (temporary workspace)', async () => {
      const list = await session.call('list_sessions', { request: { workspacePath: dirs.workspace } });
      assert(Array.isArray(list), `sessions is an array (got ${summarize(list)})`);
      return `${list.length} sessions`;
    });

    if (launch.packaged) {
      await step('content search runs on the bundled Flashgrep daemon', async () => {
        await session.call('set_config', {
          request: { path: 'app.ai_experience.enable_workspace_search', value: true },
        });
        // A package without the daemon answers "Workspace search daemon is unavailable".
        const status = await session.call('search_get_repo_status', { request: { workspaceId: opened.id } });
        assert(status && typeof status === 'object', `repo status is an object (got ${summarize(status)})`);
        const search = () => session.call('search_file_contents', {
          request: { workspaceId: opened.id, pattern: 'e2e smoke workspace', maxResults: 10 },
        });
        const first = await search();
        assert(first?.searchMetadata, `the search went through the workspace search daemon (got ${summarize(first)})`);
        assert(first.results.length >= 1, `the search found README.md (got ${summarize(first.results)})`);
        // Index the worktree and wait until the daemon answers from its index.
        await session.call('search_build_index', { request: { workspaceId: opened.id } });
        const deadline = Date.now() + 60_000;
        let response = first;
        while (!/^indexed/.test(response.searchMetadata?.backend ?? '')) {
          if (Date.now() > deadline) {
            throw new Error(`the index never served the search (last ${summarize(response.searchMetadata)})`);
          }
          await sleep(250);
          response = await search();
        }
        assert(response.results.length >= 1, `the indexed search found README.md (got ${summarize(response.results)})`);
        return `before indexing ${first.searchMetadata.backend}; indexed: backend ${response.searchMetadata.backend}, repo phase ${response.searchMetadata.repoPhase}, ${response.results.length} result(s)`;
      });
    }

    await step('call initialize_tray_after_startup (wait for the NSH shell to attach)', async () => {
      // The UI attaches the shell (`host_shell_attach`) once its bundle has
      // loaded; until then shell adapters refuse with unsupported_in_native_host.
      const deadline = Date.now() + options.timeoutMs;
      let attempts = 0;
      for (;;) {
        attempts += 1;
        try {
          const result = await session.call('initialize_tray_after_startup');
          assert(result === null, `result is null (got ${summarize(result)})`);
          return `shell attached after ${attempts} attempt(s)`;
        } catch (error) {
          if (!/no desktop shell is attached/.test(error.message) || Date.now() > deadline) throw error;
          await sleep(250);
        }
      }
    });

    await step('call set_tray_unread_count (backend -> NSH shell -> backend)', async () => {
      const first = await session.call('set_tray_unread_count', { request: { count: 2 } });
      assert(first === null, `result is null (got ${summarize(first)})`);
      const reset = await session.call('set_tray_unread_count', { request: { count: 0 } });
      assert(reset === null, `reset result is null (got ${summarize(reset)})`);
      const shellEvents = session.events.filter(event => event.event === 'host://shell-request').length;
      return `resolved twice; host://shell-request events seen by this owner client: ${shellEvents}`;
    });

    await step('call quit_app and wait for a clean exit', async () => {
      try {
        const result = await session.call('quit_app', {}, 15_000);
        assert(result === null || result === undefined, `quit_app result is null (got ${summarize(result)})`);
      } catch (error) {
        // The process may exit before the reply leaves the socket.
        if (!error.closed) throw error;
      }
      const outcome = await Promise.race([exited, sleep(EXIT_TIMEOUT_MS).then(() => null)]);
      if (!outcome) throw new Error(`app still running ${EXIT_TIMEOUT_MS} ms after quit_app`);
      if (outcome.error) throw outcome.error;
      assert(outcome.code === 0, `exit code 0 (got code ${outcome.code}, signal ${outcome.signal})`);
      assert(!fs.existsSync(tokenFile), 'owner token removed at shutdown');
      return `exit code ${outcome.code}`;
    });
  } catch (error) {
    failure = error;
  } finally {
    if (session && !session.ws.closed) session.ws.close();
    if (!exitInfo) {
      child.kill('SIGKILL');
      await Promise.race([exited, sleep(5000)]);
    }
    runLogStream.end();
  }

  const passed = results.filter(r => r.ok).length;
  if (failure) {
    console.error(`\n[smoke] FAILED after ${elapsed()}: ${failure.message}`);
    console.error(`[smoke] process exit: ${JSON.stringify(exitInfo)}`);
    if (/unsupported_in_native_host/.test(failure.message)) {
      console.error(
        '[smoke] hint: the backend library, runner and NSH UI bundle must come from the same source revision; rebuild the stale part (pnpm run desktop-nsh:build, or the packaging script for --packaged).',
      );
    }
    const appLogs = listFiles(dirs.logs).filter(f => f.endsWith('app.log'));
    for (const file of appLogs) {
      console.error(`\n----- tail of ${file} -----\n${tail(file, 40)}`);
    }
    console.error(`\n----- tail of runner stdout/stderr -----\n${tail(runLog, 20)}`);
  }
  console.log(`\n[smoke] ${failure ? 'FAIL' : 'PASS'}: ${passed}/${results.length} steps passed in ${elapsed()} (${launch.label})`);

  if (options.keepProfile) {
    console.log(`[smoke] profile kept at ${tmp}`);
  } else {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  process.exit(failure ? 1 : 0);
}

main().catch(error => {
  console.error(`[smoke] ${error.message}`);
  process.exit(2);
});

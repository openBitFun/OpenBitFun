// The in-product Space view's bridge (wave 22, P4; tauri-gap §1.4, §4.3).
//
// A Space's document runs in an NSH `WebView` (an iframe on the web target)
// and this module is its pipe to the Space's device: it plays the part the
// desktop's MiniApp Shell plays for an independent window, over the backend's
// `miniapp_inline` command (open, then the closed Shell protocol: `poll`,
// `rpc`, `ready`, `heartbeat`, `close`, `agentClaim`, `agentResponse`). Every
// SDK call from the page becomes `miniapp_inline {method: "rpc"}` on that
// device; the backend binds the app, workspace and permissions and decides
// what each method may do. Nothing is answered locally except locale and
// appearance (from the backend's bootstrap) and the two host methods this
// client performs itself after the backend authorized them (open a link,
// write the clipboard). Agent bridge requests polled from the device are
// claimed, forwarded into the page and answered the same way.

import { lifecycle, signal } from "nsh";

/** The page's `window.parent` is the page itself; its posts reach `onMessage`. */
export const SPACE_FRAME_SHIM = `(function(){
  if (window.__obfSpaceBridge) return; window.__obfSpaceBridge = true;
  var real = window.parent, self = window, handshake = false;
  try {
    addEventListener("message", function (e) {
      if (e.source === real && real !== self && e.ports && e.ports.length) {
        handshake = true; setTimeout(function () { handshake = false; }, 0);
      }
    }, true);
    Object.defineProperty(window, "parent", { configurable: true, get: function () { return handshake ? real : self; } });
  } catch (e) {}
  var send = function (data) { try { window.nsh.postMessage(typeof data === "string" ? data : JSON.stringify(data)); } catch (e) {} };
  try { window.postMessage = function (data) { send(data); }; } catch (e) {}
  window.__obfSpaceDeliver = function (data) { window.dispatchEvent(new MessageEvent("message", { data: data, source: window })); };
})();`;

/** The script that hands one message to the page. */
export function spaceDeliverScript(message: unknown): string {
  return `window.__obfSpaceDeliver && window.__obfSpaceDeliver(${JSON.stringify(message)});true;`;
}

export type SpaceFrameStatus = "opening" | "ready" | "released" | "replaced" | "failed" | "closed";

export interface SpaceFrameBootstrap {
  instanceId: string;
  viewId: string;
  html: string;
  name: string;
  locale: string;
  appearanceMode: string;
  strictRuntime: boolean;
}

/** One agent request the device relayed into this view. */
export interface SpaceAgentEntry {
  requestId: string;
  method: string;
  action?: string;
  at: number;
  outcome: "pending" | "answered" | "refused";
}

export interface SpaceFrameDeps {
  /** `miniapp_inline {method, params}` on the Space's device. */
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Hands one message to the page (`spaceDeliverScript` through the WebView). */
  deliver: (message: unknown) => void;
  openUrl?: (url: string) => void;
  writeClipboard?: (text: string) => void;
  /** Wait between empty polls; tests shorten it. */
  pollWaitMs?: number;
  now?: () => number;
}

const SHELL_CAPABILITIES = ["miniapp_agent_bridge_v1"];
/** Methods this client performs itself once the device authorized them. */
const LOCAL_METHODS = new Set(["system.openExternal", "clipboard.writeText"]);
/** Methods that need the desktop Shell's own UI (dialogs, its chat composer). */
const SHELL_ONLY = /^(dialog\.|chat\.|clipboard\.readText$|system\.revealInFolder$|notifications\.system$)/;
const AGENT_LOG_LIMIT = 20;
const AGENT_ANSWER_TIMEOUT_MS = 15_000;

function newNonce(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof random === "function") return random.call((globalThis as { crypto: unknown }).crypto).replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One open Space view: its identity on the device and its event cursor. */
export class SpaceFrameSession {
  readonly status = signal<SpaceFrameStatus>("opening");
  readonly error = signal("");
  readonly bootstrap = signal<SpaceFrameBootstrap | null>(null);
  readonly agentLog = signal<SpaceAgentEntry[]>([]);
  readonly agentReady = signal(false);
  private nonce = newNonce();
  private cursor = 0;
  private generation = 0;
  private loaded = false;
  private capabilities: string[] = [];
  private actions: string[] = [];
  private readonly agentTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    readonly appId: string,
    readonly workspacePath: string | null,
    private readonly deps: SpaceFrameDeps,
  ) {}

  private identity(): Record<string, unknown> {
    const boot = this.bootstrap();
    return { instanceId: boot?.instanceId ?? "", viewId: boot?.viewId ?? "", nonce: this.nonce };
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.deps.invoke(method, { ...this.identity(), ...params });
  }

  /** Opens (or takes over) the view on the device and starts its event poll. */
  async open(appearanceMode?: string): Promise<void> {
    const generation = ++this.generation;
    this.status.set("opening");
    this.error.set("");
    this.loaded = false;
    this.cursor = 0;
    try {
      const answer = (await this.deps.invoke("open", {
        appId: this.appId,
        workspacePath: this.workspacePath,
        nonce: this.nonce,
        shellCapabilities: SHELL_CAPABILITIES,
        ...(appearanceMode ? { appearanceMode } : {}),
      })) as Record<string, any>;
      if (generation !== this.generation) return;
      const app = (answer?.app ?? {}) as Record<string, unknown>;
      const html = text(app.compiled_html ?? app.compiledHtml);
      if (!html.trim()) throw new Error("MiniApp document is empty; rebuild it in OpenBitFun");
      this.bootstrap.set({
        instanceId: text(answer?.instance?.instanceId ?? answer?.instance?.instance_id),
        viewId: text(answer?.view?.viewId ?? answer?.view?.view_id),
        html,
        name: text(app.name),
        locale: text(answer?.locale) || "en-US",
        appearanceMode: text(answer?.appearanceMode) || "dark",
        strictRuntime: text(app.runtime_profile ?? app.runtimeProfile) === "market_strict",
      });
      void this.poll(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.set("failed");
      this.error.set(errorText(error));
    }
  }

  /** The page finished loading: the view becomes the app's presentation. */
  async pageLoaded(): Promise<void> {
    if (this.loaded || !this.bootstrap()) return;
    this.loaded = true;
    try {
      await this.call("ready");
      this.status.set("ready");
      this.event("activate", {});
    } catch (error) {
      this.fail(error);
    }
  }

  private event(event: string, payload: unknown): void {
    this.deps.deliver({ type: "openbitfun:event", event, payload });
  }

  private fail(error: unknown): void {
    const message = errorText(error);
    // Another client took the view over: say so instead of a raw failure.
    if (/identity mismatch/i.test(message)) {
      this.status.set("replaced");
      this.stop();
      return;
    }
    if (/lease expired|view was released|no longer exists/i.test(message)) {
      this.status.set("released");
      this.stop();
      return;
    }
    this.status.set("failed");
    this.error.set(message);
  }

  private pollSleepTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSleepResolve: (() => void) | null = null;

  private stop(): void {
    this.generation++;
    if (this.pollSleepTimer !== null) {
      clearTimeout(this.pollSleepTimer);
      this.pollSleepTimer = null;
    }
    if (this.pollSleepResolve) {
      const resolve = this.pollSleepResolve;
      this.pollSleepResolve = null;
      resolve();
    }
    for (const timer of this.agentTimers.values()) clearTimeout(timer);
    this.agentTimers.clear();
  }

  private sleepPoll(ms: number, generation: number): Promise<void> {
    if (generation !== this.generation) return Promise.resolve();
    return new Promise(resolve => {
      this.pollSleepResolve = resolve;
      this.pollSleepTimer = setTimeout(() => {
        this.pollSleepTimer = null;
        this.pollSleepResolve = null;
        resolve();
      }, ms);
    });
  }

  private async poll(generation: number): Promise<void> {
    let failures = 0;
    while (generation === this.generation) {
      if (lifecycle() === "background") {
        await this.sleepPoll(500, generation);
        continue;
      }
      const startedAt = Date.now();
      try {
        const batch = (await this.call("poll", { after: this.cursor, waitMs: this.deps.pollWaitMs ?? 1500 })) as Record<
          string,
          any
        >;
        if (generation !== this.generation) return;
        failures = 0;
        if (batch?.released) {
          // "Open in window" (or a closed instance) moved the app away from here.
          this.status.set("released");
          this.stop();
          return;
        }
        for (const item of Array.isArray(batch?.events) ? batch.events : []) {
          const sequence = Number(item?.sequence ?? 0);
          if (sequence <= this.cursor) continue;
          this.cursor = sequence;
          const name = text(item?.event);
          if (name === "agentRequest") void this.relayAgent(item.payload ?? {});
          else if (name === "reload") {
            this.stop();
            void this.open();
            return;
          } else if (name !== "focus") this.event(name, item?.payload ?? null);
        }
        this.cursor = Math.max(this.cursor, Number(batch?.cursor ?? 0));
      } catch (error) {
        if (generation !== this.generation) return;
        failures += 1;
        if (failures >= 3 || /identity mismatch|lease expired|released/i.test(errorText(error))) {
          this.fail(error);
          return;
        }
      }
      // If a host ignores `waitMs` and returns immediately with no events, back off
      // slightly so we never spin a tight 20 Hz RPC loop.
      const elapsed = Date.now() - startedAt;
      const delay = elapsed < 25 ? Math.min(250, 50 * Math.max(1, failures + 1)) : 50;
      await this.sleepPoll(delay, generation);
    }
  }

  /** A message the page posted (`window.nsh.postMessage`). */
  async receive(raw: string): Promise<void> {
    let data: Record<string, any>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.type === "openbitfun:miniapp-agent-ready") {
      this.capabilities = Array.isArray(data.capabilities) ? data.capabilities.slice(0, 8).map(String) : [];
      this.actions = Array.isArray(data.actions) ? data.actions.filter((a: unknown) => typeof a === "string" && a).slice(0, 32) : [];
      this.agentReady.set(true);
      return;
    }
    if (data.type === "openbitfun:miniapp-agent-response") {
      void this.answerAgent(text(data.requestId), data.ok === true, data.value, data.error);
      return;
    }
    if (typeof data.method !== "string") return;
    const { id, method } = data;
    const params = data.params && typeof data.params === "object" ? data.params : {};
    const generation = this.generation;
    const reply = (result: unknown) => {
      if (id !== undefined && generation === this.generation) this.deps.deliver({ jsonrpc: "2.0", id, result });
    };
    const refuse = (error: unknown) => {
      if (id !== undefined && generation === this.generation)
        this.deps.deliver({ jsonrpc: "2.0", id, error: { code: -32000, message: errorText(error) } });
    };
    const boot = this.bootstrap();
    try {
      if (method === "openbitfun/request-locale") {
        reply({ locale: boot?.locale ?? "en-US" });
        this.event("localeChange", { locale: boot?.locale ?? "en-US" });
        return;
      }
      if (method === "openbitfun/request-appearance") {
        this.event("appearanceChange", { mode: boot?.appearanceMode ?? "dark", vars: {} });
        return;
      }
      if (method === "openbitfun/sandbox-wheel") return;
      if (LOCAL_METHODS.has(method)) {
        // The device decides whether this app may; this client only performs it.
        await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
        if (method === "system.openExternal") {
          const url = text(params.url);
          if (!/^https?:\/\//i.test(url) || !this.deps.openUrl) throw new Error("This link cannot open here");
          this.deps.openUrl(url);
        } else {
          if (!this.deps.writeClipboard) throw new Error("The clipboard is not available here");
          this.deps.writeClipboard(String(params.text ?? ""));
        }
        reply(null);
        return;
      }
      if (SHELL_ONLY.test(method)) {
        throw new Error(`${method} needs the Space's own window; use Open in window on its desktop`);
      }
      reply(await this.call("rpc", { method, params }));
    } catch (error) {
      if (/identity mismatch|lease expired/i.test(errorText(error))) this.fail(error);
      refuse(error);
    }
  }

  private logAgent(entry: SpaceAgentEntry): void {
    this.agentLog.update(list => [entry, ...list.filter(item => item.requestId !== entry.requestId)].slice(0, AGENT_LOG_LIMIT));
  }

  private settleLog(requestId: string, outcome: SpaceAgentEntry["outcome"]): void {
    this.agentLog.update(list => list.map(item => (item.requestId === requestId ? { ...item, outcome } : item)));
  }

  private async relayAgent(request: Record<string, any>): Promise<void> {
    const requestId = text(request.requestId);
    if (!requestId || this.agentTimers.has(requestId)) return;
    const method = text(request.method);
    const action = request.action && typeof request.action === "object" ? text(request.action.type) : undefined;
    this.logAgent({ requestId, method, action, at: (this.deps.now ?? Date.now)(), outcome: "pending" });
    try {
      const claim = (await this.call("agentClaim", { requestId })) as Record<string, unknown> | null;
      if (claim?.accepted !== true) {
        this.settleLog(requestId, "refused");
        return;
      }
      if (this.status() !== "ready") {
        await this.answerAgent(requestId, false, null, "The Space is not ready", "SURFACE_UNAVAILABLE");
        return;
      }
      if (typeof request.expiresAt === "number" && (this.deps.now ?? Date.now)() >= request.expiresAt) {
        await this.answerAgent(requestId, false, null, "The Agent request expired before delivery", "BRIDGE_TIMEOUT");
        return;
      }
    } catch (error) {
      await this.answerAgent(requestId, false, null, errorText(error), "SURFACE_UNAVAILABLE");
      return;
    }
    this.agentTimers.set(
      requestId,
      setTimeout(() => {
        if (this.agentTimers.has(requestId)) void this.answerAgent(requestId, false, null, "The Space did not answer in time", "BRIDGE_TIMEOUT");
      }, AGENT_ANSWER_TIMEOUT_MS),
    );
    const payload: Record<string, unknown> = {
      type: "openbitfun:miniapp-agent-request",
      schemaVersion: request.schemaVersion,
      requestId,
      method: request.method,
    };
    if (request.action !== undefined && request.action !== null) payload.action = request.action;
    this.deps.deliver(payload);
  }

  private async answerAgent(requestId: string, ok: boolean, value: unknown, error?: unknown, code?: string): Promise<void> {
    const timer = this.agentTimers.get(requestId);
    if (timer) clearTimeout(timer);
    this.agentTimers.delete(requestId);
    this.settleLog(requestId, ok ? "answered" : "refused");
    try {
      await this.call("agentResponse", {
        requestId,
        ok,
        value: value ?? null,
        error: error ? String(error) : null,
        code: code ?? null,
        capabilities: this.capabilities,
        actions: this.actions,
      });
    } catch {
      // The device already gave up on the request; nothing waits on this answer.
    }
  }

  /** The user closed the Space page: release the view (the device stops idle work). */
  async close(): Promise<void> {
    const wasOpen = this.bootstrap() !== null && this.status() !== "released" && this.status() !== "replaced";
    this.stop();
    this.status.set("closed");
    if (wasOpen) await this.call("close").catch(() => undefined);
  }
}

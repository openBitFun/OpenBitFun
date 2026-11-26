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
import type { FileDialogFilter, FileDialogOptions } from "./windowShell";

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

export interface SpaceChromeAction {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
}

export interface SpaceChromeConfig {
  titlebar?: {
    title?: string;
    actions?: SpaceChromeAction[];
  };
}

export interface SpacePermissionRequest {
  requestId: string;
  sessionId?: string;
  action?: string;
  projectPath?: string;
  resources?: string[];
}

export interface SpaceFrameBootstrap {
  instanceId: string;
  viewId: string;
  html: string;
  name: string;
  description?: string;
  icon?: string;
  locale: string;
  appearanceMode: string;
  strictRuntime: boolean;
  chrome?: SpaceChromeConfig;
  presentationCapabilities: string[];
}

/** One agent request the device relayed into this view. */
export interface SpaceAgentEntry {
  requestId: string;
  method: string;
  action?: string;
  at: number;
  outcome: "pending" | "answered" | "refused";
}

export interface SpaceWindowChatHooks {
  claim(params: Record<string, unknown>): void;
  focusSession(sessionId: string): Promise<void>;
  release(): void;
  clearSession(): void;
  setDraft(text: string): void;
  complete(params: Record<string, unknown>): unknown;
  acceptedRun?(result: unknown, requestId: string | null): void;
  getRequestId?(): string | null;
}

export interface SpaceFrameDeps {
  /** `miniapp_inline {method, params}` on the Space's device. */
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Hands one message to the page (`spaceDeliverScript` through the WebView). */
  deliver: (message: unknown) => void;
  /** `"tab"` (default, in-product view) or `"window"` (native desktop NSH window). */
  kind?: "tab" | "window";
  openUrl?: (url: string) => void;
  writeClipboard?: (text: string) => void;
  readClipboard?: () => Promise<string>;
  showNotification?: (title: string, body: string) => Promise<void>;
  pickFileDialog?: (options: FileDialogOptions) => Promise<string | string[] | null>;
  showMessageDialog?: (options: { title: string; message: string }) => Promise<boolean>;
  chat?: SpaceWindowChatHooks;
  onFocus?: () => void;
  onAgentEvent?: (payload: Record<string, unknown>) => void;
  onPermissions?: (requests: SpacePermissionRequest[]) => void;
  /** Wait between empty polls; tests shorten it. */
  pollWaitMs?: number;
  now?: () => number;
}

const TAB_SHELL_CAPABILITIES = ["miniapp_agent_bridge_v1"];
const WINDOW_SHELL_CAPABILITIES = [
  "miniapp_custom_chrome_v1",
  "miniapp_chat_snapshot_v1",
  "miniapp_agent_bridge_v1",
];
/** Methods this client performs itself once the device authorized them. */
const LOCAL_METHODS = new Set(["system.openExternal", "clipboard.writeText"]);
/** Private host adapter RPCs that untrusted page content must never invoke directly. */
const PRIVATE_HOST_RPCS = new Set(["authorizeLocal", "grantSelectedPath"]);
/** Methods that need the desktop Shell's own UI (dialogs, its chat composer). */
const SHELL_ONLY = /^(dialog\.|chat\.|clipboard\.readText$|system\.revealInFolder$|notifications\.system$)/;
const AGENT_LOG_LIMIT = 20;
const AGENT_ANSWER_TIMEOUT_MS = 15_000;

function normalizeChrome(raw: unknown): SpaceChromeConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const chrome = raw as Record<string, unknown>;
  const tb = chrome.titlebar;
  if (!tb || typeof tb !== "object") return undefined;
  const bar = tb as Record<string, unknown>;
  const title = typeof bar.title === "string" && bar.title.trim() ? bar.title.trim() : undefined;
  const actions: SpaceChromeAction[] = Array.isArray(bar.actions)
    ? bar.actions
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map(item => ({
          id: text(item.id).trim(),
          label: text(item.label).trim() || text(item.tooltip).trim() || text(item.id).trim(),
          icon: typeof item.icon === "string" ? item.icon : undefined,
          tooltip: typeof item.tooltip === "string" ? item.tooltip : undefined,
        }))
        .filter(item => Boolean(item.id))
        .slice(0, 8)
    : [];
  if (!title && actions.length === 0) return undefined;
  return { titlebar: { title, actions } };
}

function normalizeFilters(raw: unknown): FileDialogFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(item => ({
      name: typeof item.name === "string" ? item.name : undefined,
      extensions: Array.isArray(item.extensions)
        ? item.extensions.filter((ext): ext is string => typeof ext === "string" && Boolean(ext.trim()))
        : [],
    }))
    .filter(item => item.extensions.length > 0);
}

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
  private composerGeneration = 0;
  private bindingGeneration = 0;
  private permissionTick = 0;
  private loaded = false;
  private capabilities: string[] = [];
  private actions: string[] = [];
  private readonly agentTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    readonly appId: string,
    readonly workspacePath: string | null,
    private readonly deps: SpaceFrameDeps,
  ) {}

  private isWindowMode(): boolean {
    return this.deps.kind === "window";
  }

  private identity(): Record<string, unknown> {
    const boot = this.bootstrap();
    return { instanceId: boot?.instanceId ?? "", viewId: boot?.viewId ?? "", nonce: this.nonce };
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.deps.invoke(method, { ...this.identity(), ...params });
  }

  /** Sends a host event (`chrome:action`, `chat:userMessage`, etc.) into the MiniApp document. */
  sendEvent(event: string, payload: unknown): void {
    this.event(event, payload);
  }

  /** Loads the compact chat snapshot for a session owned by this window instance. */
  loadChatSnapshot(sessionId: string): Promise<unknown> {
    return this.call("chatSnapshot", { sessionId });
  }

  /** Cancels an active MiniApp agent turn for this window instance. */
  cancelAgentRun(params: Record<string, unknown>): Promise<unknown> {
    return this.call("rpc", { method: "agent.cancel", params });
  }

  /** Lists pending permission requests owned by this instance. */
  async refreshPermissions(): Promise<SpacePermissionRequest[]> {
    const list = await this.call("permissions", {});
    const requests = Array.isArray(list) ? (list as SpacePermissionRequest[]) : [];
    this.deps.onPermissions?.(requests);
    return requests;
  }

  /** Responds (`once` | `reject`) to a pending permission request owned by this instance. */
  async respondPermission(requestId: string, reply: "once" | "reject"): Promise<SpacePermissionRequest[]> {
    const list = await this.call("permissions", { requestId, reply });
    const requests = Array.isArray(list) ? (list as SpacePermissionRequest[]) : [];
    this.deps.onPermissions?.(requests);
    return requests;
  }

  /** Requests moving this standalone window back into an in-product tab view. */
  transferToTab(): Promise<unknown> {
    return this.call("tab", {});
  }

  /** Opens (or takes over) the view on the device and starts its event poll. */
  async open(appearanceMode?: string): Promise<void> {
    const generation = ++this.generation;
    this.status.set("opening");
    this.error.set("");
    this.loaded = false;
    this.cursor = 0;
    this.composerGeneration += 1;
    this.bindingGeneration += 1;
    try {
      const answer = (await this.deps.invoke("open", {
        appId: this.appId,
        workspacePath: this.workspacePath,
        nonce: this.nonce,
        shellCapabilities: this.isWindowMode() ? WINDOW_SHELL_CAPABILITIES : TAB_SHELL_CAPABILITIES,
        ...(this.isWindowMode() ? { kind: "window" } : {}),
        ...(appearanceMode ? { appearanceMode } : {}),
      })) as Record<string, any>;
      if (generation !== this.generation) return;
      const app = (answer?.app ?? {}) as Record<string, unknown>;
      const html = text(app.compiled_html ?? app.compiledHtml);
      if (!html.trim()) throw new Error("MiniApp document is empty; rebuild it in OpenBitFun");
      const locale = text(answer?.locale) || "en-US";
      const i18nLocales =
        app.i18n && typeof app.i18n === "object"
          ? ((app.i18n as Record<string, unknown>).locales as Record<string, Record<string, unknown>> | undefined)
          : undefined;
      const localized = i18nLocales?.[locale];
      const capabilities = Array.isArray(answer?.presentationCapabilities)
        ? answer.presentationCapabilities.filter((cap: unknown): cap is string => typeof cap === "string")
        : [];
      this.bootstrap.set({
        instanceId: text(answer?.instance?.instanceId ?? answer?.instance?.instance_id),
        viewId: text(answer?.view?.viewId ?? answer?.view?.view_id),
        html,
        name: text(localized?.name) || text(app.name),
        description: text(localized?.description) || text(app.description) || undefined,
        icon: text(app.icon) || undefined,
        locale,
        appearanceMode: text(answer?.appearanceMode) || "dark",
        strictRuntime: text(app.runtime_profile ?? app.runtimeProfile) === "market_strict",
        chrome: capabilities.includes("miniapp_custom_chrome_v1") ? normalizeChrome(app.chrome) : undefined,
        presentationCapabilities: capabilities,
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
        const events = Array.isArray(batch?.events) ? batch.events : [];
        for (const item of events) {
          const sequence = Number(item?.sequence ?? 0);
          if (sequence <= this.cursor) continue;
          this.cursor = sequence;
          const name = text(item?.event);
          if (name === "agentRequest") void this.relayAgent(item.payload ?? {});
          else if (name === "reload") {
            this.stop();
            void this.open();
            return;
          } else if (name === "focus") {
            this.deps.onFocus?.();
          } else {
            this.event(name, item?.payload ?? null);
            if (name === "agent:event" && item?.payload && typeof item.payload === "object") {
              this.deps.onAgentEvent?.(item.payload as Record<string, unknown>);
            }
          }
        }
        this.cursor = Math.max(this.cursor, Number(batch?.cursor ?? 0));
        if (this.isWindowMode() && this.deps.onPermissions && (events.length === 0 || this.permissionTick++ % 8 === 0)) {
          await this.refreshPermissions().catch(() => undefined);
        }
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
      if (PRIVATE_HOST_RPCS.has(method)) {
        throw new Error("Private MiniApp host operation");
      }
      if (LOCAL_METHODS.has(method)) {
        // The device decides whether this app may; this client only performs it.
        await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
        if (method === "system.openExternal") {
          const url = text(params.url);
          const allowed = this.isWindowMode() ? /^(https?:\/\/|mailto:)/i : /^https?:\/\//i;
          if (!allowed.test(url) || !this.deps.openUrl) throw new Error("This link cannot open here");
          this.deps.openUrl(url);
        } else {
          if (!this.deps.writeClipboard) throw new Error("The clipboard is not available here");
          this.deps.writeClipboard(String(params.text ?? ""));
        }
        reply(null);
        return;
      }
      if (SHELL_ONLY.test(method)) {
        if (!this.isWindowMode()) {
          throw new Error(`${method} needs the Space's own window; use Open in window on its desktop`);
        }
        const assertCurrent = () => {
          if (generation !== this.generation) throw new Error("MiniApp content view changed");
        };
        if (method === "dialog.open" || method === "dialog.save") {
          await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
          assertCurrent();
          if (!this.deps.pickFileDialog) throw new Error("Native file dialog is unavailable in this host");
          const multiple = method === "dialog.open" && params.multiple === true;
          const selected = await this.deps.pickFileDialog({
            mode: method === "dialog.save" ? "save" : "open",
            title: typeof params.title === "string" ? params.title : undefined,
            defaultPath: typeof params.defaultPath === "string" ? params.defaultPath : undefined,
            multiple,
            directory: method === "dialog.open" && params.directory === true,
            filters: normalizeFilters(params.filters),
          });
          assertCurrent();
          if (selected === null) {
            reply(null);
            return;
          }
          const paths = Array.isArray(selected) ? selected : [selected];
          for (const path of paths) {
            await this.call("rpc", { method: "grantSelectedPath", params: { path } });
            assertCurrent();
          }
          reply(multiple ? paths : (paths[0] ?? null));
          return;
        }
        if (method === "dialog.message") {
          await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
          assertCurrent();
          if (!this.deps.showMessageDialog) throw new Error("Message dialog is unavailable in this host");
          const answered = await this.deps.showMessageDialog({
            title: typeof params.title === "string" && params.title.trim() ? params.title : (boot?.name || "MiniApp"),
            message: text(params.message),
          });
          assertCurrent();
          reply(answered);
          return;
        }
        if (method === "clipboard.readText") {
          await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
          assertCurrent();
          if (!this.deps.readClipboard) throw new Error("The clipboard is not available here");
          reply(await this.deps.readClipboard());
          return;
        }
        if (method === "notifications.system") {
          await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
          assertCurrent();
          const title = text(params.title);
          if (!title) throw new Error("Missing MiniApp notification title");
          if (!this.deps.showNotification) throw new Error("System notifications are unavailable in this host");
          await this.deps.showNotification(title, text(params.body));
          reply(null);
          return;
        }
        if (method === "system.revealInFolder") {
          reply(await this.call("rpc", { method, params }));
          return;
        }
        if (method === "chat.claimComposer") {
          const claim = ++this.composerGeneration;
          await this.call("rpc", { method: "authorizeLocal", params: { action: method } });
          assertCurrent();
          if (claim !== this.composerGeneration) throw new Error("MiniApp composer claim changed");
          this.deps.chat?.claim(params);
          reply(null);
          return;
        }
        if (method === "chat.focusSession") {
          const binding = ++this.bindingGeneration;
          await this.call("rpc", {
            method: "authorizeLocal",
            params: { action: method, sessionId: params.sessionId },
          });
          assertCurrent();
          if (binding !== this.bindingGeneration) throw new Error("MiniApp chat binding changed");
          await this.deps.chat?.focusSession(text(params.sessionId));
          assertCurrent();
          reply(null);
          return;
        }
        if (method === "chat.releaseComposer") {
          this.composerGeneration += 1;
          this.bindingGeneration += 1;
          this.deps.chat?.release();
          reply(null);
          return;
        }
        if (method === "chat.clearSession") {
          this.bindingGeneration += 1;
          this.deps.chat?.clearSession();
          reply(null);
          return;
        }
        if (method === "chat.setComposerDraft") {
          this.deps.chat?.setDraft(text(params.text));
          reply(null);
          return;
        }
        if (method === "chat.completeUserMessage") {
          reply(this.deps.chat?.complete(params) ?? null);
          return;
        }
      }
      const chatRequestId = this.deps.chat?.getRequestId?.() ?? null;
      const result = await this.call("rpc", { method, params });
      if (generation !== this.generation) throw new Error("MiniApp content view changed");
      if (method === "agent.run") this.deps.chat?.acceptedRun?.(result, chatRequestId);
      reply(result);
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

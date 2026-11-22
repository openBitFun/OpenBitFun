// The embedded browser of the native desktop.
//
// The backend owns the browser's targets and every agent-facing semantic
// (`src/apps/desktop/src/native_browser.rs`): which pages exist, who owns
// them, navigation waits and the browser primitives agent tools send. The web
// views themselves live in this UI process (NSH `WebView`), so the backend
// asks the shell to act on a page over `host://shell-request`
// (`browser.create`, `browser.navigate`, `browser.evaluate`, ...); this module
// is that actuator and reports every page load back with
// `browser_webview_report_page_load`.
//
// The scene drives its pages through the same backend commands the React
// scene calls (`browser_webview_create`, `browser_webview_navigate`,
// `browser_webview_reload`, `browser_webview_eval`,
// `browser_webview_set_agent_target_state`), so a user's page and an
// agent's page are one kind of target.
//
// Pages outlive the Browser scene: `BrowserPageLayer` keeps every page's web
// view mounted (an agent's page exists before anyone looks at it) and places
// the presented one over the scene's viewport.
//
// Wave 22 adds what sits around the pages: the inspector tab beside a
// session (an agent page the session opens presents there), the element
// picker that hands a page element to the composer, the preview of a
// workspace's HTML file, and the read-only live view a phone, a browser or
// another desktop draws of a desktop's page (`browser_webview_capture_preview`,
// a script-free copy the backend takes; there is no pixel snapshot API).

import { computed, lifecycle, openUrl, signal, WebView } from "nsh";
import { invokeCommand, listenEvent, windowShellId } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import { localizeHostError, tr } from "./i18n";
import { palette } from "./theme";

/**
 * What the browser asks of the session around it. `src/browserSession.ts`
 * installs these when the shell loads: this module is also loaded by the
 * native shell's actuator before the app state exists, so it cannot import
 * `state.ts` itself.
 */
export interface BrowserSessionHooks {
  /** An agent page of `sessionId` opened: present it beside that session if it is open. */
  agentPageOpened(sessionId: string | null): void;
  /** Adds text to the composer of the open session (or of a new one). */
  insertIntoComposer(text: string): void;
  /** Previews a local HTML file through the workspace's device. */
  previewLocalHtml(path: string): Promise<void>;
}

let sessionHooks: BrowserSessionHooks | null = null;

export function installBrowserSessionHooks(hooks: BrowserSessionHooks): void {
  sessionHooks = hooks;
}

export const BROWSER_DEFAULT_URL = "https://openbitfun.com/";
export const MAX_LIVE_BROWSER_PAGES = 6;
const IDLE_PAGE_EVICT_MS = 10 * 60_000;
const USER_LABEL_PREFIX = "embedded-browser-view-";
const AGENT_LABEL_PREFIX = "embedded-browser-panel-view-";
const HANDLE_WAIT_MS = 8_000;
const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

/** Last activity timestamp per page label for LRU eviction of idle off-screen WebViews. */
const pageLastActive = new Map<string, number>();

function touchBrowserPage(label: string): void {
  pageLastActive.set(label, Date.now());
}

function hasPendingEvaluations(label: string): boolean {
  for (const entry of pendingEvaluations.values()) {
    if (entry.label === label) return true;
  }
  return false;
}

/**
 * Evicts idle off-screen WebViews beyond `MAX_LIVE_BROWSER_PAGES` (or older than
 * `IDLE_PAGE_EVICT_MS`), always preserving the presented page and any page with
 * in-flight evaluations.
 */
export function evictIdleBrowserPages(now = Date.now(), maxPages = MAX_LIVE_BROWSER_PAGES): number {
  const presented = presentedLabel();
  const pages = browserPages();
  const expired = new Set<string>();
  for (const page of pages) {
    if (page.label === presented || hasPendingEvaluations(page.label)) continue;
    const last = pageLastActive.get(page.label) ?? now;
    if (now - last > IDLE_PAGE_EVICT_MS) {
      expired.add(page.label);
    }
  }
  let remaining = pages.filter(page => !expired.has(page.label));
  if (remaining.length > maxPages) {
    const candidates = remaining
      .filter(page => page.label !== presented && !hasPendingEvaluations(page.label))
      .sort((a, b) => (pageLastActive.get(a.label) ?? 0) - (pageLastActive.get(b.label) ?? 0));
    const overflow = remaining.length - maxPages;
    for (let i = 0; i < overflow && i < candidates.length; i += 1) {
      expired.add(candidates[i]!.label);
    }
    remaining = remaining.filter(page => !expired.has(page.label));
  }
  if (expired.size === 0) return 0;
  for (const label of expired) {
    abortEvaluations(label, "the idle page was evicted");
    handles.delete(label);
    pageLastActive.delete(label);
  }
  browserPages.set(remaining);
  return expired.size;
}

/** The input `sendInput` gives a page as the user's own. */
export type BrowserInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: "Enter" | "Tab" | "Escape" | "Backspace" };

/** What the store needs of a page's view: a `WebViewRef`, or a test's stand-in. */
export interface BrowserViewHandle {
  load(options: { src: string }): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  stopLoading(): void;
  injectJavaScript(script: string): void;
  sendInput(input: BrowserInput): void;
}

/** Where a page is, as the web view's navigation events say. */
export interface BrowserNavigationFacts {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** A web view's events, as the page layer forwards them. */
export interface BrowserPageEvents {
  loadStart(facts: BrowserNavigationFacts): void;
  load(facts: BrowserNavigationFacts): void;
  error(error: { message: string; code?: string }): void;
  navigationState(facts: BrowserNavigationFacts): void;
  /** The page called `window.nsh.postMessage(data)`. */
  message(data: string): void;
}

/**
 * Stands in for NSH's `WebView` where the test host shows none: the page
 * layer renders a plain view and asks the driver for each page's handle.
 */
export interface BrowserViewDriver {
  createHandle(label: string, initialUrl: string, events: BrowserPageEvents): BrowserViewHandle;
  inputAvailable: boolean;
}

export interface BrowserPage {
  label: string;
  /** The URL the web view was created with; later loads go through its ref. */
  initialUrl: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  /** The agent conversation that owns the page; `null` for the user's own page. */
  conversationId: string | null;
  /** The size the page keeps while it is hidden. */
  width: number;
  height: number;
}

export type BrowserAvailability = "checking" | "available" | "noWebView" | "notNative";

/** A rectangle in the page layer's coordinates. */
export interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const browserPages = signal<BrowserPage[]>([]);
/** The page the Browser scene shows. */
export const presentedLabel = signal<string | null>(null);
/** Where the Browser scene's viewport is, while the scene is on screen. */
export const browserViewport = signal<BrowserRect | null>(null);
/**
 * A floating surface of the scene (its pages menu) covers the viewport: the
 * native web view would draw over it, so the page steps aside meanwhile.
 */
export const browserOccluded = signal(false);
/** The scene's own error line (a refused command, an older host). */
export const browserNotice = signal<string | null>(null);
/** What the address field holds. */
export const browserAddress = signal<string>("");
export const browserAvailability = signal<BrowserAvailability>("checking");

const actuatorInstalled = signal(false);
let viewDriver: BrowserViewDriver | null = null;
let webViewInputAvailable = false;
const handles = new Map<string, BrowserViewHandle>();
const handleWaiters = new Map<string, Array<(handle: BrowserViewHandle) => void>>();
let nextUserLabel = 1;

export const presentedPage = computed<BrowserPage | null>(() => {
  const label = presentedLabel();
  return browserPages().find(page => page.label === label) ?? null;
});

/** The native shell runs the browser operations (`nshShellRequests.ts`). */
export function markBrowserActuatorInstalled(): void {
  actuatorInstalled.set(true);
}

/** Tests: pages are the driver's stand-ins instead of NSH web views. */
export function installBrowserViewDriver(driver: BrowserViewDriver): void {
  viewDriver = driver;
  actuatorInstalled.set(true);
}

export function browserViewDriver(): BrowserViewDriver | null {
  return viewDriver;
}

/** Decides once whether this client can show pages. */
export async function probeBrowserAvailability(): Promise<void> {
  if (viewDriver) {
    browserAvailability.set("available");
    return;
  }
  // Only the native desktop shell holds web views the backend can drive: a
  // browser tab or the Tauri page shows the unsupported state instead of a
  // page the backend cannot reach.
  if (!actuatorInstalled() || windowShellId() !== "nsh-desktop") {
    browserAvailability.set("notNative");
    return;
  }
  let shows = false;
  try {
    shows = await WebView.available();
    webViewInputAvailable = shows && (await WebView.inputAvailable());
  } catch {
    shows = false;
  }
  browserAvailability.set(shows ? "available" : "noWebView");
}

/** A page an agent opened (the backend names them apart from the user's). */
export function isAgentPage(page: BrowserPage): boolean {
  return page.label.startsWith(AGENT_LABEL_PREFIX);
}

function pageOf(label: string): BrowserPage | undefined {
  return browserPages().find(page => page.label === label);
}

function updatePage(label: string, patch: Partial<BrowserPage>): void {
  browserPages.set(browserPages().map(page => (page.label === label ? { ...page, ...patch } : page)));
}

function isBrowserLabel(label: unknown): label is string {
  return typeof label === "string" && (label.startsWith(USER_LABEL_PREFIX) || label.startsWith(AGENT_LABEL_PREFIX));
}

function requireLabel(args: Record<string, unknown>): string {
  const label = args.label;
  if (!isBrowserLabel(label)) throw new Error("invalid browser webview label");
  return label;
}

/** A mounted page's view hands its ref over here. */
export function registerBrowserHandle(label: string, handle: BrowserViewHandle | null): void {
  if (!handle) {
    handles.delete(label);
    return;
  }
  handles.set(label, handle);
  const waiters = handleWaiters.get(label) ?? [];
  handleWaiters.delete(label);
  for (const resolve of waiters) resolve(handle);
}

function waitForHandle(label: string): Promise<BrowserViewHandle> {
  const ready = handles.get(label);
  if (ready) return Promise.resolve(ready);
  if (!pageOf(label)) return Promise.reject(new Error(`Webview not found: ${label}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = handleWaiters.get(label) ?? [];
      handleWaiters.set(
        label,
        waiters.filter(waiter => waiter !== settle),
      );
      reject(new Error(`The page ${label} has no web view yet`));
    }, HANDLE_WAIT_MS);
    const settle = (handle: BrowserViewHandle) => {
      clearTimeout(timer);
      resolve(handle);
    };
    handleWaiters.set(label, [...(handleWaiters.get(label) ?? []), settle]);
  });
}

// ── Scripts with a result ──
//
// NSH 0.6's `WebViewRef.evaluate` never answers on macOS (every call ends in
// ETIMEDOUT, also for `1 + 1`), while `injectJavaScript` and the page's
// `window.nsh.postMessage` work. A script with a result therefore runs
// injected and posts its envelope back, keyed by a per-request nonce; the
// envelope has `evaluate`'s shape. Like `evaluate`, the value comes from the
// page: the backend treats it as untrusted data.

interface PendingEvaluation {
  label: string;
  resolve(reply: { ok: boolean; value?: unknown; code?: string | null; message?: string }): void;
  timer: ReturnType<typeof setTimeout>;
}

const EVALUATION_KEY = "__openbitfunEvaluation";
const pendingEvaluations = new Map<string, PendingEvaluation>();
let evaluationSeq = 0;

function evaluationNonce(): string {
  evaluationSeq += 1;
  const random = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Math.random()}`.slice(2);
  return `${evaluationSeq}-${random}`;
}

/** The injected wrapper: runs `script` as `evaluate` does and posts its envelope. */
export function evaluationScript(nonce: string, script: string): string {
  return `(() => {
  const nonce = ${JSON.stringify(nonce)};
  const post = envelope => {
    try { window.nsh.postMessage(JSON.stringify({ ${EVALUATION_KEY}: nonce, ...envelope })); } catch (_) {}
  };
  const fail = error => post({ ok: false, code: "ERR_NSH_WEBVIEW_SCRIPT", message: String(error && error.message !== undefined ? error.message : error).slice(0, 512) });
  try {
    Promise.resolve((0, eval)(${JSON.stringify(script)})).then(value => {
      let text;
      try { text = JSON.stringify(value === undefined ? null : value); } catch (error) { fail(error); return; }
      post({ ok: true, value: text === undefined ? null : JSON.parse(text) });
    }, fail);
  } catch (error) { fail(error); }
})();`;
}

function settleEvaluation(nonce: string, reply: { ok: boolean; value?: unknown; code?: string | null; message?: string }): void {
  const pending = pendingEvaluations.get(nonce);
  if (!pending) return;
  pendingEvaluations.delete(nonce);
  clearTimeout(pending.timer);
  pending.resolve(reply);
}

/** A navigation or a closed page ends the scripts still running in it. */
function abortEvaluations(label: string, message: string): void {
  for (const [nonce, pending] of [...pendingEvaluations]) {
    if (pending.label === label) settleEvaluation(nonce, { ok: false, code: "ERR_NSH_WEBVIEW_ABORTED", message });
  }
}

function evaluateInPage(
  label: string,
  handle: BrowserViewHandle,
  script: string,
  timeoutMs: number,
): Promise<{ ok: boolean; value?: unknown; code?: string | null; message?: string }> {
  const nonce = evaluationNonce();
  return new Promise(resolve => {
    const timer = setTimeout(
      () => settleEvaluation(nonce, { ok: false, code: "ETIMEDOUT", message: "the page did not answer the script in time" }),
      timeoutMs,
    );
    pendingEvaluations.set(nonce, { label, resolve, timer });
    handle.injectJavaScript(evaluationScript(nonce, script));
  });
}

/** A page's message: an evaluation envelope, or the page's own (ignored). */
function receivePageMessage(label: string, data: string): void {
  if (!data.includes(EVALUATION_KEY)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  const nonce = parsed[EVALUATION_KEY];
  if (typeof nonce !== "string") return;
  // Only the page the script was sent to may answer it.
  if (pendingEvaluations.get(nonce)?.label !== label) return;
  settleEvaluation(nonce, {
    ok: parsed.ok === true,
    value: parsed.value ?? null,
    code: typeof parsed.code === "string" ? parsed.code : null,
    message: typeof parsed.message === "string" ? parsed.message : undefined,
  });
}

function pageIsOnScreen(label: string): boolean {
  return presentedLabel() === label && browserViewport() !== null && !browserOccluded() && htmlPreview() === null;
}

function reportPageLoad(label: string, event: "started" | "finished" | "failed", facts: { url: string; title?: string; error?: string }): void {
  void invokeCommand<null>("browser_webview_report_page_load", {
    label,
    event,
    url: facts.url,
    title: facts.title ?? null,
    error: facts.error ?? null,
  }).catch(error => {
    // An older backend without the command keeps the page usable for the
    // user; only its agent tools lose the load signal.
    console.warn(`Failed to report a browser page load for ${label}`, error);
  });
}

/** The events of one page's web view. */
export function browserPageEvents(label: string): BrowserPageEvents {
  return {
    loadStart: facts => {
      abortEvaluations(label, "the page navigated before the script answered");
      updatePage(label, { url: facts.url || pageOf(label)?.url || "", loading: true, error: null });
      if (presentedLabel() === label && facts.url) browserAddress.set(facts.url);
      reportPageLoad(label, "started", { url: facts.url });
    },
    load: facts => {
      updatePage(label, {
        url: facts.url,
        title: facts.title,
        loading: false,
        canGoBack: facts.canGoBack,
        canGoForward: facts.canGoForward,
      });
      if (presentedLabel() === label && facts.url) browserAddress.set(facts.url);
      reportPageLoad(label, "finished", { url: facts.url, title: facts.title });
    },
    error: error => {
      const message = error.message || error.code || tr("browser.loadFailed");
      updatePage(label, { loading: false, error: message });
      reportPageLoad(label, "failed", { url: pageOf(label)?.url ?? "", error: message });
    },
    navigationState: facts => {
      updatePage(label, {
        url: facts.url || pageOf(label)?.url || "",
        title: facts.title,
        loading: facts.loading,
        canGoBack: facts.canGoBack,
        canGoForward: facts.canGoForward,
      });
      if (presentedLabel() === label && facts.url && !facts.loading) browserAddress.set(facts.url);
    },
    message: data => receivePageMessage(label, data),
  };
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? value : fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** The browser operations the backend asks this shell for. */
export const BROWSER_SHELL_OPERATIONS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  "browser.create": async args => {
    const label = requireLabel(args);
    const url = typeof args.url === "string" ? args.url : BROWSER_DEFAULT_URL;
    const conversationId = typeof args.conversationId === "string" && args.conversationId ? args.conversationId : null;
    touchBrowserPage(label);
    if (!pageOf(label)) {
      browserPages.set([
        ...browserPages(),
        {
          label,
          initialUrl: url,
          url,
          title: "",
          loading: true,
          canGoBack: false,
          canGoForward: false,
          error: null,
          conversationId,
          width: numberArg(args, "width", 1024),
          height: numberArg(args, "height", 768),
        },
      ]);
      evictIdleBrowserPages();
    }
    if (!presentedLabel() || !pageOf(presentedLabel() ?? "")) {
      presentedLabel.set(label);
      browserAddress.set(url);
    }
    return null;
  },
  "browser.navigate": async args => {
    const label = requireLabel(args);
    const url = typeof args.url === "string" ? args.url : "";
    if (!url) throw new Error("browser.navigate needs a url");
    touchBrowserPage(label);
    const handle = await waitForHandle(label);
    updatePage(label, { url, loading: true, error: null });
    handle.load({ src: url });
    return null;
  },
  "browser.reload": async args => {
    const label = requireLabel(args);
    touchBrowserPage(label);
    const handle = await waitForHandle(label);
    updatePage(label, { loading: true, error: null });
    handle.reload();
    return null;
  },
  "browser.inject": async args => {
    const label = requireLabel(args);
    const script = typeof args.script === "string" ? args.script : "";
    touchBrowserPage(label);
    (await waitForHandle(label)).injectJavaScript(script);
    return null;
  },
  "browser.evaluate": async args => {
    const label = requireLabel(args);
    const script = typeof args.script === "string" ? args.script : "";
    const timeout = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_SCRIPT_TIMEOUT_MS;
    touchBrowserPage(label);
    const handle = await waitForHandle(label);
    const reply = await evaluateInPage(label, handle, script, timeout);
    return reply.ok
      ? { ok: true, value: reply.value ?? null }
      : { ok: false, code: reply.code ?? null, message: reply.message ?? "JavaScript evaluation failed" };
  },
  "browser.input": async args => {
    const label = requireLabel(args);
    const input = args.input as BrowserInput | undefined;
    if (!input || typeof input !== "object") throw new Error("browser.input needs an input");
    touchBrowserPage(label);
    const trusted = viewDriver ? viewDriver.inputAvailable : webViewInputAvailable;
    // Trusted input lands where the page is on screen; a hidden page gets
    // the backend's DOM events instead.
    if (!trusted || !pageIsOnScreen(label)) return { delivered: false };
    (await waitForHandle(label)).sendInput(input);
    return { delivered: true };
  },
  "browser.state": async args => {
    const label = requireLabel(args);
    const page = pageOf(label);
    if (!page) return null;
    touchBrowserPage(label);
    return {
      url: page.url,
      title: page.title,
      loading: page.loading,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward,
      presented: pageIsOnScreen(label),
    };
  },
  "browser.setBounds": async args => {
    const label = requireLabel(args);
    if (!pageOf(label)) throw new Error(`Webview not found: ${label}`);
    touchBrowserPage(label);
    updatePage(label, { width: numberArg(args, "width", 1024), height: numberArg(args, "height", 768) });
    return null;
  },
  "browser.close": async args => {
    closeBrowserPageLocally(requireLabel(args));
    return null;
  },
};

function closeBrowserPageLocally(label: string): void {
  abortEvaluations(label, "the page was closed");
  browserPages.set(browserPages().filter(page => page.label !== label));
  handles.delete(label);
  pageLastActive.delete(label);
  if (presentedLabel() === label) presentedLabel.set(browserPages()[0]?.label ?? null);
}

// ── What the Browser scene does ──

function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return BROWSER_DEFAULT_URL;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) return value;
  return `https://${value}`;
}

function sceneError(error: unknown): string {
  const message = errorMessage(error);
  if (message.startsWith("unsupported_in_native_host")) return tr("browser.hostOutdated");
  return localizeHostError(message);
}

async function presentAsAgentTarget(label: string): Promise<void> {
  await invokeCommand<null>("browser_webview_set_agent_target_state", { label, active: true });
}

let creatingUserPage: Promise<void> | null = null;

/** Opens the user's own page once (the scene's first visit). */
export function ensureUserPage(): Promise<void> {
  if (browserAvailability() !== "available") return Promise.resolve();
  const existing = browserPages().find(page => !isAgentPage(page));
  if (existing) {
    if (!presentedLabel()) presentedLabel.set(existing.label);
    return Promise.resolve();
  }
  if (creatingUserPage) return creatingUserPage;
  // An agent's page already on show stays on show; the user's page waits in the menu.
  creatingUserPage = openUserPage(BROWSER_DEFAULT_URL, !presentedPage()).finally(() => {
    creatingUserPage = null;
  });
  return creatingUserPage;
}

async function openUserPage(url: string, present = true): Promise<void> {
  const label = `${USER_LABEL_PREFIX}${nextUserLabel++}`;
  const viewport = browserViewport();
  browserNotice.set(null);
  if (present) browserAddress.set(url);
  try {
    await invokeCommand<null>("browser_webview_create", {
      label,
      url,
      x: 0,
      y: 0,
      width: Math.max(2, Math.round(viewport?.width ?? 1024)),
      height: Math.max(2, Math.round(viewport?.height ?? 768)),
    });
    if (!present) return;
    presentedLabel.set(label);
    await presentAsAgentTarget(label);
  } catch (error) {
    browserNotice.set(sceneError(error));
  }
}

/**
 * A local HTML file typed into the address field: a `file:` URL or an
 * absolute path ending in `.html` / `.htm`. It previews through the
 * workspace's device instead of loading as a page.
 */
export function localHtmlPath(raw: string): string | null {
  const value = raw.trim();
  let path = value;
  if (/^file:\/\//i.test(value)) {
    path = value.replace(/^file:\/\/(localhost)?/i, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the undecoded text: a path with a stray `%` is still a path.
    }
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  } else if (!(value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))) {
    return null;
  }
  return /\.html?$/i.test(path) ? path : null;
}

/** The address field's submit. */
export async function loadBrowserUrl(raw: string): Promise<void> {
  const local = localHtmlPath(raw);
  if (local && sessionHooks) {
    browserNotice.set(null);
    await sessionHooks.previewLocalHtml(local);
    return;
  }
  const url = normalizeUrl(raw);
  browserAddress.set(url);
  browserNotice.set(null);
  if (!/^https?:/i.test(url)) {
    browserNotice.set(tr("browser.unsupportedScheme"));
    return;
  }
  const page = presentedPage();
  if (!page) {
    await openUserPage(url);
    return;
  }
  try {
    updatePage(page.label, { loading: true, error: null });
    await invokeCommand<null>("browser_webview_navigate", { label: page.label, url });
  } catch (error) {
    updatePage(page.label, { loading: false });
    browserNotice.set(sceneError(error));
  }
}

async function runOnPresented(command: string, request: (label: string) => Record<string, unknown>): Promise<void> {
  const page = presentedPage();
  if (!page) return;
  browserNotice.set(null);
  try {
    await invokeCommand<null>(command, request(page.label));
  } catch (error) {
    browserNotice.set(sceneError(error));
  }
}

export function reloadBrowserPage(): Promise<void> {
  return runOnPresented("browser_webview_reload", label => ({ label }));
}

export function browserGoBack(): Promise<void> {
  return runOnPresented("browser_webview_eval", label => ({ label, script: "history.back()" }));
}

export function browserGoForward(): Promise<void> {
  return runOnPresented("browser_webview_eval", label => ({ label, script: "history.forward()" }));
}

export async function stopBrowserLoading(): Promise<void> {
  const page = presentedPage();
  await runOnPresented("browser_webview_eval", label => ({ label, script: "window.stop()" }));
  if (page) updatePage(page.label, { loading: false });
}

/** Shows another page (an agent's) in the scene and makes it the agent's target. */
export async function presentBrowserPage(label: string): Promise<void> {
  const page = pageOf(label);
  if (!page) return;
  touchBrowserPage(label);
  presentedLabel.set(label);
  browserAddress.set(page.url);
  browserNotice.set(null);
  evictIdleBrowserPages();
  try {
    await presentAsAgentTarget(label);
  } catch (error) {
    browserNotice.set(sceneError(error));
  }
}

/** Closes an agent's page here; the backend drops it from discovery. */
export function closeBrowserPage(label: string): void {
  closeBrowserPageLocally(label);
  const next = presentedPage();
  browserAddress.set(next?.url ?? "");
}

export async function openPresentedPageExternally(): Promise<void> {
  const url = presentedPage()?.url || browserAddress();
  if (!/^https?:/i.test(url)) return;
  try {
    await openUrl(url);
  } catch (error) {
    browserNotice.set(sceneError(error));
  }
}

let eventsStarted = false;

/** Follows the backend's agent-browser events; idempotent. */
export function startBrowserEvents(): void {
  if (eventsStarted) return;
  eventsStarted = true;
  void probeBrowserAvailability();
  listenEvent<{ targetId?: string; sessionId?: string | null }>("agentic://open-built-in-browser", payload => {
    const targetId = payload?.targetId;
    // The agent's page is what the user wants to see next in the browser.
    if (isBrowserLabel(targetId) && pageOf(targetId)) {
      presentedLabel.set(targetId);
      browserAddress.set(pageOf(targetId)?.url ?? "");
      htmlPreview.set(null);
      // A page the open session's agent opened presents beside it (spec §4.2).
      sessionHooks?.agentPageOpened(payload?.sessionId ?? null);
    }
  });
}

// ── Element picker (desktop) ──
//
// The picker runs in the presented page through the same result channel as
// `browser.evaluate`: the script highlights what is under the pointer and
// settles with the clicked element (or `null` on Escape). The reference goes
// into the composer as text the agent can read; nothing is sent.

const PICKER_TIMEOUT_MS = 120_000;
const PICKER_KEY = "__openbitfunPicker";

/** The page the picker is running in. */
export const browserPicking = signal<string | null>(null);

/** What the picker reports of the clicked element. */
export interface PickedElement {
  tagName: string;
  path: string;
  text: string;
  url: string;
}

/** The picker script; its value is a {@link PickedElement} or `null`. */
export function elementPickerScript(border: string, fill: string): string {
  return `new Promise(resolve => {
  const KEY = ${JSON.stringify(PICKER_KEY)};
  if (window[KEY]) window[KEY](null);
  const box = document.createElement('div');
  box.setAttribute('data-openbitfun-picker', '');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border-radius:2px;display:none;border:2px solid ' + ${JSON.stringify(border)} + ';background:' + ${JSON.stringify(fill)};
  document.documentElement.appendChild(box);
  const cssPath = el => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + (window.CSS && CSS.escape ? CSS.escape(node.id) : node.id)); break; }
      const same = node.parentElement ? Array.from(node.parentElement.children).filter(child => child.tagName === node.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      parts.unshift(part);
    }
    return parts.join(' > ') || 'html';
  };
  const show = el => {
    if (!el || el === box) { box.style.display = 'none'; return; }
    const rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px'; box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px'; box.style.height = rect.height + 'px';
  };
  const over = event => show(event.target);
  const stop = event => { event.preventDefault(); event.stopPropagation(); };
  const click = event => {
    stop(event);
    const el = event.target;
    finish(el && el.nodeType === 1 ? {
      tagName: el.tagName.toLowerCase(),
      path: cssPath(el),
      text: String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      url: location.href,
    } : null);
  };
  const key = event => { if (event.key === 'Escape') { stop(event); finish(null); } };
  const finish = value => {
    document.removeEventListener('mouseover', over, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('mousedown', stop, true);
    document.removeEventListener('mouseup', stop, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
    delete window[KEY];
    resolve(value);
  };
  window[KEY] = finish;
  document.addEventListener('mouseover', over, true);
  document.addEventListener('click', click, true);
  document.addEventListener('mousedown', stop, true);
  document.addEventListener('mouseup', stop, true);
  document.addEventListener('keydown', key, true);
})`;
}

const CANCEL_PICKER_SCRIPT = `window[${JSON.stringify(PICKER_KEY)}] && window[${JSON.stringify(PICKER_KEY)}](null);`;

function readPicked(value: unknown): PickedElement | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string, limit: number) => (typeof raw[key] === "string" ? (raw[key] as string).slice(0, limit) : "");
  const path = text("path", 400);
  if (!path) return null;
  return { tagName: text("tagName", 40), path, text: text("text", 120), url: text("url", 2048) };
}

/** The composer text for a picked element: `#element` with its path, page and text. */
export function elementReference(element: PickedElement): string {
  const label = element.text ? ` “${element.text}”` : "";
  return `#element \`${element.path}\`${label} (${element.url})`;
}

/** Starts the picker on the presented page; a second call cancels it. */
export async function startElementPicker(): Promise<void> {
  const page = presentedPage();
  if (!page) return;
  if (browserPicking()) {
    cancelElementPicker();
    return;
  }
  const label = page.label;
  browserNotice.set(null);
  let handle: BrowserViewHandle;
  try {
    handle = await waitForHandle(label);
  } catch (error) {
    browserNotice.set(sceneError(error));
    return;
  }
  browserPicking.set(label);
  const script = elementPickerScript(palette().accent, palette().accentSoft);
  const reply = await evaluateInPage(label, handle, script, PICKER_TIMEOUT_MS);
  if (browserPicking() === label) browserPicking.set(null);
  if (!reply.ok) {
    // A navigation or a cancel ends the picker without a word; a page that
    // refused the script says so.
    if (reply.code === "ERR_NSH_WEBVIEW_SCRIPT") browserNotice.set(tr("browser.pickFailed"));
    return;
  }
  const picked = readPicked(reply.value);
  if (picked) sessionHooks?.insertIntoComposer(elementReference(picked));
}

/** Ends a running picker without a pick. */
export function cancelElementPicker(): void {
  const label = browserPicking();
  if (!label) return;
  browserPicking.set(null);
  handles.get(label)?.injectJavaScript(CANCEL_PICKER_SCRIPT);
}

// ── HTML preview ──
//
// A workspace's HTML file, read through the workspace's device
// (`read_file_content` routes remote workspaces) and shown in a web view of
// its own over the browser's viewport. It runs the file's scripts in a web
// view kept apart from the app's pages. NSH grants a web view no `file:`
// base, so relative assets do not load; the user can open the file in the
// device's default browser where that device is this desktop.

export interface HtmlPreview {
  path: string;
  name: string;
  html: string;
  /** The file is on this desktop, so its default browser can open it. */
  onThisDesktop: boolean;
  workspaceId: string | null;
  deviceId: string | null;
}

export const htmlPreview = signal<HtmlPreview | null>(null);
export const htmlPreviewNotice = signal<string | null>(null);
/** Larger files are not loaded into a preview. */
export const HTML_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export function closeHtmlPreview(): void {
  htmlPreview.set(null);
  htmlPreviewNotice.set(null);
}

/** Whether the preview's file can open in this desktop's default browser. */
export function htmlPreviewOpensHere(preview: HtmlPreview | null): boolean {
  return preview?.onThisDesktop === true;
}

/** Opens the previewed file in the default browser of the desktop it is on. */
export async function openHtmlPreviewInDefaultBrowser(): Promise<void> {
  const preview = htmlPreview();
  if (!preview) return;
  try {
    await invokeCommand<null>("open_html_file_in_browser", { path: preview.path });
  } catch (error) {
    htmlPreviewNotice.set(sceneError(error));
  }
}

// ── Live view (phone, browser, another desktop) ──
//
// The desktop that holds a page answers `browser_webview_capture_preview`
// with a script-free copy of it; this client draws the copy as a still frame
// and asks again about every 2 s while the view is on screen and the app is
// in the foreground. It never forwards input: the frame is not the page.

export type BrowserLiveView =
  | { status: "loading" }
  | {
      status: "snapshot";
      label: string;
      url: string;
      title: string;
      html: string;
      viewportWidth: number;
      viewportHeight: number;
      capturedAtMs: number;
    }
  | { status: "ready"; dataUrl: string; url: string }
  | { status: "tooLarge"; url: string; title: string }
  | { status: "noPage" }
  | { status: "unsupported"; reason: string }
  | { status: "outdated" }
  | { status: "failed"; message: string };

export const LIVE_VIEW_INTERVAL_MS = 2_000;
const CAPTURE_COMMAND = "browser_webview_capture_preview";

export const browserLiveView = signal<BrowserLiveView>({ status: "loading" });

export interface LiveViewSource {
  deviceId: string | null;
  conversationId: string | null;
}

function readLiveView(value: unknown): BrowserLiveView {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const number = (key: string) => (typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : 0);
  switch (raw.status) {
    case "snapshot":
      return {
        status: "snapshot",
        label: text("label"),
        url: text("url"),
        title: text("title"),
        html: text("html"),
        viewportWidth: number("viewportWidth"),
        viewportHeight: number("viewportHeight"),
        capturedAtMs: number("capturedAtMs"),
      };
    case "ready":
      return { status: "ready", dataUrl: text("dataUrl"), url: text("url") };
    case "tooLarge":
      return { status: "tooLarge", url: text("url"), title: text("title") };
    case "noPage":
      return { status: "noPage" };
    case "unsupported":
      return { status: "unsupported", reason: text("reason") };
    default:
      // A status this build does not know comes from a newer device.
      return { status: "outdated" };
  }
}

/** An older device: no command, or the label-only request shape. */
function liveViewOutdated(error: unknown): boolean {
  const message = errorMessage(error);
  return isCommandUnavailable(error, CAPTURE_COMMAND) || /missing field `label`/.test(message);
}

const LIVE_VIEW_MAX_BACKOFF_MS = 8_000;

function sameLiveView(a: BrowserLiveView, b: BrowserLiveView): boolean {
  if (a.status !== b.status) return false;
  switch (a.status) {
    case "snapshot":
      return (
        b.status === "snapshot" &&
        a.label === b.label &&
        a.url === b.url &&
        a.title === b.title &&
        a.html === b.html &&
        a.viewportWidth === b.viewportWidth &&
        a.viewportHeight === b.viewportHeight
      );
    case "ready":
      return b.status === "ready" && a.dataUrl === b.dataUrl && a.url === b.url;
    case "tooLarge":
      return b.status === "tooLarge" && a.url === b.url && a.title === b.title;
    case "unsupported":
      return b.status === "unsupported" && a.reason === b.reason;
    case "failed":
      return b.status === "failed" && a.message === b.message;
    case "loading":
    case "noPage":
    case "outdated":
      return true;
  }
}

function isTerminalLiveViewStatus(view: BrowserLiveView): boolean {
  return view.status === "outdated" || view.status === "unsupported";
}

/**
 * Polls the live view of `source()` until the returned function is called.
 * Skips reads while the app is in the background, avoids rewriting the signal
 * (and reloading the WebView) when the snapshot is unchanged, backs off on
 * consecutive unchanged reads, and stops polling on terminal `outdated` or
 * `unsupported` responses.
 */
export function startBrowserLiveView(source: () => LiveViewSource): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  let unchangedStreak = 0;
  browserLiveView.set({ status: "loading" });
  const tick = async () => {
    timer = null;
    if (stopped) return;
    const { deviceId, conversationId } = source();
    const key = `${deviceId ?? ""}/${conversationId ?? ""}`;
    if (key !== lastKey) {
      lastKey = key;
      unchangedStreak = 0;
      browserLiveView.set({ status: "loading" });
    }
    let terminal = false;
    if (lifecycle() !== "background") {
      try {
        const reply = await invokeCommand<unknown>(
          CAPTURE_COMMAND,
          conversationId ? { conversationId } : {},
          deviceId ? { target: deviceId } : undefined,
        );
        if (!stopped && key === lastKey) {
          const next = readLiveView(reply);
          terminal = isTerminalLiveViewStatus(next);
          if (sameLiveView(browserLiveView(), next)) {
            unchangedStreak += 1;
          } else {
            unchangedStreak = 0;
            browserLiveView.set(next);
          }
        }
      } catch (error) {
        if (!stopped && key === lastKey) {
          const next: BrowserLiveView = liveViewOutdated(error)
            ? { status: "outdated" }
            : { status: "failed", message: localizeHostError(errorMessage(error)) };
          terminal = isTerminalLiveViewStatus(next);
          unchangedStreak = 0;
          if (!sameLiveView(browserLiveView(), next)) {
            browserLiveView.set(next);
          }
        }
      }
    }
    if (!stopped && !terminal) {
      // Keep the first follow-up prompt (2 s), then back off while the page is static.
      const delay =
        unchangedStreak >= 2
          ? Math.min(LIVE_VIEW_MAX_BACKOFF_MS, LIVE_VIEW_INTERVAL_MS * unchangedStreak)
          : LIVE_VIEW_INTERVAL_MS;
      timer = setTimeout(() => void tick(), delay);
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

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

import { computed, openUrl, signal, WebView } from "nsh";
import { invokeCommand, listenEvent, windowShellId } from "./bridge";
import { localizeHostError, tr } from "./i18n";

export const BROWSER_DEFAULT_URL = "https://openbitfun.com/";
const USER_LABEL_PREFIX = "embedded-browser-view-";
const AGENT_LABEL_PREFIX = "embedded-browser-panel-view-";
const HANDLE_WAIT_MS = 8_000;
const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

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
  return presentedLabel() === label && browserViewport() !== null && !browserOccluded();
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
    const handle = await waitForHandle(label);
    updatePage(label, { url, loading: true, error: null });
    handle.load({ src: url });
    return null;
  },
  "browser.reload": async args => {
    const label = requireLabel(args);
    const handle = await waitForHandle(label);
    updatePage(label, { loading: true, error: null });
    handle.reload();
    return null;
  },
  "browser.inject": async args => {
    const label = requireLabel(args);
    const script = typeof args.script === "string" ? args.script : "";
    (await waitForHandle(label)).injectJavaScript(script);
    return null;
  },
  "browser.evaluate": async args => {
    const label = requireLabel(args);
    const script = typeof args.script === "string" ? args.script : "";
    const timeout = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_SCRIPT_TIMEOUT_MS;
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

/** The address field's submit. */
export async function loadBrowserUrl(raw: string): Promise<void> {
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
  presentedLabel.set(label);
  browserAddress.set(page.url);
  browserNotice.set(null);
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
  listenEvent<{ targetId?: string }>("agentic://open-built-in-browser", payload => {
    const targetId = payload?.targetId;
    // The agent's page is what the user wants to see next in the browser.
    if (isBrowserLabel(targetId) && pageOf(targetId)) {
      presentedLabel.set(targetId);
      browserAddress.set(pageOf(targetId)?.url ?? "");
    }
  });
}

// The user's own Chrome or Edge, which agents drive over the DevTools
// protocol (`browser_control_*`, `api/browser_control_api.rs`).
//
// The backend owns every fact: whether the browser is running with remote
// debugging, whether OpenBitFun holds its approval, which browser it is and
// how many tabs it has, and what a connect attempt needs next (the browser's
// own consent page, a restart). This store keeps the last answers and the
// one action in flight; the settings row draws them. It runs against the
// device Settings' scope chip names, since the browser is on that machine.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import { localizeHostError, tr } from "./i18n";

/** `browser_control_get_status`, as the host answers it. */
export interface ExternalBrowserStatus {
  cdpAvailable: boolean;
  defaultCdpSupported: boolean;
  defaultCdpEnabled: boolean;
  setupUrl: string | null;
  browserReady: boolean;
  browserKind: string;
  browserVersion: string | null;
  pageCount: number;
}

/** What the last connect attempt said, when it needs the user. */
export type ExternalBrowserOutcome =
  | { kind: "connected"; browser: string }
  | { kind: "disconnected"; browser: string }
  | { kind: "setup"; browser: string; setupUrl: string }
  | { kind: "restart"; browser: string }
  | { kind: "message"; text: string }
  | { kind: "failed"; text: string };

export type ExternalBrowserAction = "connect" | "disconnect" | "restart" | null;

/** The CDP slot the desktop has always used. Setup can wait minutes on the browser's consent page. */
const CDP_PORT = 9222;

export const externalBrowserStatus = signal<ExternalBrowserStatus | null>(null);
export const externalBrowserLoading = signal(false);
/** The host has no browser control (a CLI device, an older desktop). */
export const externalBrowserUnsupported = signal(false);
export const externalBrowserError = signal<string | null>(null);
export const externalBrowserAction = signal<ExternalBrowserAction>(null);
export const externalBrowserOutcome = signal<ExternalBrowserOutcome | null>(null);

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return typeof error === "string" ? error : JSON.stringify(error);
}

function readStatus(value: unknown): ExternalBrowserStatus {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    cdpAvailable: raw.cdpAvailable === true,
    defaultCdpSupported: raw.defaultCdpSupported === true,
    defaultCdpEnabled: raw.defaultCdpEnabled === true,
    setupUrl: typeof raw.setupUrl === "string" && raw.setupUrl ? raw.setupUrl : null,
    browserReady: raw.browserReady === true,
    browserKind: typeof raw.browserKind === "string" ? raw.browserKind : "",
    browserVersion: typeof raw.browserVersion === "string" ? raw.browserVersion : null,
    pageCount: typeof raw.pageCount === "number" && Number.isFinite(raw.pageCount) ? raw.pageCount : 0,
  };
}

/**
 * Reads the browser's state on the device in context (Settings' scope chip;
 * the bridge addresses every command there).
 */
export async function refreshExternalBrowser(): Promise<void> {
  externalBrowserLoading.set(true);
  externalBrowserError.set(null);
  try {
    const status = await invokeCommand<unknown>("browser_control_get_status", { port: CDP_PORT });
    externalBrowserStatus.set(readStatus(status));
    externalBrowserUnsupported.set(false);
  } catch (error) {
    externalBrowserStatus.set(null);
    if (isCommandUnavailable(error, "browser_control_get_status")) {
      externalBrowserUnsupported.set(true);
    } else {
      externalBrowserError.set(localizeHostError(errorText(error)));
    }
  } finally {
    externalBrowserLoading.set(false);
  }
}

interface LaunchResponse {
  success?: boolean;
  status?: string;
  message?: string | null;
  browserKind?: string;
  setupUrl?: string | null;
}

/** Turns a connect answer into what the row shows next. */
function outcomeOf(result: LaunchResponse): ExternalBrowserOutcome | null {
  const browser = result.browserKind || externalBrowserStatus()?.browserKind || "";
  if (result.success) return { kind: "connected", browser };
  const setupUrl = result.setupUrl || externalBrowserStatus()?.setupUrl || "";
  switch (result.status) {
    case "requires_user_profile_setup":
    case "requires_manual_user_profile_setup":
      return { kind: "setup", browser, setupUrl };
    case "needs_restart":
      return { kind: "restart", browser };
    default:
      return result.message ? { kind: "message", text: result.message } : null;
  }
}

async function run(action: Exclude<ExternalBrowserAction, null>, command: string): Promise<void> {
  if (externalBrowserAction()) return;
  externalBrowserAction.set(action);
  externalBrowserOutcome.set(null);
  try {
    const result = await invokeCommand<LaunchResponse>(command, { port: CDP_PORT });
    externalBrowserOutcome.set(
      action === "disconnect"
        ? { kind: "disconnected", browser: result?.browserKind || externalBrowserStatus()?.browserKind || "" }
        : outcomeOf(result ?? {}),
    );
  } catch (error) {
    console.warn(`${command} failed`, error);
    externalBrowserOutcome.set({ kind: "failed", text: localizeHostError(errorText(error)) });
  } finally {
    externalBrowserAction.set(null);
  }
  await refreshExternalBrowser();
}

/**
 * Connects to the user's browser. A browser that keeps remote debugging as
 * its own setting (Chrome, Edge) is asked through its consent page; others
 * are launched with a debugging port. The host decides which applies.
 */
export function connectExternalBrowser(): Promise<void> {
  const status = externalBrowserStatus();
  return run("connect", status?.defaultCdpSupported ? "browser_control_enable_default_cdp" : "browser_control_launch");
}

export function disconnectExternalBrowser(): Promise<void> {
  return run("disconnect", "browser_control_disconnect");
}

/** Restarts the browser with remote debugging, after the user agreed. */
export function restartExternalBrowser(): Promise<void> {
  return run("restart", "browser_control_restart_with_cdp");
}

export function dismissExternalBrowserOutcome(): void {
  externalBrowserOutcome.set(null);
}

/** The row's state word. */
export function externalBrowserStateText(status: ExternalBrowserStatus | null): string {
  if (!status) return "";
  if (status.cdpAvailable) return tr("browser.external.connected");
  if (status.browserReady) return tr("browser.external.ready");
  return tr("browser.external.notConnected");
}

// The web target's connection choice: a page served by an OpenBitFun backend
// (its `index.html` carries `#nsh-params` `{ obp: { url, path, protocol } }`,
// read here as `host.params.obp`) connects back to that backend over the
// backend protocol (`webSocketConnection.ts`) and draws in a browser tab
// (`browserShell.ts`). Every other start keeps what it has: the native desktop
// installed its in-process connection before the UI loaded, the Tauri webview
// and the development page use the page host (`host.js`, fixtures in a plain
// browser and in tests).
//
// `installServedBackend()` runs at the top of `App.tsx`, before anything
// reaches the backend.

import { host } from "nsh";
import { backendConnection, installBackendConnection, installWindowShell } from "./bridge";
import { createBrowserShell } from "./browserShell";
import {
  createWebSocketConnection,
  OBP_PROTOCOL_VERSION,
  type ObpSocketFactory,
  type WebSocketConnection,
} from "./webSocketConnection";

/** What a backend-served page is told about the protocol endpoint. */
export interface ServedBackendParams {
  /** Absolute `ws(s)://host/obp`, from the address the browser used. */
  url?: string | null;
  /** The endpoint path (`/obp`), resolved against the page when `url` is absent. */
  path?: string | null;
  protocol?: number | null;
}

/** The `obp` launch parameter, when the page was served by a backend. */
export function servedBackendParams(params: unknown = safeHostParams()): ServedBackendParams | null {
  if (!params || typeof params !== "object") return null;
  const obp = (params as Record<string, unknown>).obp;
  if (!obp || typeof obp !== "object") return null;
  const record = obp as Record<string, unknown>;
  const url = typeof record.url === "string" && record.url ? record.url : null;
  const path = typeof record.path === "string" && record.path ? record.path : null;
  if (!url && !path) return null;
  return { url, path, protocol: typeof record.protocol === "number" ? record.protocol : null };
}

function safeHostParams(): unknown {
  try {
    return host.params;
  } catch {
    return null;
  }
}

/** The page's own address, where the realm knows it. */
function pageBase(): string | null {
  const scope = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
  return scope.document?.baseURI ?? scope.location?.href ?? null;
}

/** `ws(s)://…/obp` for the parameters, or `null` when it cannot be resolved. */
export function endpointUrl(params: ServedBackendParams, base: string | null = pageBase()): string | null {
  if (params.url && /^wss?:\/\//i.test(params.url)) return params.url;
  if (!params.path || !base) return null;
  try {
    const resolved = new URL(params.path, base);
    if (resolved.protocol === "https:") resolved.protocol = "wss:";
    else if (resolved.protocol === "http:") resolved.protocol = "ws:";
    if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** `http(s)://…/obp/session` for an endpoint URL. */
function sessionUrl(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/session`;
    return url.href;
  } catch {
    return null;
  }
}

export interface InstallWebSocketBackendOptions {
  createSocket?: ObpSocketFactory;
  /** Install the browser-tab shell too (default true). */
  browserShell?: boolean;
}

/** Installs the backend-protocol connection to `url` (and the browser shell). */
export function installWebSocketBackend(
  url: string,
  options: InstallWebSocketBackendOptions = {},
): WebSocketConnection {
  const session = sessionUrl(url);
  const fetcher = (globalThis as { fetch?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<unknown> }> }).fetch;
  const connection = createWebSocketConnection({
    url,
    createSocket: options.createSocket,
    probeSession:
      session && typeof fetcher === "function"
        ? async () => {
            const response = await fetcher(session, { credentials: "same-origin", cache: "no-store" });
            if (!response.ok) return null;
            const value = (await response.json()) as { authorized?: unknown };
            return { authorized: value.authorized === true };
          }
        : undefined,
  });
  if (options.browserShell !== false) installWindowShell(createBrowserShell());
  installBackendConnection(connection);
  return connection;
}

/**
 * Picks the backend-protocol connection when this page was served by a
 * backend. A connection another entry installed first (native desktop, a test
 * fixture) is kept. Returns whether it installed one.
 */
export function installServedBackend(): boolean {
  const kind = backendConnection().kind;
  if (kind !== "dev" && kind !== "tauri") return false;
  const params = servedBackendParams();
  if (!params) return false;
  if (params.protocol !== null && params.protocol !== undefined && params.protocol !== OBP_PROTOCOL_VERSION) {
    console.warn(`The page names OBP version ${params.protocol}; this UI speaks ${OBP_PROTOCOL_VERSION}`);
  }
  const url = endpointUrl(params);
  if (!url) {
    // Never fall back to the page host's fixtures: say what is wrong instead.
    console.error("The backend-served page has no usable protocol address");
    installWebSocketBackend("ws://invalid/obp", {
      createSocket: () => {
        throw new Error("This page did not say where its backend listens; reload it from the backend address");
      },
    });
    return true;
  }
  installWebSocketBackend(url);
  return true;
}

// MCP App panels (wave 22 P5). An MCP tool can declare an interactive UI
// (`ui://…`): in its result, or in its metadata (`get_mcp_tool_ui_uri`). The
// session's device owns the server, so every call goes there: the UI resource
// comes from `fetch_mcp_app_resource`, and the page's JSON-RPC requests
// (`tools/call`, `resources/read`, `ping`) go through `send_mcp_app_message`.
// The panel is a pipe between the page and those commands; it adds no policy.

import { openUrl, signal } from "nsh";
import { fleetActive, invokeCommand, invokeRawCommand, type InvokeCommandOptions } from "./bridge";
import type { ToolCallView } from "./format";

export interface McpAppDescriptor {
  serverId: string;
  resourceUri: string;
  toolName: string;
  deviceId: string;
  /** The arguments the tool ran with and its result, handed to the page as the MCP Apps notifications. */
  input?: unknown;
  result?: unknown;
}

export interface McpAppDocument {
  html: string;
  /** The page asked to be this tall (`ui/notifications/size-changed`). */
  height?: number;
}

export const mcpAppOpen = signal<McpAppDescriptor | null>(null);
export const mcpAppDocument = signal<McpAppDocument | null>(null);
export const mcpAppError = signal("");
export const mcpAppLoading = signal(false);

const descriptorCache = new Map<string, Promise<McpAppDescriptor | null>>();

function route(deviceId: string): InvokeCommandOptions | undefined {
  return fleetActive() && deviceId ? { target: deviceId } : undefined;
}

/** The first `ui://` resource a tool result carries, as MCP Apps return it. */
export function uiResourceOfResult(result: unknown): string {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const content = record?.content;
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const resource = entry.resource as Record<string, unknown> | undefined;
    if (entry.type === "resource" && typeof resource?.uri === "string" && resource.uri.startsWith("ui://")) {
      return resource.uri;
    }
  }
  return "";
}

/**
 * Whether a finished MCP tool call has an app, asked once per tool name and
 * device: the server id comes from the tool registry (`get_tool_info`), the
 * resource from the result or the tool's metadata.
 */
export function mcpAppFor(call: ToolCallView, deviceId: string): Promise<McpAppDescriptor | null> {
  const fromResult = uiResourceOfResult(call.result);
  const key = `${deviceId}/${call.name}/${fromResult}`;
  const cached = descriptorCache.get(key);
  if (cached) return cached.then(found => (found ? { ...found, input: call.input, result: call.result } : null));
  const lookup = (async (): Promise<McpAppDescriptor | null> => {
    try {
      const info = await invokeCommand<{ dynamic_info?: { mcp?: { serverId?: string } } } | null>(
        "get_tool_info",
        { toolName: call.name },
        route(deviceId),
      );
      const serverId = info?.dynamic_info?.mcp?.serverId ?? "";
      if (!serverId) return null;
      const resourceUri =
        fromResult ||
        ((await invokeRawCommand<string | null>("get_mcp_tool_ui_uri", { toolName: call.name }, route(deviceId))) ?? "");
      if (!resourceUri) return null;
      return { serverId, resourceUri, toolName: call.name, deviceId };
    } catch {
      return null;
    }
  })();
  descriptorCache.set(key, lookup);
  return lookup.then(found => (found ? { ...found, input: call.input, result: call.result } : null));
}

function cleanDomains(domains: unknown): string {
  if (!Array.isArray(domains)) return "";
  return domains
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .replace(/[&<>"]/g, "");
}

/**
 * The page as the panel shows it: the server's HTML with its declared CSP and
 * the bridge shim. The page talks to its host with `window.parent.postMessage`;
 * in a web view the page is its own parent, so the shim forwards that call to
 * `window.nsh.postMessage` and the panel answers with `message` events.
 */
export function mcpAppHtml(raw: string, csp: Record<string, unknown> | undefined): string {
  const resources = cleanDomains(csp?.resourceDomains);
  const policy = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${resources}`,
    `style-src 'self' 'unsafe-inline' ${resources}`,
    `connect-src 'self' ${cleanDomains(csp?.connectDomains)}`,
    `img-src 'self' data: ${resources}`,
    `font-src 'self' ${resources}`,
    `media-src 'self' data: ${resources}`,
    `frame-src ${cleanDomains(csp?.frameDomains) || "'none'"}`,
    "object-src 'none'",
    `base-uri ${cleanDomains(csp?.baseUriDomains) || "'self'"}`,
  ].join("; ");
  const head = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head(\s[^>]*)?>/i.test(raw)) return raw.replace(/<head(\s[^>]*)?>/i, match => `${match}${head}`);
  if (/<html[\s>]/i.test(raw)) return raw.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${raw}</body></html>`;
}

/** Runs before the page's own scripts: routes its posts to the panel. */
export const MCP_APP_BRIDGE_SHIM = `(function(){
  if (window.__obfMcpBridge) return; window.__obfMcpBridge = true;
  var send = function (data) { try { window.nsh.postMessage(typeof data === "string" ? data : JSON.stringify(data)); } catch (e) {} };
  try { window.postMessage = function (data) { send(data); }; } catch (e) {}
  window.__obfMcpDeliver = function (data) { window.dispatchEvent(new MessageEvent("message", { data: data, source: window })); };
})();`;

/** The script that hands one JSON-RPC message to the page. */
export function deliverScript(message: unknown): string {
  return `window.__obfMcpDeliver && window.__obfMcpDeliver(${JSON.stringify(message)});true;`;
}

export async function openMcpApp(descriptor: McpAppDescriptor): Promise<void> {
  mcpAppOpen.set(descriptor);
  mcpAppDocument.set(null);
  mcpAppError.set("");
  mcpAppLoading.set(true);
  try {
    const answer = await invokeCommand<{ contents?: Array<Record<string, unknown>> }>(
      "fetch_mcp_app_resource",
      { serverId: descriptor.serverId, resourceUri: descriptor.resourceUri },
      route(descriptor.deviceId),
    );
    if (mcpAppOpen() !== descriptor) return;
    const contents = Array.isArray(answer?.contents) ? answer.contents : [];
    const entry = contents.find(item => item.uri === descriptor.resourceUri) ?? contents[0];
    const raw = typeof entry?.content === "string" ? entry.content : "";
    if (!raw) {
      mcpAppError.set("empty");
      return;
    }
    mcpAppDocument.set({ html: mcpAppHtml(raw, entry?.csp as Record<string, unknown> | undefined) });
  } catch (error) {
    if (mcpAppOpen() === descriptor) mcpAppError.set(error instanceof Error ? error.message : String(error ?? ""));
  } finally {
    if (mcpAppOpen() === descriptor) mcpAppLoading.set(false);
  }
}

export function closeMcpApp(): void {
  mcpAppOpen.set(null);
  mcpAppDocument.set(null);
  mcpAppError.set("");
}

const PROTOCOL_VERSION = "2025-06-18";

/**
 * Answers one message the page posted; `post` hands the reply (and the
 * notifications that follow `ui/initialize`) back to the page. `onMessage`
 * receives text the page asks to put in the conversation.
 */
export async function handleMcpAppMessage(
  raw: string,
  post: (message: unknown) => void,
  options: { onMessage: (text: string) => void; hostVersion: string },
): Promise<void> {
  const app = mcpAppOpen();
  if (!app) return;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const id = message.id;
  const params = (message.params ?? {}) as Record<string, unknown>;
  const reply = (body: Record<string, unknown>) => {
    if (id !== undefined) post({ jsonrpc: "2.0", id, ...body });
  };
  try {
    switch (message.method) {
      case "ui/initialize": {
        reply({
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "OpenBitFun", version: options.hostVersion },
            hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {}, message: { text: {} } },
            hostContext: { toolInfo: { tool: { name: app.toolName } }, displayMode: "inline" },
          },
        });
        post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: app.input ?? {} } });
        if (app.result !== undefined) {
          post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: app.result });
        }
        return;
      }
      case "tools/call":
      case "resources/read":
      case "ping": {
        const answer = await invokeCommand<unknown>(
          "send_mcp_app_message",
          { serverId: app.serverId, ...message },
          route(app.deviceId),
        );
        post(answer);
        return;
      }
      case "ui/notifications/size-changed": {
        const height = typeof params.height === "number" ? params.height : undefined;
        const document = mcpAppDocument();
        if (document && height && height > 0) mcpAppDocument.set({ ...document, height });
        return;
      }
      case "ui/notifications/initialized":
        return;
      case "ui/open-link": {
        const url = typeof params.url === "string" ? params.url : "";
        if (!/^https?:\/\//i.test(url)) {
          reply({ error: { code: -32602, message: "Missing or invalid url parameter" } });
          return;
        }
        await openUrl(url);
        reply({ result: {} });
        return;
      }
      case "ui/message": {
        const content = Array.isArray(params.content) ? params.content : [];
        const text = content
          .map(item => (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
            ? String((item as Record<string, unknown>).text)
            : ""))
          .filter(Boolean)
          .join("\n");
        if (text) options.onMessage(text);
        reply({ result: text ? {} : { isError: true } });
        return;
      }
      default:
        reply({ error: { code: -32601, message: `Method not found: ${message.method}` } });
    }
  } catch (error) {
    reply({ error: { code: -32000, message: error instanceof Error ? error.message : String(error ?? "") } });
  }
}

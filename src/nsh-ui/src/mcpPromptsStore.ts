// MCP prompts in the composer (wave 22 P5). Each running MCP server of the
// session's device may publish prompts (`list_mcp_prompts`); a typed `/` lists
// them beside the session commands, and choosing one asks the server for its
// messages (`get_mcp_prompt`) and puts their text in the composer to edit and
// send. The server owns the prompt and its arguments; this only asks and draws.

import { signal } from "nsh";
import { fleetActive, invokeCommand, type InvokeCommandOptions } from "./bridge";

export interface McpPromptArgument {
  name: string;
  title?: string;
  description?: string;
  required: boolean;
}

export interface McpPromptEntry {
  serverId: string;
  serverName: string;
  name: string;
  title?: string;
  description?: string;
  arguments: McpPromptArgument[];
}

export const mcpPrompts = signal<McpPromptEntry[]>([]);
/** The prompt whose arguments are being filled in. */
export const mcpPromptForm = signal<McpPromptEntry | null>(null);
export const mcpPromptValues = signal<Record<string, string>>({});
export const mcpPromptBusy = signal(false);
export const mcpPromptError = signal("");

let loadedFor: string | null = null;

function route(deviceId: string): InvokeCommandOptions | undefined {
  return fleetActive() && deviceId ? { target: deviceId } : undefined;
}

function readArguments(raw: unknown): McpPromptArgument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map(entry => ({
      name: String(entry.name ?? ""),
      ...(typeof entry.title === "string" ? { title: entry.title } : {}),
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      required: entry.required === true,
    }))
    .filter(entry => entry.name !== "");
}

/** The slug a prompt is typed as after `/`: lower case, spaces as dashes. */
export function mcpPromptSlug(entry: McpPromptEntry): string {
  return `${entry.serverId}:${entry.name}`.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Reads the prompts of the device's running MCP servers once per device; a
 * server that publishes none, or a host without the command, adds nothing.
 */
export async function loadMcpPrompts(deviceId: string, force = false): Promise<void> {
  if (!force && loadedFor === deviceId) return;
  loadedFor = deviceId;
  let servers: Array<Record<string, unknown>> = [];
  try {
    servers = (await invokeCommand<Array<Record<string, unknown>>>("get_mcp_servers", undefined, route(deviceId))) ?? [];
  } catch {
    if (loadedFor === deviceId) mcpPrompts.set([]);
    return;
  }
  const running = servers.filter(server => {
    const status = String(server.status ?? "").toLowerCase();
    // The host reports its `MCPServerStatus` word; only a live server answers prompts.
    return server.enabled !== false && (status === "connected" || status === "healthy" || status === "running");
  });
  const rows: McpPromptEntry[] = [];
  for (const server of running) {
    const serverId = String(server.id ?? "");
    if (!serverId) continue;
    try {
      const prompts = await invokeCommand<unknown[]>("list_mcp_prompts", { serverId }, route(deviceId));
      for (const prompt of Array.isArray(prompts) ? prompts : []) {
        if (!prompt || typeof prompt !== "object") continue;
        const value = prompt as Record<string, unknown>;
        const name = typeof value.name === "string" ? value.name : "";
        if (!name) continue;
        rows.push({
          serverId,
          serverName: String(server.name ?? serverId),
          name,
          ...(typeof value.title === "string" ? { title: value.title } : {}),
          ...(typeof value.description === "string" ? { description: value.description } : {}),
          arguments: readArguments(value.arguments),
        });
      }
    } catch {
      // A server without prompts support answers with an error; it simply offers none.
    }
  }
  if (loadedFor === deviceId) mcpPrompts.set(rows);
}

/** The prompts a `/query` token matches (by server, name or title). */
export function mcpPromptsFor(text: string): McpPromptEntry[] {
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return mcpPrompts().filter(entry =>
    !query ||
    mcpPromptSlug(entry).includes(query) ||
    entry.name.toLowerCase().includes(query) ||
    (entry.title ?? "").toLowerCase().includes(query),
  );
}

/** The text a prompt's messages carry, joined in order; non-text blocks become their links. */
export function promptMessagesText(raw: unknown): string {
  const messages = raw && typeof raw === "object" ? (raw as Record<string, unknown>).messages : null;
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (!content || typeof content !== "object") continue;
    const block = content as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "resource_link" && typeof block.uri === "string") parts.push(block.uri);
    else if (block.type === "resource") {
      const resource = block.resource as Record<string, unknown> | undefined;
      if (typeof resource?.text === "string") parts.push(resource.text);
      else if (typeof resource?.uri === "string") parts.push(resource.uri);
    }
  }
  return parts.join("\n\n").trim();
}

/** Asks the server for the prompt's messages with `values` as its arguments. */
export async function fetchMcpPromptText(
  entry: McpPromptEntry,
  deviceId: string,
  values: Record<string, string> = {},
): Promise<string> {
  const args = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ""));
  const answer = await invokeCommand<unknown>(
    "get_mcp_prompt",
    {
      serverId: entry.serverId,
      promptName: entry.name,
      ...(Object.keys(args).length > 0 ? { arguments: args } : {}),
    },
    route(deviceId),
  );
  return promptMessagesText(answer);
}

export function openMcpPromptForm(entry: McpPromptEntry): void {
  mcpPromptValues.set({});
  mcpPromptError.set("");
  mcpPromptForm.set(entry);
}

export function closeMcpPromptForm(): void {
  mcpPromptForm.set(null);
  mcpPromptBusy.set(false);
}

/** Test seam. */
export function resetMcpPrompts(): void {
  loadedFor = null;
  mcpPrompts.set([]);
  mcpPromptForm.set(null);
}

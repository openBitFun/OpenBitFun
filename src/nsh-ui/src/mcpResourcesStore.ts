import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { runStep } from "./state";

/**
 * What one MCP server publishes. The runtime that holds the server answers
 * `list_mcp_resources`, and `read_mcp_resource` returns the contents of one URI,
 * so this surface never decides what a server offers — it asks and draws the
 * answer, including the entries a server cannot read back as text.
 */
export interface McpResourceRow {
  uri: string;
  name: string;
  /** Its position in the list the server answered; a stable handle for this surface. */
  slot: number;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface McpResourceSelection {
  uri: string;
  name: string;
  mimeType?: string;
}

export const mcpResourcesServer = signal<string | null>(null);
export const mcpResourcesRows = signal<McpResourceRow[]>([]);
export const mcpResourcesBusy = signal(false);
export const mcpResourcesLoaded = signal(false);
export const mcpResourcesNotice = signal("");
export const mcpResourceQuery = signal("");
export const mcpResourceSelected = signal<McpResourceSelection | null>(null);
export const mcpResourceContent = signal<string>("");
export const mcpResourceContentBusy = signal(false);

function readRows(raw: unknown): McpResourceRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => ({
      uri: String(entry.uri ?? ""),
      name: String(entry.name ?? entry.title ?? entry.uri ?? ""),
      slot: index,
      ...(entry.title ? { title: String(entry.title) } : {}),
      ...(entry.description ? { description: String(entry.description) } : {}),
      ...(entry.mimeType ? { mimeType: String(entry.mimeType) } : {}),
      ...(typeof entry.size === "number" ? { size: entry.size } : {}),
    }))
    .filter(row => row.uri !== "");
}

/** The rows a query narrows to, matched the way the desktop's browser matches. */
export function mcpResourceVisibleRows(): McpResourceRow[] {
  const rows = mcpResourcesRows();
  const query = mcpResourceQuery().trim().toLowerCase();
  if (!query) return rows;
  return rows.filter(
    row =>
      row.name.toLowerCase().includes(query) ||
      row.uri.toLowerCase().includes(query) ||
      (row.description ?? "").toLowerCase().includes(query),
  );
}

export async function openMcpResources(serverId: string): Promise<void> {
  mcpResourcesServer.set(serverId);
  mcpResourcesRows.set([]);
  mcpResourcesLoaded.set(false);
  mcpResourcesNotice.set("");
  mcpResourceQuery.set("");
  mcpResourceSelected.set(null);
  mcpResourceContent.set("");
  await loadMcpResources();
}

export function closeMcpResources(): void {
  mcpResourcesServer.set(null);
  mcpResourcesRows.set([]);
  mcpResourcesLoaded.set(false);
  mcpResourcesNotice.set("");
  mcpResourceQuery.set("");
  mcpResourceSelected.set(null);
  mcpResourceContent.set("");
}

export function setMcpResourceQuery(text: string): void {
  mcpResourceQuery.set(text);
}

/**
 * A refresh asks the server again rather than reusing a cached list, because the
 * reason to press it is that the server changed what it publishes.
 */
export async function loadMcpResources(): Promise<void> {
  const serverId = mcpResourcesServer();
  if (!serverId) return;
  mcpResourcesBusy.set(true);
  try {
    await runStep(async () => {
      try {
        const raw = await invokeCommand<unknown>("list_mcp_resources", {
          serverId,
          refresh: mcpResourcesLoaded(),
        });
        mcpResourcesRows.set(readRows(raw));
        mcpResourcesLoaded.set(true);
        mcpResourcesNotice.set("");
      } catch (error) {
        mcpResourcesRows.set([]);
        mcpResourcesLoaded.set(true);
        mcpResourcesNotice.set(error instanceof Error ? error.message : String(error));
      }
    });
  } finally {
    mcpResourcesBusy.set(false);
  }
}

/**
 * Reading one resource renders what the runtime answers. A resource that comes
 * back as a blob is reported as binary instead of being decoded into noise, and a
 * read that fails keeps the row selected so the message has a subject.
 */
export async function openMcpResource(row: McpResourceRow): Promise<void> {
  const serverId = mcpResourcesServer();
  if (!serverId) return;
  mcpResourceSelected.set({ uri: row.uri, name: row.title ?? row.name, ...(row.mimeType ? { mimeType: row.mimeType } : {}) });
  mcpResourceContent.set("");
  mcpResourceContentBusy.set(true);
  try {
    await runStep(async () => {
      try {
        const answer = await invokeCommand<{ contents?: unknown }>("read_mcp_resource", {
          serverId,
          resourceUri: row.uri,
        });
        mcpResourceContent.set(renderContents(answer?.contents));
      } catch (error) {
        mcpResourceContent.set(`Could not read this resource: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } finally {
    mcpResourceContentBusy.set(false);
  }
}

function renderContents(contents: unknown): string {
  if (!Array.isArray(contents) || contents.length === 0) return "The server returned no content for this resource.";
  const blocks = contents
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => {
      const uri = String(entry.uri ?? "");
      const mimeType = entry.mimeType ? String(entry.mimeType) : "";
      // One block prints its own media type; several name themselves first, the
      // way the desktop's browser separates them.
      const header =
        contents.length > 1
          ? `#${index + 1} ${uri}${mimeType ? ` (${mimeType})` : ""}`
          : mimeType
            ? `[${mimeType}]`
            : "";
      const body =
        typeof entry.content === "string" && entry.content !== ""
          ? entry.content
          : entry.blob
            ? "Binary content: this resource is not text, so it is not shown here."
            : "The server returned an entry with no content.";
      return header ? `${header}\n\n${body}` : body;
    });
  return blocks.length ? blocks.join("\n\n---\n\n") : "The server returned no content for this resource.";
}

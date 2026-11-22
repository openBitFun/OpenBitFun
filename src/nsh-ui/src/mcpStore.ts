// MCP servers: what the host reports about each one, and the user-level JSON
// document that configures them. The runtime facts come from `get_mcp_servers`;
// every configuration write goes through `load_mcp_json_config` /
// `save_mcp_json_config` with the fingerprint of the document that was read, so a
// change another surface made in between is refused instead of overwritten.
//
// An entry this form cannot represent faithfully (an argument list that is not
// strings, an environment that is not a string map, a transport alias this surface
// does not draw) is not guessed at: the row points at the JSON editor, which is the
// one place a whole document can be edited without losing fields.

import { Clipboard, lifecycle as appLifecycle, openUrl, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";

export type McpTransport = "stdio" | "streamable-http" | "sse";

/** One server as the host reports it, before its status settles. */
export interface McpServerRow {
  id: string;
  name: string;
  status: string;
  statusMessage?: string;
  transport: string;
  enabled: boolean;
  autoStart: boolean;
  url?: string;
  command?: string;
  commandAvailable?: boolean;
  authConfigured?: boolean;
  oauthEnabled?: boolean;
  startSupported: boolean;
  startDisabledReason?: string;
}

export interface McpKeyValue {
  key: string;
  value: string;
}

export interface McpDraft {
  /** Set when the draft edits an entry that already exists. */
  originalId?: string;
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  /** One argument per line. */
  args: string;
  /** `KEY=VALUE` per line. */
  env: string;
  workingDirectory: string;
  url: string;
  /** `KEY=VALUE` per line. */
  headers: string;
  enabled: boolean;
  autoStart: boolean;
  startupSeconds: string;
}

type McpEntry = Record<string, unknown>;

interface McpDocument {
  /** The document as the host stored it, so a write starts from that text. */
  text: string;
  fingerprint: string;
  servers: Record<string, McpEntry>;
}

/** Raised when an entry cannot be drawn as a form. */
export class McpAdvancedEntry extends Error {
  constructor() {
    super("This entry has fields the form does not draw");
    this.name = "McpAdvancedEntry";
  }
}

export const mcpAvailable = signal<boolean | null>(null);
export const mcpLoading = signal(false);
export const mcpDocumentLoaded = signal(false);
export const mcpServerRows = signal<McpServerRow[]>([]);
export const mcpBusy = signal<string | null>(null);
export const mcpNotice = signal("");
export const mcpDocument = signal<McpDocument | null>(null);
export const mcpDraft = signal<McpDraft | null>(null);
export const mcpJsonOpen = signal(false);
export const mcpJsonText = signal("");
export const mcpJsonSaved = signal("");
export const mcpJsonNotice = signal("");
/** What the editor last did, so a refused save is not reported as saved. */
export const mcpJsonState = signal("Saved");

/**
 * The remote OAuth flow for one server. The browser half and the callback
 * listener live in the host, so this surface starts the flow, opens the address
 * it answers with and reads the session until the host says how it ended.
 */
export interface McpOAuthSession {
  serverId: string;
  status: string;
  authorizationUrl?: string;
  redirectUri?: string;
  message?: string;
}

/** The server whose authorization panel is open, `null` when none is. */
export const mcpOAuthServer = signal<string | null>(null);
export const mcpOAuthSession = signal<McpOAuthSession | null>(null);
export const mcpOAuthNotice = signal("");
/** The authorization value being typed into the panel, before it is saved. */
export const mcpAuthValue = signal("");
export const mcpOAuthBusy = signal(false);
/** Set when this host could not open the address itself. */
export const mcpOAuthUrlUnopened = signal(false);

/** The statuses the host no longer changes once it reports them. */
const OAUTH_FINISHED = ["authorized", "failed", "cancelled"];
/** How often the session is re-read while the flow runs, as the desktop polls. */
const OAUTH_POLL_MS = 1000;

const OAUTH_POLL_DEADLINE_MS = 10 * 60_000;
let oauthTimer: ReturnType<typeof setTimeout> | null = null;
let oauthPollGen = 0;

function stopOAuthPolling(): void {
  oauthPollGen += 1;
  if (oauthTimer === null) return;
  clearTimeout(oauthTimer);
  oauthTimer = null;
}

/** What each status means in words, the way the desktop labels it. */
export function mcpOAuthStatusLabel(session: McpOAuthSession | null): string {
  if (!session) return "not started";
  switch (session.status) {
    case "awaitingBrowser": return "waiting for the browser";
    case "awaitingCallback": return "waiting for the provider to redirect back";
    case "exchangingToken": return "exchanging the code for a token";
    case "authorized": return "authorized";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return session.status;
  }
}

function readOAuthSession(raw: unknown): McpOAuthSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const serverId = typeof entry.serverId === "string" ? entry.serverId : "";
  const status = typeof entry.status === "string" ? entry.status : "";
  if (!serverId || !status) return null;
  return {
    serverId,
    status,
    authorizationUrl: typeof entry.authorizationUrl === "string" ? entry.authorizationUrl : undefined,
    redirectUri: typeof entry.redirectUri === "string" ? entry.redirectUri : undefined,
    message: typeof entry.message === "string" ? entry.message : undefined,
  };
}

/**
 * Reads the session once. A host that reports a finished status stops the poll
 * and, after an authorization, re-reads the servers so the row shows the auth it
 * now has.
 */
async function readOAuthOnce(serverId: string): Promise<void> {
  let raw: unknown;
  try {
    raw = await invokeCommand<unknown>("get_mcp_remote_oauth_session", { serverId });
  } catch (error) {
    stopOAuthPolling();
    mcpOAuthNotice.set(error instanceof Error ? error.message : String(error));
    return;
  }
  if (mcpOAuthServer() !== serverId) return;
  const session = readOAuthSession(raw);
  mcpOAuthSession.set(session);
  if (!session || !OAUTH_FINISHED.includes(session.status)) return;
  stopOAuthPolling();
  if (session.status === "authorized") {
    mcpOAuthNotice.set(session.message || `${serverId} is authorized`);
    await refreshMcpServers();
    // The panel stays open: the row's status and the auth value it holds both
    // changed, and closing the panel would hide the outcome it just reported.
  } else if (session.status === "failed") {
    mcpOAuthNotice.set(session.message || `Authorization failed for ${serverId}`);
  }
}

function startOAuthPolling(serverId: string): void {
  stopOAuthPolling();
  const gen = oauthPollGen;
  const deadline = Date.now() + OAUTH_POLL_DEADLINE_MS;
  const step = async (): Promise<void> => {
    oauthTimer = null;
    if (gen !== oauthPollGen || mcpOAuthServer() !== serverId) return;
    if (Date.now() > deadline) {
      stopOAuthPolling();
      mcpOAuthNotice.set(`Authorization timed out for ${serverId}`);
      return;
    }
    if (appLifecycle() !== "background") {
      await readOAuthOnce(serverId);
    }
    if (gen !== oauthPollGen || mcpOAuthServer() !== serverId) return;
    oauthTimer = setTimeout(() => void step(), OAUTH_POLL_MS);
  };
  oauthTimer = setTimeout(() => void step(), OAUTH_POLL_MS);
}

/** Opens the authorization panel for one server and reads any session it already has. */
export function openMcpAuth(id: string): void {
  mcpOAuthNotice.set("");
  mcpAuthValue.set("");
  mcpOAuthUrlUnopened.set(false);
  mcpOAuthServer.set(id);
  mcpOAuthSession.set(null);
  void readOAuthOnce(id);
}

/** Closes the panel. A running flow is left running: the host owns it. */
export function closeMcpAuth(): void {
  mcpOAuthServer.set(null);
  mcpOAuthSession.set(null);
  mcpOAuthNotice.set("");
  mcpAuthValue.set("");
  mcpOAuthUrlUnopened.set(false);
  stopOAuthPolling();
}

export function setMcpAuthValue(text: string): void {
  mcpAuthValue.set(text);
  mcpOAuthNotice.set("");
}

/**
 * Starts the flow and opens the address the host answers with. A host that
 * cannot open it is not a failure: the address stays on the panel with its own
 * `Copy` action, because authorizing in a browser by hand still works.
 */
export async function startMcpRemoteOAuth(): Promise<void> {
  const serverId = mcpOAuthServer();
  if (!serverId || mcpOAuthBusy()) return;
  mcpOAuthBusy.set(true);
  mcpOAuthNotice.set("");
  mcpOAuthUrlUnopened.set(false);
  try {
    const raw = await invokeCommand<unknown>("start_mcp_remote_oauth", { serverId });
    const session = readOAuthSession(raw);
    mcpOAuthSession.set(session);
    if (session?.authorizationUrl) {
      try {
        await openUrl(session.authorizationUrl);
      } catch {
        // No browser, no grant for the scheme, or a host that routed it nowhere.
        mcpOAuthUrlUnopened.set(true);
      }
    } else {
      mcpOAuthUrlUnopened.set(true);
    }
    mcpOAuthNotice.set(session?.message || `Started authorization for ${serverId}`);
    startOAuthPolling(serverId);
  } catch (error) {
    mcpOAuthNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpOAuthBusy.set(false);
  }
}

/** Stops the flow on the host and stops reading it. */
export async function cancelMcpRemoteOAuth(): Promise<void> {
  const serverId = mcpOAuthServer();
  if (!serverId || mcpOAuthBusy()) return;
  mcpOAuthBusy.set(true);
  try {
    await invokeCommand("cancel_mcp_remote_oauth", { serverId });
    stopOAuthPolling();
    mcpOAuthNotice.set(`Cancelled authorization for ${serverId}`);
    await readOAuthOnce(serverId);
  } catch (error) {
    mcpOAuthNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpOAuthBusy.set(false);
  }
}

/** Copies the address the panel could not open, so it can be pasted in a browser. */
export function copyMcpOAuthUrl(): void {
  const url = mcpOAuthSession()?.authorizationUrl;
  if (!url) return;
  void Clipboard.writeText(url).then(
    () => mcpOAuthNotice.set("Copied the authorization address"),
    () => mcpOAuthNotice.set("The clipboard refused the address; select it instead"),
  );
}

/** Writes the authorization value the desktop's dialog also accepts. */
export async function saveMcpRemoteAuth(): Promise<void> {
  const serverId = mcpOAuthServer();
  const value = mcpAuthValue().trim();
  if (!serverId || mcpOAuthBusy()) return;
  if (!value) {
    mcpOAuthNotice.set("A token or authorization value is required");
    return;
  }
  mcpOAuthBusy.set(true);
  try {
    await invokeCommand("update_mcp_remote_auth", { serverId, authorizationValue: value });
    mcpAuthValue.set("");
    mcpOAuthNotice.set(`Saved the authorization value for ${serverId}`);
    await refreshMcpServers();
  } catch (error) {
    mcpOAuthNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpOAuthBusy.set(false);
  }
}

/** Forgets this server's stored authorization. */
export async function clearMcpRemoteAuth(): Promise<void> {
  const serverId = mcpOAuthServer();
  if (!serverId || mcpOAuthBusy()) return;
  mcpOAuthBusy.set(true);
  try {
    await invokeCommand("clear_mcp_remote_auth", { serverId });
    mcpOAuthNotice.set(`Cleared the authorization for ${serverId}`);
    await refreshMcpServers();
  } catch (error) {
    mcpOAuthNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpOAuthBusy.set(false);
  }
}

const TRANSPORT_ALIASES: Record<string, McpTransport> = {
  local: "stdio",
  stdio: "stdio",
  remote: "streamable-http",
  http: "streamable-http",
  "streamable-http": "streamable-http",
  streamable_http: "streamable-http",
  streamablehttp: "streamable-http",
  sse: "sse",
};

export const MCP_TRANSPORTS: ReadonlyArray<{ value: McpTransport; label: string }> = [
  { value: "stdio", label: "Local command" },
  { value: "streamable-http", label: "HTTP" },
  { value: "sse", label: "SSE" },
];

let probeStarted = false;

function isEntry(value: unknown): value is McpEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(entry: McpEntry, key: string): string {
  const value = entry[key];
  if (value === undefined) return "";
  if (typeof value !== "string") throw new McpAdvancedEntry();
  return value;
}

function optionalFlag(entry: McpEntry, key: string, fallback: boolean): boolean {
  const value = entry[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new McpAdvancedEntry();
  return value;
}

function keyValueText(value: unknown): string {
  if (value === undefined) return "";
  if (!isEntry(value)) throw new McpAdvancedEntry();
  const lines: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new McpAdvancedEntry();
    lines.push(`${key}=${item}`);
  }
  return lines.join("\n");
}

function parseKeyValues(text: string, field: "env" | "headers"): Record<string, string> {
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const split = line.indexOf("=");
    if (split <= 0) throw new Error(`A ${field} line needs KEY=VALUE: ${line}`);
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (!key || (field === "env" && /[=\0]/.test(key))) {
      throw new Error(`Not a valid ${field} name: ${key}`);
    }
    const identity = field === "headers" ? key.toLowerCase() : key;
    if (seen.has(identity)) throw new Error(`Duplicate ${field} key: ${key}`);
    seen.add(identity);
    result[key] = value;
  }
  return result;
}

function transportOf(entry: McpEntry): McpTransport {
  const type = optionalText(entry, "type").trim().toLowerCase();
  const declared = optionalText(entry, "transport").trim().toLowerCase();
  const name = declared || type;
  if (name) {
    const transport = TRANSPORT_ALIASES[name];
    if (!transport) throw new McpAdvancedEntry();
    return transport;
  }
  // No declaration: a URL means a remote server, a command means a local one.
  return optionalText(entry, "url").trim() ? "streamable-http" : "stdio";
}

/** Turns a stored entry into the fields the form draws. */
export function draftFromEntry(id: string, entry: McpEntry): McpDraft {
  const args = entry.args ?? [];
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new McpAdvancedEntry();
  const timeouts = entry.timeouts;
  if (timeouts !== undefined && !isEntry(timeouts)) throw new McpAdvancedEntry();
  const startupMs = isEntry(timeouts) ? timeouts.startupMs : undefined;
  if (startupMs !== undefined && (typeof startupMs !== "number" || !Number.isFinite(startupMs) || startupMs <= 0)) {
    throw new McpAdvancedEntry();
  }
  return {
    originalId: id,
    id,
    name: optionalText(entry, "name") || id,
    transport: transportOf(entry),
    command: optionalText(entry, "command"),
    args: (args as string[]).join("\n"),
    env: keyValueText(entry.env),
    workingDirectory: optionalText(entry, "workingDirectory"),
    url: optionalText(entry, "url"),
    headers: keyValueText(entry.headers),
    // The desktop treats an entry without `enabled` as enabled.
    enabled: optionalFlag(entry, "enabled", true),
    autoStart: optionalFlag(entry, "autoStart", optionalFlag(entry, "auto_start", true)),
    startupSeconds: startupMs === undefined ? "" : String(startupMs / 1000),
  };
}

function startupMsOf(draft: McpDraft): number | undefined {
  const text = draft.startupSeconds.trim();
  if (!text) return undefined;
  const seconds = Number(text);
  const milliseconds = Math.round(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || milliseconds / 1000 !== seconds) {
    throw new Error("Startup seconds must be a positive number with at most millisecond precision");
  }
  return milliseconds;
}

/**
 * Writes only the fields the form owns into a copy of the stored entry, so a
 * field this surface does not draw survives an edit.
 */
function entryFromDraft(base: McpEntry | undefined, draft: McpDraft): McpEntry {
  const name = draft.name.trim();
  if (!name) throw new Error("A server needs a name");
  const entry: McpEntry = { ...(base ?? {}) };
  const local = draft.transport === "stdio";
  if (local && !draft.command.trim()) throw new Error("A local server needs a command");
  if (!local) {
    let url: URL;
    try {
      url = new URL(draft.url.trim());
    } catch {
      throw new Error("A remote server needs an http or https URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("A remote server needs an http or https URL");
    }
  }

  const previousTransport = base ? transportOf(base) : undefined;
  entry.name = name;
  entry.enabled = draft.enabled;
  entry.autoStart = draft.autoStart;
  if (previousTransport !== draft.transport) {
    delete entry.type;
    delete entry.source;
    entry.transport = draft.transport;
    const dropped = local
      ? ["url", "headers", "oauth", "oauthEnabled", "xaa"]
      : ["command", "args", "env", "workingDirectory", "inheritParentEnvironment"];
    for (const key of dropped) delete entry[key];
  }

  if (local) {
    entry.command = draft.command.trim();
    const args = draft.args
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0);
    entry.args = args;
    const env = parseKeyValues(draft.env, "env");
    if (Object.keys(env).length) entry.env = env;
    else delete entry.env;
    const cwd = draft.workingDirectory.trim();
    if (cwd) entry.workingDirectory = cwd;
    else delete entry.workingDirectory;
  } else {
    entry.url = draft.url.trim();
    const headers = parseKeyValues(draft.headers, "headers");
    if (Object.keys(headers).length) entry.headers = headers;
    else delete entry.headers;
  }

  const startupMs = startupMsOf(draft);
  const timeouts: McpEntry = isEntry(entry.timeouts) ? { ...entry.timeouts } : {};
  if (startupMs === undefined) delete timeouts.startupMs;
  else timeouts.startupMs = startupMs;
  if (Object.keys(timeouts).length) entry.timeouts = timeouts;
  else delete entry.timeouts;
  return entry;
}

/** The ids an import or another surface may already have created. */
function documentServers(document: McpDocument | null): Record<string, McpEntry> {
  return document?.servers ?? {};
}

export function mcpEntryOf(id: string): McpEntry | undefined {
  const entry = documentServers(mcpDocument())[id];
  return isEntry(entry) ? entry : undefined;
}

/** Whether the row can open the form instead of sending the user to the JSON. */
export function mcpRowIsSimple(id: string): boolean {
  const entry = mcpEntryOf(id);
  if (!entry) return false;
  try {
    draftFromEntry(id, entry);
    return true;
  } catch {
    return false;
  }
}

export function ensureMcp(): void {
  if (probeStarted) return;
  probeStarted = true;
  void refreshMcpServers();
  void loadMcpDocument();
}

/** Resets MCP state and re-reads servers and config document for the newly selected device scope. */
export function reloadMcpForDevice(): void {
  probeStarted = true;
  mcpAvailable.set(null);
  mcpLoading.set(true);
  mcpDocumentLoaded.set(false);
  mcpServerRows.set([]);
  mcpDocument.set(null);
  mcpNotice.set("");
  mcpDraft.set(null);
  mcpJsonOpen.set(false);
  mcpImportOpen.set(false);
  closeMcpAuth();
  void refreshMcpServers();
  void loadMcpDocument();
}

/**
 * Asks the host for its server list. A host that does not answer has no MCP
 * surface at all, and the section stays hidden rather than showing an error.
 */
export async function refreshMcpServers(): Promise<void> {
  mcpLoading.set(true);
  try {
    const rows = await invokeCommand<McpServerRow[]>("get_mcp_servers");
    mcpServerRows.set(Array.isArray(rows) ? rows : []);
    mcpAvailable.set(true);
  } catch (error) {
    if (mcpAvailable() === null) {
      mcpAvailable.set(false);
      return;
    }
    mcpNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpLoading.set(false);
  }
}

export async function loadMcpDocument(): Promise<void> {
  try {
    const snapshot = await invokeCommand<{ jsonConfig: string; fingerprint: string }>(
      "load_mcp_json_config",
    );
    if (!snapshot || typeof snapshot.jsonConfig !== "string") {
      mcpDocument.set(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.jsonConfig);
    } catch {
      parsed = null;
    }
    const servers = isEntry(parsed) && isEntry((parsed as McpEntry).mcpServers)
      ? ((parsed as McpEntry).mcpServers as Record<string, McpEntry>)
      : null;
    mcpDocument.set(
      servers ? { text: snapshot.jsonConfig, fingerprint: snapshot.fingerprint ?? "", servers } : null,
    );
    // The editor shows the stored text until the user types in it.
    if (!mcpJsonOpen()) {
      mcpJsonText.set(snapshot.jsonConfig);
      mcpJsonSaved.set(snapshot.jsonConfig);
    }
  } catch (error) {
    mcpDocument.set(null);
    if (mcpAvailable() !== false) {
      mcpNotice.set(error instanceof Error ? error.message : String(error));
    }
  } finally {
    mcpDocumentLoaded.set(true);
  }
}

async function saveDocument(document: McpDocument, nextServers: Record<string, McpEntry>): Promise<boolean> {
  const parsed = JSON.parse(document.text) as McpEntry;
  parsed.mcpServers = nextServers;
  return saveMcpText(JSON.stringify(parsed, null, 2), document.fingerprint);
}

/** Writes the document back, refusing a stale fingerprint. Reports where it failed. */
async function saveMcpText(text: string, fingerprint: string): Promise<boolean> {
  if (!fingerprint) {
    mcpNotice.set("The stored configuration is unavailable; reload before saving");
    return false;
  }
  try {
    // Rust `save_mcp_json_config(state, json_config, expected_fingerprint)` takes
    // positional camelCase args, NOT a `{ request }` wrapper.
    await invokeRawCommand("save_mcp_json_config", { jsonConfig: text, expectedFingerprint: fingerprint });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A refused fingerprint means the file moved under us: re-read, so the next
    // save starts from what is actually stored instead of overwriting it.
    mcpNotice.set(
      message.includes("MCP configuration changed")
        ? "The MCP configuration changed elsewhere; reloaded it"
        : message,
    );
    await loadMcpDocument();
    return false;
  }
  await loadMcpDocument();
  await refreshMcpServers();
  return true;
}

function serverIdFrom(name: string, taken: readonly string[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "mcp-server";
  let id = base;
  for (let suffix = 2; taken.includes(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

export function openMcpDraft(id?: string): void {
  mcpNotice.set("");
  if (!id) {
    mcpDraft.set({
      id: "",
      name: "",
      transport: "streamable-http",
      command: "",
      args: "",
      env: "",
      workingDirectory: "",
      url: "",
      headers: "",
      enabled: false,
      autoStart: true,
      startupSeconds: "",
    });
    return;
  }
  const entry = mcpEntryOf(id);
  if (!entry) {
    mcpNotice.set("This server has no stored entry; reload the page");
    return;
  }
  try {
    mcpDraft.set(draftFromEntry(id, entry));
  } catch {
    mcpNotice.set(`${id} has fields the form does not draw; edit it as JSON`);
  }
}

export function closeMcpDraft(): void {
  mcpDraft.set(null);
}

export function updateMcpDraft(patch: Partial<McpDraft>): void {
  mcpDraft.update(current => (current ? { ...current, ...patch } : current));
}

export async function saveMcpDraft(): Promise<void> {
  const draft = mcpDraft();
  const document = mcpDocument();
  if (!draft) return;
  if (!document) {
    mcpNotice.set("The stored configuration is unavailable; reload before saving");
    return;
  }
  const taken = Object.keys(document.servers);
  const id = draft.originalId ?? (draft.id.trim() || serverIdFrom(draft.name, taken));
  if (!/^[a-z0-9_.-]{1,128}$/i.test(id)) {
    mcpNotice.set("A server id is 1-128 letters, digits, dot, dash or underscore");
    return;
  }
  if (!draft.originalId && taken.includes(id)) {
    mcpNotice.set(`${id} already exists`);
    return;
  }
  let entry: McpEntry;
  try {
    const base = draft.originalId ? document.servers[draft.originalId] : undefined;
    entry = entryFromDraft(base, draft);
  } catch (error) {
    mcpNotice.set(error instanceof Error ? error.message : String(error));
    return;
  }
  mcpBusy.set("mcp-save");
  try {
    const servers = { ...document.servers };
    // A new server is always stored disabled: writing a configuration is not
    // permission to launch the program it names.
    servers[id] = draft.originalId ? entry : { ...entry, enabled: false };
    if (await saveDocument(document, servers)) {
      mcpNotice.set(draft.originalId ? `Saved ${id}` : `Added ${id}, stopped`);
      mcpDraft.set(null);
    }
  } finally {
    mcpBusy.set(null);
  }
}

/** Removes a server from the runtime and from the stored configuration. */
export async function deleteMcpServer(id: string): Promise<void> {
  mcpBusy.set(id);
  try {
    // `delete_mcp_server` is one of the few MCP commands that takes a request
    // struct; `invokeCommand` already wraps the body in `{ request }`.
    await invokeCommand("delete_mcp_server", { serverId: id });
    mcpNotice.set(`Deleted ${id}`);
    await refreshMcpServers();
    await loadMcpDocument();
  } catch (error) {
    mcpNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpBusy.set(null);
  }
}

async function lifecycle(id: string, action: "start" | "stop" | "restart"): Promise<void> {
  mcpBusy.set(id);
  try {
    // The lifecycle commands take the server id as a positional argument, so
    // they go through the raw path instead of the `request` envelope.
    await invokeRawCommand(`${action}_mcp_server`, { serverId: id });
    const verb = action === "start" ? "Started" : action === "stop" ? "Stopped" : "Restarted";
    mcpNotice.set(`${verb} ${id}`);
    await refreshMcpServers();
  } catch (error) {
    mcpNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    mcpBusy.set(null);
  }
}

export function startMcpServer(id: string): Promise<void> {
  return lifecycle(id, "start");
}

/**
 * Turns a stored-disabled server on, the way the desktop's `MCPAPI.enableServer`
 * does: re-read the document for a fresh fingerprint, flip that one entry's
 * `enabled`, and write it back. The host refuses to start a disabled server, so
 * "Enable and start" must run this first; `start` then launches it.
 */
export async function enableMcpServer(id: string, options: { start?: boolean } = {}): Promise<boolean> {
  mcpBusy.set(id);
  try {
    await loadMcpDocument();
    const document = mcpDocument();
    const entry = document ? document.servers[id] : undefined;
    if (!document || !isEntry(entry)) {
      mcpNotice.set("The stored configuration is unavailable; reload before enabling");
      return false;
    }
    if (entry.enabled === false) {
      const servers = { ...document.servers, [id]: { ...entry, enabled: true } };
      if (!(await saveDocument(document, servers))) return false;
    }
    mcpNotice.set(`Enabled ${id}`);
  } catch (error) {
    mcpNotice.set(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    mcpBusy.set(null);
  }
  if (options.start) await lifecycle(id, "start");
  return true;
}

export function stopMcpServer(id: string): Promise<void> {
  return lifecycle(id, "stop");
}

export function restartMcpServer(id: string): Promise<void> {
  return lifecycle(id, "restart");
}

/** The whole document as text, for the fields no form draws. */
export function openMcpJson(): void {
  const document = mcpDocument();
  mcpJsonNotice.set("");
  mcpJsonText.set(document?.text ?? "");
  mcpJsonSaved.set(document?.text ?? "");
  mcpJsonState.set("Saved");
  mcpJsonOpen.set(true);
}

export function closeMcpJson(): void {
  mcpJsonOpen.set(false);
  mcpJsonNotice.set("");
  const document = mcpDocument();
  if (document) {
    mcpJsonText.set(document.text);
    mcpJsonSaved.set(document.text);
  }
}

export function updateMcpJson(text: string): void {
  mcpJsonText.set(text);
  mcpJsonNotice.set("");
  mcpJsonState.set("Unsaved changes");
}

export async function saveMcpJson(): Promise<void> {
  const document = mcpDocument();
  const text = mcpJsonText();
  if (!document) {
    mcpJsonNotice.set("The stored configuration is unavailable; reload before saving");
    mcpJsonState.set("Not saved");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    mcpJsonNotice.set(error instanceof Error ? error.message : String(error));
    mcpJsonState.set("Not saved");
    return;
  }
  if (!isEntry(parsed) || !isEntry((parsed as McpEntry).mcpServers)) {
    mcpJsonNotice.set("The document needs an mcpServers object");
    mcpJsonState.set("Not saved");
    return;
  }
  mcpBusy.set("mcp-json");
  try {
    if (await saveMcpText(text, document.fingerprint)) {
      mcpJsonSaved.set(text);
      mcpJsonNotice.set("");
      mcpJsonState.set("Saved");
    } else {
      // The store's notice carries the reason; mirror it where the editor shows it.
      mcpJsonNotice.set(mcpNotice());
      mcpJsonState.set("Not saved");
    }
  } finally {
    mcpBusy.set(null);
  }
}

/**
 * One server read out of a pasted configuration, before it is written.
 * `unsupported` names why this surface's form cannot express the entry; such a
 * row is shown and stays out of the write instead of being silently dropped.
 */
export interface McpImportCandidate {
  sourceId: string;
  targetId: string;
  selected: boolean;
  entry: McpEntry;
  unsupported: string;
}

export const mcpImportOpen = signal(false);
export const mcpImportText = signal("");
export const mcpImportCandidates = signal<McpImportCandidate[] | null>(null);
export const mcpImportNotice = signal("");

const MCP_ID_PATTERN = /^[a-z0-9_.-]{1,128}$/i;

export function openMcpImport(): void {
  mcpImportOpen.set(true);
  mcpImportText.set("");
  mcpImportCandidates.set(null);
  mcpImportNotice.set("");
}

export function closeMcpImport(): void {
  mcpImportOpen.set(false);
  mcpImportCandidates.set(null);
  mcpImportNotice.set("");
}

/** Editing the text invalidates the parsed list, because it described other text. */
export function setMcpImportText(text: string): void {
  mcpImportText.set(text);
  mcpImportCandidates.set(null);
  mcpImportNotice.set("");
}

export function updateMcpImportCandidate(
  sourceId: string,
  patch: Partial<Pick<McpImportCandidate, "targetId" | "selected">>,
): void {
  mcpImportCandidates.update(list =>
    list
      ? list.map(candidate => (candidate.sourceId === sourceId ? { ...candidate, ...patch } : candidate))
      : list,
  );
}

/**
 * Reads a pasted Cursor-format document and marks what can be imported here.
 * The entry shape is checked by the same reader the edit form uses, so an entry
 * this surface could not show is refused at preview time rather than stored and
 * then reported as un-editable.
 */
export function previewMcpImport(): void {
  mcpImportNotice.set("");
  mcpImportCandidates.set(null);
  const text = mcpImportText().trim();
  if (!text) {
    mcpImportNotice.set("Paste a configuration first");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    mcpImportNotice.set("That is not valid JSON");
    return;
  }
  const servers =
    isEntry(parsed) && isEntry((parsed as McpEntry).mcpServers)
      ? ((parsed as McpEntry).mcpServers as Record<string, McpEntry>)
      : null;
  if (!servers) {
    mcpImportNotice.set("A configuration is an object whose mcpServers holds one entry per server");
    return;
  }
  const entries = Object.entries(servers);
  if (!entries.length) {
    mcpImportNotice.set("That configuration holds no server");
    return;
  }
  const taken = Object.keys(documentServers(mcpDocument()));
  const candidates: McpImportCandidate[] = entries.map(([sourceId, entry]) => {
    let unsupported = "";
    try {
      draftFromEntry(sourceId, entry);
    } catch (error) {
      unsupported = error instanceof Error ? error.message : String(error);
    }
    return {
      sourceId,
      targetId: sourceId,
      // A name already in the document starts unchecked: the id is taken, and an
      // import that renamed it without being asked would be a different server.
      selected: !unsupported && !taken.includes(sourceId),
      entry,
      unsupported,
    };
  });
  mcpImportCandidates.set(candidates);
  const blocked = candidates.filter(candidate => candidate.unsupported).length;
  mcpImportNotice.set(
    blocked
      ? `${entries.length} server${entries.length === 1 ? "" : "s"} read; ${blocked} cannot be imported by this form`
      : `${entries.length} server${entries.length === 1 ? "" : "s"} read`,
  );
}

/**
 * Writes the selected entries into the stored document as one save. Every entry
 * lands `enabled: false`: importing a configuration is not permission to launch
 * what it names, and `_openbitfunImport` (the origin marker an external import
 * carries) is not part of a server entry.
 */
export async function importMcpServers(): Promise<void> {
  const document = mcpDocument();
  const candidates = mcpImportCandidates() ?? [];
  if (!document) {
    mcpImportNotice.set("The stored configuration is unavailable; reload before importing");
    return;
  }
  const selected = candidates.filter(candidate => candidate.selected && !candidate.unsupported);
  if (!selected.length) {
    mcpImportNotice.set("Select at least one server to import");
    return;
  }
  const servers = { ...document.servers };
  for (const candidate of selected) {
    const id = candidate.targetId.trim();
    if (!MCP_ID_PATTERN.test(id)) {
      mcpImportNotice.set(`${id || "A blank id"} is not a usable server id`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(servers, id)) {
      mcpImportNotice.set(`${id} already exists`);
      return;
    }
    const entry: McpEntry = { ...candidate.entry };
    delete entry._openbitfunImport;
    servers[id] = { ...entry, enabled: false };
  }
  mcpBusy.set("mcp-import");
  try {
    if (await saveDocument(document, servers)) {
      // The panel closes on success, so the result goes where the section shows
      // the outcome of every other MCP write.
      mcpNotice.set(
        `Imported ${selected.length} server${selected.length === 1 ? "" : "s"}; each is stored disabled`,
      );
      mcpImportOpen.set(false);
      mcpImportCandidates.set(null);
      mcpImportNotice.set("");
    }
  } finally {
    mcpBusy.set(null);
  }
}

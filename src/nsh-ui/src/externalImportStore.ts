// External import: what other AI applications installed on the host expose
// (their config sources, commands, tools, subagents and MCP servers), the one
// switch that lets the host scan for them, the MCP servers that can be copied
// into OpenBitFun, and the source sessions a user removed from the session list.
//
// Every command here takes one `request` struct whose fields are camelCase and
// `deny_unknown_fields`, so a field the host does not know is refused: the
// workspace travels as `workspaceId` (or `workspacePath` for a Peer that never
// advertised `workspace_id_references_v1`), never both, and is left out entirely
// for the user/global scope. The host refuses a remote (SSH) workspace for all of
// them, so this surface never sends one and says why instead. A host that lacks a
// command answers with its name and "not found" / "unknown command"; that is read
// as an older host (`incompatible`) rather than as a failure, the same mapping the
// desktop's ExternalSourcesAPI uses, and the older read is tried before giving up.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { peerScope, peerSupports } from "./peerState";
import { activeWorkspace } from "./state";
import type { WorkspaceRecord } from "./api";

export type ExternalSourceHealth = "available" | "partial" | "degraded" | "unavailable";

export interface ExternalSourceRow {
  stableKey: string;
  ecosystemId: string;
  displayName: string;
  scope: string;
  location: string;
  health: string;
  lifecycle: string;
}

export interface ExternalDiscoveryState {
  enabled: boolean;
  canChange: boolean;
  hasScanned: boolean;
  preferenceRevision: number;
}

export interface ExternalImportSnapshot {
  /** `null` when the host predates the discovery snapshot (read-only switch). */
  discovery: ExternalDiscoveryState | null;
  generation: number;
  discoveryPending: boolean;
  canRefresh: boolean;
  sources: ExternalSourceRow[];
  counts: { commands: number; tools: number; subagents: number; mcpServers: number };
  /** Ecosystems the host has an adapter for, in the host's order. */
  ecosystems: Array<{ id: string; displayName: string }>;
}

export type McpImportDisposition = "eligible" | "automatic_rename" | "already_imported" | "unavailable";

export interface McpImportItem {
  candidateId: string;
  displayName: string;
  transport: string;
  proposedNativeId: string;
  disposition: string;
  reasonCode: string;
}

export interface McpImportPlan {
  planFingerprint: string;
  items: McpImportItem[];
}

export interface RemovedExternalSessionRow {
  ecosystemId: string;
  sessionId: string;
  sessionName: string;
  workspaceId: string;
  workspaceName: string;
}

/** Why the page cannot read the host, when it cannot. */
export type ExternalImportBlock = "" | "remoteWorkspace" | "incompatible";

export type ExternalLoadState = "idle" | "loading" | "ready" | "error";

export type RemovedSessionsState =
  | "idle"
  | "loading"
  | "ready"
  | "unsupportedSurface"
  | "unsupportedHost"
  | "error";

export type McpPlanState = "idle" | "loading" | "ready" | "unsupported" | "error";

export const externalSnapshot = signal<ExternalImportSnapshot | null>(null);
export const externalLoadState = signal<ExternalLoadState>("idle");
export const externalBlock = signal<ExternalImportBlock>("");
/** The host's own message for the last failed read, shown under the page. */
export const externalError = signal("");
export const externalDiscoverySaving = signal(false);
export const externalDiscoveryError = signal("");

export const mcpImportPlan = signal<McpImportPlan | null>(null);
export const mcpPlanState = signal<McpPlanState>("idle");
export const mcpImportBusy = signal<string | null>(null);
/** The result of the last import, as a message key and its parameters. */
export const externalMcpNotice = signal<{ tone: "success" | "warning" | "danger"; key: string; name?: string } | null>(null);

export const removedSessions = signal<RemovedExternalSessionRow[]>([]);
export const removedSessionsState = signal<RemovedSessionsState>("idle");
export const removedRestoreBusy = signal<string | null>(null);
export const removedRestoreFailed = signal<string | null>(null);

/** The session ecosystems the host can import from, as the desktop names them. */
export const EXTERNAL_SESSION_NAMES: Readonly<Record<string, string>> = {
  codex: "Codex",
  cursor: "Cursor",
  zcode: "Zcode",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
  "deepseek-harness": "DeepSeek Harness",
};

let loadTicket = 0;
let planTicket = 0;
let removedTicket = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The host's `ExternalSourceOperationError`, when the message carries one. */
export function parseOperationError(error: unknown): { code: string; detail: string } | null {
  const text = errorText(error).trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = asRecord(JSON.parse(text.slice(start)));
    if (typeof parsed.code === "string") {
      return { code: parsed.code, detail: str(parsed.detail) };
    }
  } catch {
    // Not a serialized operation error.
  }
  return null;
}

/**
 * True when the host does not have `command` at all: its error names the command
 * and says it is unknown, or it is a CLI peer or server host that never
 * implemented it. Mirrors the desktop's `incompatible_version` mapping.
 */
export function isCommandMissing(command: string, error: unknown): boolean {
  const raw = errorText(error);
  const parsed = parseOperationError(error);
  if (parsed?.code === "host_capability_unavailable" && parsed.detail === "Unknown Server Host operation") {
    return true;
  }
  if (parsed?.code === "incompatible_version") return true;
  if (!raw.includes(command)) return false;
  return /unknown command|not found|not registered|not supported on cli peer host|no fixture|no answer/i.test(raw);
}

function isRemoteWorkspace(workspace: WorkspaceRecord | null): boolean {
  return (workspace?.workspaceKind ?? "").toLowerCase() === "remote";
}

/**
 * The workspace fields one request carries: none for the user scope, the id for
 * a host that resolves ids, and the root path for a Peer that predates them.
 */
export function workspaceFields(workspace: WorkspaceRecord | null): Record<string, string> {
  if (!workspace) return {};
  if (peerScope() && peerSupports("workspace_id_references_v1") === false) {
    return { workspacePath: workspace.rootPath };
  }
  return { workspaceId: workspace.id };
}

function scopeKey(): string {
  return `${peerScope()?.deviceId ?? "local"}|${activeWorkspace()?.id ?? ""}`;
}

function mapCatalog(raw: unknown, discovery: ExternalDiscoveryState | null): ExternalImportSnapshot {
  const catalog = asRecord(raw);
  const capabilities = asRecord(catalog.hostCapabilities);
  const sources = asArray(catalog.sources).map(item => {
    const source = asRecord(item);
    const record = asRecord(source.record);
    return {
      stableKey: str(source.stableKey),
      ecosystemId: str(record.ecosystemId),
      displayName: str(record.displayName),
      scope: str(record.scope),
      location: str(record.location),
      health: str(record.health),
      lifecycle: str(source.lifecycle),
    };
  });
  const policy = asRecord(catalog.integrationPolicy);
  const ecosystems: Array<{ id: string; displayName: string }> = [];
  const seen = new Set<string>();
  for (const item of asArray(policy.registeredEcosystems)) {
    const record = asRecord(item);
    const id = str(record.ecosystemId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ecosystems.push({ id, displayName: str(record.displayName) || id });
  }
  for (const source of sources) {
    if (!source.ecosystemId || seen.has(source.ecosystemId)) continue;
    seen.add(source.ecosystemId);
    ecosystems.push({ id: source.ecosystemId, displayName: source.displayName || source.ecosystemId });
  }
  return {
    discovery,
    generation: typeof catalog.generation === "number" ? catalog.generation : 0,
    discoveryPending: catalog.discoveryPending === true,
    canRefresh: capabilities.canRefresh !== false,
    sources,
    // Every list but `commands` is left out when empty.
    counts: {
      commands: asArray(catalog.commands).length,
      tools: asArray(catalog.tools).length,
      subagents: asArray(catalog.subagents).length,
      mcpServers: asArray(catalog.mcpServers).length,
    },
    ecosystems,
  };
}

function mapDiscoverySnapshot(raw: unknown): ExternalImportSnapshot {
  const value = asRecord(raw);
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported discovery snapshot version: ${String(value.schemaVersion)}`);
  }
  return mapCatalog(value.catalog, {
    enabled: value.automaticDiscovery === true,
    canChange: value.canChangeAutomaticDiscovery === true,
    hasScanned: value.hasScanned === true,
    preferenceRevision: typeof value.preferenceRevision === "number" ? value.preferenceRevision : 0,
  });
}

/**
 * Reads the newest snapshot the host offers: the discovery snapshot, then the
 * control snapshot, then the legacy catalog. Only the first carries the
 * automatic-discovery switch; the older two draw it read-only.
 */
async function readSnapshot(request: Record<string, unknown>): Promise<ExternalImportSnapshot | null> {
  try {
    return mapDiscoverySnapshot(
      await invokeCommand<unknown>("get_external_source_discovery_snapshot", request),
    );
  } catch (error) {
    if (!isCommandMissing("get_external_source_discovery_snapshot", error)) throw error;
  }
  try {
    const surface = asRecord(await invokeCommand<unknown>("get_external_source_control_snapshot", request));
    return mapCatalog(surface.catalog, null);
  } catch (error) {
    if (!isCommandMissing("get_external_source_control_snapshot", error)) throw error;
  }
  try {
    return mapCatalog(await invokeCommand<unknown>("get_external_source_snapshot", request), null);
  } catch (error) {
    if (!isCommandMissing("get_external_source_snapshot", error)) throw error;
  }
  return null;
}

/** Clears everything a previous host or workspace answered. */
export function resetExternalImport(): void {
  loadTicket += 1;
  planTicket += 1;
  removedTicket += 1;
  externalSnapshot.set(null);
  externalLoadState.set("idle");
  externalBlock.set("");
  externalError.set("");
  externalDiscoveryError.set("");
  externalDiscoverySaving.set(false);
  mcpImportPlan.set(null);
  mcpPlanState.set("idle");
  mcpImportBusy.set(null);
  externalMcpNotice.set(null);
  removedSessions.set([]);
  removedSessionsState.set("idle");
  removedRestoreBusy.set(null);
  removedRestoreFailed.set(null);
}

let lastScope = "";

/** Loads the page for the current host and workspace, once per scope unless forced. */
export function syncExternalImportScope(force = false): void {
  const key = scopeKey();
  if (!force && key === lastScope && externalLoadState() !== "idle") return;
  if (key !== lastScope) resetExternalImport();
  lastScope = key;
  void loadExternalImport(false);
}

/** Reads the snapshot (asking the host to rescan when `forceRefresh`), then the MCP plan and removed sessions. */
export async function loadExternalImport(forceRefresh: boolean): Promise<void> {
  const workspace = activeWorkspace();
  const ticket = ++loadTicket;
  externalError.set("");
  if (isRemoteWorkspace(workspace)) {
    externalBlock.set("remoteWorkspace");
    externalSnapshot.set(null);
    externalLoadState.set("ready");
    mcpPlanState.set("idle");
    void loadRemovedSessions();
    return;
  }
  externalBlock.set("");
  externalLoadState.set("loading");
  try {
    const snapshot = await readSnapshot({ ...workspaceFields(workspace), forceRefresh });
    if (ticket !== loadTicket) return;
    if (!snapshot) {
      externalBlock.set("incompatible");
      externalSnapshot.set(null);
      externalLoadState.set("ready");
      return;
    }
    externalSnapshot.set(snapshot);
    externalLoadState.set("ready");
    void loadMcpImportPlan();
  } catch (error) {
    if (ticket !== loadTicket) return;
    externalError.set(parseOperationError(error)?.detail || errorText(error));
    externalLoadState.set("error");
  } finally {
    // Removed sessions do not depend on the snapshot, so they are read whatever it
    // answered (an older host gets its own sentence); the snapshot only narrows
    // which ecosystems are asked.
    if (ticket === loadTicket) void loadRemovedSessions();
  }
}

/** Turns the host's automatic discovery on or off, then reads the snapshot again. */
export async function setAutomaticDiscovery(enabled: boolean): Promise<void> {
  const snapshot = externalSnapshot();
  const discovery = snapshot?.discovery;
  if (!discovery || !discovery.canChange || externalDiscoverySaving()) return;
  const workspace = activeWorkspace();
  if (isRemoteWorkspace(workspace)) return;
  externalDiscoverySaving.set(true);
  externalDiscoveryError.set("");
  try {
    await invokeCommand<unknown>("update_external_integration_policy_command", {
      ...workspaceFields(workspace),
      mutation: {
        expectedPreferenceRevision: discovery.preferenceRevision,
        scope: workspace ? "workspace" : "user",
        change: { operation: "set_automatic_discovery", enabled },
      },
    });
  } catch (error) {
    externalDiscoveryError.set(parseOperationError(error)?.detail || errorText(error));
  } finally {
    externalDiscoverySaving.set(false);
  }
  // Re-read whatever happened: a refused write may mean the revision moved.
  await loadExternalImport(false);
}

/** True when this surface may copy MCP servers into OpenBitFun here. */
export function mcpImportSupported(): boolean {
  // The desktop imports only when it drives its own host: a Peer would copy into
  // the peer's configuration from a list this machine cannot inspect.
  return peerScope() === null && !isRemoteWorkspace(activeWorkspace());
}

export async function loadMcpImportPlan(): Promise<void> {
  const snapshot = externalSnapshot();
  const ticket = ++planTicket;
  if (!snapshot || snapshot.counts.mcpServers === 0 || snapshot.discovery?.enabled === false) {
    mcpImportPlan.set(null);
    mcpPlanState.set("idle");
    return;
  }
  if (!mcpImportSupported()) {
    mcpImportPlan.set(null);
    mcpPlanState.set("unsupported");
    return;
  }
  mcpPlanState.set("loading");
  try {
    const plan = mapPlan(
      await invokeCommand<unknown>("plan_external_mcp_import_command", workspaceFields(activeWorkspace())),
    );
    if (ticket !== planTicket) return;
    mcpImportPlan.set(plan);
    mcpPlanState.set("ready");
  } catch (error) {
    if (ticket !== planTicket) return;
    mcpImportPlan.set(null);
    mcpPlanState.set(isCommandMissing("plan_external_mcp_import_command", error) ? "unsupported" : "error");
  }
}

function mapPlan(raw: unknown): McpImportPlan {
  const plan = asRecord(raw);
  return {
    planFingerprint: str(plan.planFingerprint),
    items: asArray(plan.items).map(item => {
      const record = asRecord(item);
      return {
        candidateId: str(record.candidateId),
        displayName: str(record.displayName) || str(record.candidateId),
        transport: str(record.transport),
        proposedNativeId: str(record.proposedNativeId),
        disposition: str(record.disposition),
        reasonCode: str(record.reasonCode),
      };
    }),
  };
}

/** An item the host will copy: eligible as is, or under an automatic rename. */
export function mcpItemSelectable(item: McpImportItem): boolean {
  return item.disposition === "eligible" || item.disposition === "automatic_rename";
}

/** The message key that states one item's disposition. */
export function mcpItemStateKey(item: McpImportItem): string {
  switch (item.disposition) {
    case "eligible":
      return "settings.externalImports.state.ready";
    case "automatic_rename":
      return "settings.externalImports.state.readyRename";
    case "already_imported":
      return "settings.externalImports.state.imported";
    default:
      return item.reasonCode === "external_mcp.import_setup_required"
        ? "settings.externalImports.state.setupRequired"
        : "settings.externalImports.state.unavailable";
  }
}

/**
 * Copies MCP servers into OpenBitFun: one item, or every selectable item when
 * `candidateId` is omitted. The host answers `stale` when the source or the
 * destination changed since the plan was read; that plan replaces the drawn one
 * and nothing was copied.
 */
export async function applyMcpImport(candidateId?: string): Promise<void> {
  const plan = mcpImportPlan();
  if (!plan || mcpImportBusy() || !mcpImportSupported()) return;
  const selected = plan.items.filter(item =>
    candidateId ? item.candidateId === candidateId && mcpItemSelectable(item) : mcpItemSelectable(item),
  );
  if (selected.length === 0) {
    externalMcpNotice.set({ tone: "warning", key: "settings.externalImports.batchEmpty" });
    return;
  }
  mcpImportBusy.set(candidateId ?? "*");
  externalMcpNotice.set(null);
  try {
    const result = asRecord(
      await invokeCommand<unknown>("apply_external_mcp_import_command", {
        ...workspaceFields(activeWorkspace()),
        importRequest: {
          schemaVersion: 1,
          planFingerprint: plan.planFingerprint,
          // The host takes at most 256 selections per request.
          selections: selected.slice(0, 256).map(item => ({ candidateId: item.candidateId })),
        },
      }),
    );
    const outcome = asRecord(result.outcome);
    if (outcome.status === "stale") {
      mcpImportPlan.set(mapPlan(outcome.refreshedPlan));
      externalMcpNotice.set({ tone: "warning", key: "settings.externalImports.stale" });
      return;
    }
    const imported = asArray(outcome.imported).map(item => str(asRecord(item).candidateId));
    const names = plan.items
      .filter(item => imported.includes(item.candidateId))
      .map(item => item.displayName);
    externalMcpNotice.set({
      tone: "success",
      key: "settings.externalImports.importSuccess",
      name: names.join(", ") || selected.map(item => item.displayName).join(", "),
    });
    await loadMcpImportPlan();
  } catch (error) {
    externalMcpNotice.set({
      tone: "danger",
      key: isCommandMissing("apply_external_mcp_import_command", error)
        ? "settings.externalImports.importUnsupported"
        : "settings.externalImports.importFailed",
    });
  } finally {
    mcpImportBusy.set(null);
  }
}

/** The ecosystems whose removed sessions are listed: the host's, limited to the ones with session import. */
export function sessionEcosystems(): string[] {
  const snapshot = externalSnapshot();
  const ids = snapshot ? snapshot.ecosystems.map(item => item.id) : [];
  const known = ids.filter(id => id in EXTERNAL_SESSION_NAMES);
  return known.length > 0 ? known : Object.keys(EXTERNAL_SESSION_NAMES);
}

/**
 * Lists the source sessions removed from the session list, for every ecosystem
 * the host imports sessions from. They belong to the host that owns them, so in
 * Peer Device Mode the list is not read at all (the desktop does the same).
 */
export async function loadRemovedSessions(): Promise<void> {
  const ticket = ++removedTicket;
  removedRestoreFailed.set(null);
  if (peerScope()) {
    removedSessions.set([]);
    removedSessionsState.set("unsupportedSurface");
    return;
  }
  removedSessionsState.set("loading");
  const rows: RemovedExternalSessionRow[] = [];
  let missing = 0;
  const ecosystems = sessionEcosystems();
  for (const ecosystemId of ecosystems) {
    try {
      const list = await invokeCommand<unknown>("list_removed_external_sessions", { ecosystemId });
      for (const item of asArray(list)) {
        const record = asRecord(item);
        rows.push({
          ecosystemId: str(record.ecosystemId) || ecosystemId,
          sessionId: str(record.sessionId),
          sessionName: str(record.sessionName) || str(record.sessionId),
          workspaceId: str(record.workspaceId),
          workspaceName: str(record.workspaceName),
        });
      }
    } catch (error) {
      if (ticket !== removedTicket) return;
      if (isCommandMissing("list_removed_external_sessions", error)) {
        missing += 1;
        break;
      }
      // An ecosystem this host build has no importer for is refused as
      // `unsupported`; the others still list.
      if (parseOperationError(error)?.code === "unsupported") continue;
      removedSessions.set([]);
      removedSessionsState.set("error");
      return;
    }
  }
  if (ticket !== removedTicket) return;
  if (missing > 0) {
    removedSessions.set([]);
    removedSessionsState.set("unsupportedHost");
    return;
  }
  removedSessions.set(rows);
  removedSessionsState.set("ready");
}

export function removedSessionKey(row: RemovedExternalSessionRow): string {
  return `${row.ecosystemId}|${row.workspaceId}|${row.sessionId}`;
}

/** Puts one removed source session back into its workspace's session list. */
export async function restoreRemovedSession(row: RemovedExternalSessionRow): Promise<void> {
  if (removedRestoreBusy() || peerScope()) return;
  const key = removedSessionKey(row);
  removedRestoreBusy.set(key);
  removedRestoreFailed.set(null);
  try {
    await invokeCommand<unknown>("restore_removed_external_session", {
      ecosystemId: row.ecosystemId,
      targetWorkspaceId: row.workspaceId,
      sessionId: row.sessionId,
    });
    removedSessions.update(current => current.filter(item => removedSessionKey(item) !== key));
  } catch {
    // The host keeps the removal record; the row stays so the user can retry.
    removedRestoreFailed.set(key);
  } finally {
    removedRestoreBusy.set(null);
  }
}

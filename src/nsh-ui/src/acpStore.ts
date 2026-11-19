// External agents (ACP clients): the CLIs OpenBitFun can drive over the Agent
// Client Protocol, and the stored document that configures them.
//
// The desktop page is a large surface — a local registry, a per-SSH-host
// registry, install flows, requirement probes and a JSON editor. This surface
// keeps the parts that need no remote host: the client list, the requirement
// probe that tells a user why a client cannot run, stop/install for one client,
// and the whole stored document (which is where a client this surface does not
// draw is still edited). Per-connection install state is not drawn; the probe
// and the list report this machine only.

import { signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { errorText, invokeSettingsMutation } from "./settingsMutations";
import { runStep } from "./state";

/** One client, as `get_acp_clients` reports it. */
export interface AcpClient {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  /** The host owns this entry and refuses to let a surface remove it. */
  readonly: boolean;
  status: string;
  permissionMode: string;
  toolName: string;
  sessionCount: number;
}

/** One requirement item a probe checked: the CLI, or the adapter it needs. */
export interface AcpRequirement {
  name: string;
  installed: boolean;
  version: string;
  path: string;
  error: string;
}

/** What a probe reported for one client. */
export interface AcpProbe {
  id: string;
  tool: AcpRequirement | null;
  adapter: AcpRequirement | null;
  runnable: boolean;
  notes: string[];
}

export const acpClients = signal<AcpClient[]>([]);
export const acpProbes = signal<Record<string, AcpProbe>>({});
export const acpSupported = signal<boolean | null>(null);
export const acpNotice = signal("");
export const acpBusy = signal("");
export const acpProbing = signal(false);
/** The stored document, read on demand for the JSON editor. */
export const acpJsonText = signal("");
export const acpJsonOpen = signal(false);
export const acpJsonNotice = signal("");
export const acpJsonDirty = signal(false);

let loaded = false;
let jsonLoaded = false;

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function readClient(entry: unknown): AcpClient | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id = readString(record, ["id", "clientId", "client_id"]);
  if (!id) return null;
  return {
    id,
    name: readString(record, ["name", "displayName", "display_name"]) || id,
    command: readString(record, ["command"]),
    args: Array.isArray(record.args) ? record.args.filter(value => typeof value === "string") : [],
    enabled: record.enabled === true,
    readonly: record.readonly === true,
    status: readString(record, ["status"]) || "stopped",
    permissionMode: readString(record, ["permissionMode", "permission_mode"]),
    toolName: readString(record, ["toolName", "tool_name"]),
    sessionCount: typeof record.sessionCount === "number" ? record.sessionCount : 0,
  };
}

function readRequirement(value: unknown): AcpRequirement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    name: readString(record, ["name"]),
    installed: record.installed === true,
    version: readString(record, ["version"]),
    path: readString(record, ["path"]),
    error: readString(record, ["error"]),
  };
}

function readProbe(entry: unknown): AcpProbe | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id = readString(record, ["id", "clientId", "client_id"]);
  if (!id) return null;
  return {
    id,
    tool: readRequirement(record.tool),
    adapter: readRequirement(record.adapter),
    runnable: record.runnable === true,
    notes: Array.isArray(record.notes) ? record.notes.filter(value => typeof value === "string") : [],
  };
}

/** Reads the client list once; a host without the ACP commands hides the section. */
export function ensureAcp(): void {
  if (loaded) return;
  loaded = true;
  void loadAcpClients();
}

export async function loadAcpClients(): Promise<void> {
  await runStep(async () => {
    try {
      const rows = await invokeCommand<unknown>("get_acp_clients");
      const list = Array.isArray(rows) ? rows : [];
      acpClients.set(list.map(readClient).filter((client): client is AcpClient => client !== null));
      acpSupported.set(true);
      if (!acpNotice()) acpNotice.set("");
    } catch {
      acpSupported.set(false);
      acpClients.set([]);
    }
  });
}

/**
 * Asks the host why each client can or cannot run. `force` re-probes instead of
 * reading the host's cache; the button that says so is the only caller that
 * passes it.
 */
export async function probeAcpClients(force = false): Promise<void> {
  acpProbing.set(true);
  try {
    const rows = await invokeCommand<unknown>("probe_acp_client_requirements", {
      ...(force ? { forceRefresh: true } : {}),
    });
    const list = Array.isArray(rows) ? rows : [];
    const byId: Record<string, AcpProbe> = {};
    for (const entry of list) {
      const probe = readProbe(entry);
      if (probe) byId[probe.id] = probe;
    }
    acpProbes.set(byId);
    acpNotice.set("");
  } catch (error) {
    acpProbes.set({});
    acpNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    acpProbing.set(false);
  }
}

/** Reads the stored document for the JSON editor. */
export async function openAcpJson(): Promise<void> {
  acpJsonOpen.set(true);
  acpJsonNotice.set("");
  if (jsonLoaded) return;
  await runStep(async () => {
    try {
      // A positionless command: the host takes no arguments at all here.
      const text = await invokeCommand<string>("load_acp_json_config");
      acpJsonText.set(typeof text === "string" ? text : "");
      acpJsonDirty.set(false);
      jsonLoaded = true;
    } catch (error) {
      acpJsonNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export function closeAcpJson(): void {
  acpJsonOpen.set(false);
  acpJsonNotice.set("");
  acpJsonDirty.set(false);
  // Closing discards what was typed: the next open reads the stored document
  // again instead of showing the abandoned edit as if it were stored.
  acpJsonText.set("");
  jsonLoaded = false;
}

/** The permission modes a client's tool requests can run under (`ask` or `allow_once`). */
export const ACP_PERMISSION_MODES = ["ask", "allow_once"] as const;

/**
 * Sets one configured client's permission mode through
 * `set_acp_client_permission_mode`: the host changes that one entry, keeps the
 * rest of the stored document, re-initializes the clients and answers with the
 * client list. A host without the command says it needs an update; the JSON
 * editor below stays available for it.
 */
export async function setAcpPermissionMode(clientId: string, mode: string): Promise<void> {
  acpBusy.set(clientId);
  acpNotice.set("");
  try {
    const rows = await invokeSettingsMutation<unknown>("set_acp_client_permission_mode", {
      clientId,
      permissionMode: mode,
    });
    const list = Array.isArray(rows) ? rows : [];
    acpClients.set(list.map(readClient).filter((client): client is AcpClient => client !== null));
    jsonLoaded = false;
    acpNotice.set(`Saved ${clientId}`);
  } catch (error) {
    acpNotice.set(errorText(error));
  } finally {
    acpBusy.set("");
  }
}

export function editAcpJson(text: string): void {
  acpJsonText.set(text);
  acpJsonDirty.set(true);
}

/**
 * Writes the document back. `save_acp_json_config` takes the text as a
 * positional argument, so it goes through the raw path; it has no fingerprint,
 * which is why the editor says the write is whole rather than merged.
 */
export async function saveAcpJson(): Promise<void> {
  acpJsonNotice.set("");
  await runStep(async () => {
    try {
      await invokeRawCommand("save_acp_json_config", { jsonConfig: acpJsonText() });
      acpJsonDirty.set(false);
      acpJsonNotice.set("Saved");
      await loadAcpClients();
      await probeAcpClients(true);
    } catch (error) {
      // A refused write must not read as saved.
      acpJsonNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

async function clientAction(
  action: "stop_acp_client" | "install_acp_client_cli",
  clientId: string,
  label: string,
): Promise<void> {
  acpBusy.set(clientId);
  acpNotice.set("");
  try {
    await invokeCommand<unknown>(action, { clientId });
    acpNotice.set(`${label} ${clientId}`);
    await loadAcpClients();
    await probeAcpClients(true);
  } catch (error) {
    acpNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    acpBusy.set("");
  }
}

/** Stops a running client process. */
export async function stopAcpClient(clientId: string): Promise<void> {
  await clientAction("stop_acp_client", clientId, "Stopped");
}

/** Installs one client's CLI through the host's package manager. */
export async function installAcpClient(clientId: string): Promise<void> {
  await clientAction("install_acp_client_cli", clientId, "Installed");
}

/** The one-line state a row shows: a running client, or why it cannot run. */
export function acpRowStatus(client: AcpClient): string {
  const probe = acpProbes()[client.id];
  if (!probe) return client.status;
  if (probe.runnable) return client.status === "running" ? "running" : "runnable";
  const missing: string[] = [];
  if (probe.tool && !probe.tool.installed) missing.push(probe.tool.name || "cli");
  if (probe.adapter && !probe.adapter.installed) missing.push(probe.adapter.name || "adapter");
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  return probe.notes[0] ?? "not runnable";
}

// Account records (wave24-replica): what this device's lists need from the
// account's records beyond settings.
//
// Display only. The backend keeps the account's quick actions, agents,
// skills, routines, MCP server shapes, SSH profiles, memory, desktop
// cards, pets and bot metadata in the account replica (no server keeps them)
// and answers `device_records_overview` with the few facts a list draws: the
// routines that run on another device, and the SSH, MCP and skill market
// entries that still need a secret on this device. When account items land
// on this device the backend sends `account://records-applied {collection}`
// and the surface re-reads what it draws from the host.
//
// A host without the command has no account records: nothing extra draws.

import { signal } from "nsh";
import { invokeCommand, listenEvent } from "./bridge";
import { loadCompanionPets, loadCompanionSettings } from "./companionStore";
import { tr } from "./i18n";
import { loadMcpDocument, refreshMcpServers } from "./mcpStore";
import { loadQuickActions } from "./quickActionStore";
import { loadRoutines } from "./routinesStore";
import { loadSavedConnections } from "./sshRemoteStore";

export const RECORDS_APPLIED_EVENT = "account://records-applied";

/** A routine of the account that runs on another device. */
export interface AccountRoutineElsewhere {
  id: string;
  name?: string;
  schedule?: unknown;
  enabled?: boolean;
  targetDeviceId?: string;
  targetDeviceName?: string;
}

/** An account entry that needs a secret on this device. */
export interface AccountNeedsSecret {
  id: string;
  /** What is missing (env or header names; `password` or `key` for SSH). */
  missing?: string[];
}

/** Mirror of the desktop `AccountRecordsOverview` (camelCase). */
export interface AccountRecordsOverview {
  attached?: boolean;
  routinesElsewhere?: AccountRoutineElsewhere[];
  mcpNeedsSecrets?: AccountNeedsSecret[];
  sshNeedsSecrets?: AccountNeedsSecret[];
  skillMarketsNeedToken?: string[];
}

export const accountRecords = signal<AccountRecordsOverview | null>(null);

const appliedListeners = new Set<(collection: string) => void>();

/** Runs `listener` after account items of a collection landed here. */
export function onAccountRecordsApplied(listener: (collection: string) => void): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  listenEvent<{ collection?: unknown }>(RECORDS_APPLIED_EVENT, payload => {
    const collection = typeof payload?.collection === "string" ? payload.collection : "";
    for (const listener of appliedListeners) {
      try {
        listener(collection);
      } catch (error) {
        console.warn(`Applying account records failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    void loadAccountRecords();
  });
}

/** Reads the overview (and follows applies once). A host without it draws nothing extra. */
export async function loadAccountRecords(): Promise<void> {
  subscribe();
  try {
    const overview = await invokeCommand<AccountRecordsOverview>("device_records_overview", {});
    accountRecords.set(overview && typeof overview === "object" ? overview : null);
  } catch {
    accountRecords.set(null);
  }
}

/** The account's routines that run on another device, as the backend lists them. */
export function routinesElsewhere(): AccountRoutineElsewhere[] {
  const list = accountRecords()?.routinesElsewhere;
  return Array.isArray(list) ? list.filter(item => item && typeof item.id === "string") : [];
}

/** "Runs on {device}" for a routine of another device. */
export function routineRunsOnLabel(routine: AccountRoutineElsewhere): string {
  const device = routine.targetDeviceName || routine.targetDeviceId || "";
  return tr("accountRecords.routinesElsewhere.runsOn", { device });
}

function missingFor(list: AccountNeedsSecret[] | undefined, id: string): string[] {
  const entry = (Array.isArray(list) ? list : []).find(item => item?.id === id);
  return Array.isArray(entry?.missing) ? entry!.missing!.map(String) : [];
}

/** The note under an MCP server that still needs a secret here ("" when none). */
export function mcpSecretsNote(serverId: string): string {
  const missing = missingFor(accountRecords()?.mcpNeedsSecrets, serverId);
  return missing.length ? tr("accountRecords.mcp.needsSecret", { names: missing.join(", ") }) : "";
}

/** The note under an SSH profile that still needs its password or key here ("" when none). */
export function sshSecretNote(connectionId: string): string {
  const missing = missingFor(accountRecords()?.sshNeedsSecrets, connectionId);
  if (missing.includes("password")) return tr("accountRecords.ssh.needsPassword");
  if (missing.includes("key")) return tr("accountRecords.ssh.needsKey");
  return "";
}

/** What each collection's apply re-reads (cards follow their own event). */
const RELOADERS: Record<string, () => void> = {
  quick_actions: () => void loadQuickActions(),
  pets: () => {
    void loadCompanionSettings();
    void loadCompanionPets();
  },
  "mcp.servers": () => {
    void refreshMcpServers();
    void loadMcpDocument();
  },
  "ssh.profiles": () => void loadSavedConnections(),
  routines: () => void loadRoutines(),
};

let initialized = false;

/** Follows applies: re-reads the lists an account apply changed. */
export function initAccountRecords(): void {
  if (initialized) return;
  initialized = true;
  onAccountRecordsApplied(collection => RELOADERS[collection]?.());
  subscribe();
}

// Saved terminal profiles: a shell plus the command it starts with, kept per
// workspace so the next window can open the same terminal again.
//
// The host owns the list (`terminal.profiles` in its config, keyed by workspace
// id) and its rules: a name is required and unique per workspace, the host
// mints ids, and a workspace keeps at most `maxProfiles`. This surface renders
// what `get_terminal_profiles` / `upsert_terminal_profile` /
// `delete_terminal_profile` answer, so every client of one backend (this
// window, a browser, a phone, a controlling desktop) sees the same list.
//
// Earlier builds kept the list in this surface's storage under
// `openbitfun.nsh.terminal-profiles.v1`, keyed `id:<device>:<workspaceId>` or by
// the bare workspace root. The first time a workspace's list is read here, the
// entries for it are handed to the host once (`import_terminal_profiles`) and
// then forgotten. A host without these commands gets an explicit "update the
// host" state: the stored rows still open, but nothing new is saved locally.

import { Storage, signal } from "nsh";
import { invokeCommand } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import { tr } from "./i18n";
import { activeWorkspaceId, activeWorkspaceRoot, onWorkspaceChanged } from "./state";

export interface TerminalProfile {
  id: string;
  /** What the profile is called in the list. */
  name: string;
  /** The discovered shell this profile starts, by its own id. */
  shellId: string;
  /** A plain shell type name, for a host that names shells rather than numbering them. */
  shellType: string;
  /** Written into the shell once it is up, without the trailing newline. */
  startupCommand: string;
}

interface HostProfilesAnswer {
  workspaceId?: string;
  profiles?: TerminalProfile[];
  maxProfiles?: number;
  id?: string;
}

export type ProfileNoticeTone = "success" | "neutral" | "warning";

const LEGACY_STORAGE_KEY = "openbitfun.nsh.terminal-profiles.v1";

/** Profiles by `<scope>|<workspaceId>`, as the host answered them. */
export const terminalProfiles = signal<Record<string, TerminalProfile[]>>({});
export const profileNotice = signal("");
export const profileNoticeKind = signal<ProfileNoticeTone>("neutral");
/** The profile being edited, or `null` while the list is closed. */
export const profileDraft = signal<TerminalProfile | null>(null);
/** Scopes (this backend, or a Peer) whose host has no profile commands. */
const outdatedScopes = signal<Record<string, boolean>>({});

/** True when the current host has no profile commands (an older build): saving is off and says why. */
export function profilesHostOutdated(): boolean {
  return outdatedScopes()[scopeKey()] === true;
}

function markHostOutdated(outdated: boolean): void {
  const scope = scopeKey();
  outdatedScopes.update(current => (current[scope] === outdated ? current : { ...current, [scope]: outdated }));
}

let workspaceHookBound = false;
const loadsInFlight = new Map<string, Promise<void>>();

function scopeKey(): string {
  return "local";
}

function listKey(workspaceId: string): string {
  return `${scopeKey()}|${workspaceId}`;
}

function setNotice(message: string, tone: ProfileNoticeTone): void {
  profileNotice.set(message);
  profileNoticeKind.set(tone);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/** The host's rule violations carry a stable code before the colon. */
function hostRuleMessage(error: unknown, name: string): string {
  const raw = errorText(error);
  if (raw.includes("terminal_profile_name_required")) return tr("terminal.profiles.nameRequired");
  if (raw.includes("terminal_profile_name_taken")) return tr("terminal.profiles.nameTaken", { name });
  if (raw.includes("terminal_profile_limit")) {
    const max = /terminal_profile_limit:\s*(\d+)/.exec(raw)?.[1] ?? "20";
    return tr("terminal.profiles.limit", { max });
  }
  return tr("terminal.profiles.failed", { error: raw });
}

function cleanRows(value: unknown): TerminalProfile[] {
  if (!Array.isArray(value)) return [];
  const rows: TerminalProfile[] = [];
  for (const entry of value) {
    const profile = entry as Partial<TerminalProfile>;
    if (typeof profile?.id !== "string" || typeof profile?.name !== "string") continue;
    if (!profile.name.trim()) continue;
    rows.push({
      id: profile.id,
      name: profile.name,
      shellId: typeof profile.shellId === "string" ? profile.shellId : "",
      shellType: typeof profile.shellType === "string" ? profile.shellType : "",
      startupCommand: typeof profile.startupCommand === "string" ? profile.startupCommand : "",
    });
  }
  return rows;
}

function storeAnswer(workspaceId: string, answer: HostProfilesAnswer | null | undefined): void {
  const key = listKey(answer?.workspaceId || workspaceId);
  const rows = cleanRows(answer?.profiles);
  terminalProfiles.update(current => ({ ...current, [key]: rows }));
}

async function readLegacyStorage(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await Storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writeLegacyStorage(map: Record<string, unknown>): Promise<void> {
  try {
    if (Object.keys(map).length === 0) await Storage.removeItem(LEGACY_STORAGE_KEY);
    else await Storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // The rows were imported; a leftover copy is only read again, never re-imported twice
    // into one workspace (the host skips names it already keeps).
  }
}

/** The stored rows an earlier build kept for this workspace, and the keys they sit under. */
function legacyRowsFor(
  map: Record<string, unknown>,
  workspaceId: string,
  root: string,
): { keys: string[]; rows: TerminalProfile[] } {
  const keys: string[] = [];
  const rows: TerminalProfile[] = [];
  const idKey = `id:${scopeKey()}:${workspaceId}`;
  for (const key of [idKey, root]) {
    if (!key || !(key in map)) continue;
    keys.push(key);
    for (const row of cleanRows(map[key])) {
      if (!rows.some(existing => existing.name === row.name)) rows.push(row);
    }
  }
  return { keys, rows };
}

async function migrateLegacy(workspaceId: string, root: string): Promise<boolean> {
  const map = await readLegacyStorage();
  if (!map) return true;
  const { keys, rows } = legacyRowsFor(map, workspaceId, root);
  if (keys.length === 0) return true;
  if (rows.length > 0) {
    const answer = await invokeCommand<HostProfilesAnswer>("import_terminal_profiles", {
      workspaceId,
      profiles: rows,
    });
    storeAnswer(workspaceId, answer);
  }
  // Handed to the host: forget them here.
  const fresh = (await readLegacyStorage()) ?? {};
  for (const key of keys) delete fresh[key];
  await writeLegacyStorage(fresh);
  return true;
}

async function loadFor(workspaceId: string, root: string): Promise<void> {
  try {
    await migrateLegacy(workspaceId, root);
    const answer = await invokeCommand<HostProfilesAnswer>("get_terminal_profiles", { workspaceId });
    markHostOutdated(false);
    storeAnswer(workspaceId, answer);
  } catch (error) {
    if (
      isCommandUnavailable(error, "import_terminal_profiles") ||
      isCommandUnavailable(error, "get_terminal_profiles")
    ) {
      // An older host: show what an earlier build stored, read-only, and say why.
      markHostOutdated(true);
      const map = (await readLegacyStorage()) ?? {};
      terminalProfiles.update(current => ({
        ...current,
        [listKey(workspaceId)]: legacyRowsFor(map, workspaceId, root).rows,
      }));
      return;
    }
    setNotice(tr("terminal.profiles.failed", { error: errorText(error) }), "warning");
  }
}

/** Reads the active workspace's profiles from the host (once per workspace and scope). */
export async function loadTerminalProfiles(): Promise<void> {
  if (!workspaceHookBound) {
    workspaceHookBound = true;
    onWorkspaceChanged(() => void loadTerminalProfiles());
  }
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  const key = listKey(workspaceId);
  if (terminalProfiles()[key]) return;
  const running = loadsInFlight.get(key);
  if (running) return running;
  const flight = loadFor(workspaceId, activeWorkspaceRoot()).finally(() => loadsInFlight.delete(key));
  loadsInFlight.set(key, flight);
  return flight;
}

/** The active workspace's profiles, as the host keeps them. */
export function profilesFor(_root: string | null): TerminalProfile[] {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return [];
  return terminalProfiles()[listKey(workspaceId)] ?? [];
}

export function openProfileDraft(shellId: string, shellType: string): void {
  const count = profilesFor(activeWorkspaceRoot()).length + 1;
  profileDraft.set({
    id: "",
    name: `Terminal ${count}`,
    shellId,
    shellType,
    startupCommand: "",
  });
  if (profilesHostOutdated()) setNotice(tr("terminal.profiles.hostOutdated"), "warning");
  else setNotice("", "neutral");
}

export function closeProfileDraft(): void {
  profileDraft.set(null);
}

export function updateProfileDraft(patch: Partial<TerminalProfile>): void {
  profileDraft.update(current => (current ? { ...current, ...patch } : current));
}

export async function saveProfileDraft(): Promise<void> {
  const draft = profileDraft();
  const workspaceId = activeWorkspaceId();
  if (!draft || !workspaceId) return;
  if (profilesHostOutdated()) {
    setNotice(tr("terminal.profiles.hostOutdated"), "warning");
    return;
  }
  const name = draft.name.trim();
  let answer: HostProfilesAnswer;
  try {
    answer = await invokeCommand<HostProfilesAnswer>("upsert_terminal_profile", {
      workspaceId,
      profile: {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        shellId: draft.shellId,
        shellType: draft.shellType,
        startupCommand: draft.startupCommand,
      },
    });
  } catch (error) {
    if (isCommandUnavailable(error, "upsert_terminal_profile")) {
      markHostOutdated(true);
      setNotice(tr("terminal.profiles.hostOutdated"), "warning");
      return;
    }
    setNotice(hostRuleMessage(error, name), "warning");
    return;
  }
  storeAnswer(workspaceId, answer);
  const saved = profilesFor(activeWorkspaceRoot()).find(profile => profile.id === answer?.id);
  // The panel stays open so the list and the confirmation are both readable; the
  // form is cleared for the next profile.
  profileDraft.set({
    id: "",
    name: `Terminal ${profilesFor(activeWorkspaceRoot()).length + 1}`,
    shellId: draft.shellId,
    shellType: draft.shellType,
    startupCommand: "",
  });
  setNotice(tr("terminal.profiles.saved", { name: saved?.name ?? name }), "success");
}

export async function deleteProfile(profileId: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  if (profilesHostOutdated()) {
    setNotice(tr("terminal.profiles.hostOutdated"), "warning");
    return;
  }
  try {
    const answer = await invokeCommand<HostProfilesAnswer>("delete_terminal_profile", {
      workspaceId,
      profileId,
    });
    storeAnswer(workspaceId, answer);
    setNotice(tr("terminal.profiles.deleted"), "neutral");
  } catch (error) {
    if (isCommandUnavailable(error, "delete_terminal_profile")) {
      markHostOutdated(true);
      setNotice(tr("terminal.profiles.hostOutdated"), "warning");
      return;
    }
    setNotice(tr("terminal.profiles.failed", { error: errorText(error) }), "warning");
  }
}

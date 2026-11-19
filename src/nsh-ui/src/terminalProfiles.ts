// Saved terminal profiles: a shell plus the command it starts with, kept per
// workspace so the next window can open the same terminal again.
//
// The desktop surface stores its own profiles under a key that includes the
// device surface and the workspace; those entries name a chat session, which is
// how its terminal panel binds a tab. This surface's tabs are host terminal
// sessions, so writing there would hand the desktop records it cannot resolve.
// The list is therefore this surface's own file. Entries are keyed by device and
// workspace id (`id:<device>:<workspaceId>`), the identity the desktop keys its
// own profiles by, so two workspaces at the same path (a local folder and an SSH
// host's) never share a list. Lists written by older builds under the bare
// workspace root are still read until the workspace saves under its id; they
// are never deleted.

import { Storage, signal } from "nsh";
import { peerScope } from "./peerState";
import { activeWorkspaceId, activeWorkspaceRoot } from "./state";

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

const STORAGE_KEY = "openbitfun.nsh.terminal-profiles.v1";
const MAX_PROFILES = 20;

/** Profiles by workspace key (or a legacy root); a workspace without an entry has none. */
export const terminalProfiles = signal<Record<string, TerminalProfile[]>>({});
export const profileNotice = signal("");
/** The profile being edited, or `null` while the list is closed. */
export const profileDraft = signal<TerminalProfile | null>(null);

let loaded = false;
let nextId = 1;

export async function loadTerminalProfiles(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const restored: Record<string, TerminalProfile[]> = {};
    for (const [root, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const rows: TerminalProfile[] = [];
      for (const entry of value) {
        const profile = entry as Partial<TerminalProfile>;
        if (typeof profile?.id !== "string" || typeof profile?.name !== "string") continue;
        if (!profile.name.trim()) continue;
        if (typeof profile.shellId !== "string" || typeof profile.shellType !== "string") continue;
        if (typeof profile.startupCommand !== "string") continue;
        rows.push({
          id: profile.id,
          name: profile.name,
          shellId: profile.shellId,
          shellType: profile.shellType,
          startupCommand: profile.startupCommand,
        });
      }
      if (rows.length) restored[root] = rows;
    }
    terminalProfiles.set(restored);
  } catch {
    // An unreadable file just means no profiles yet; opening shells still works.
  }
}

function persist(): void {
  void Storage.setItem(STORAGE_KEY, JSON.stringify(terminalProfiles())).catch(() => {
    // Without storage the list works for this run and no other.
  });
}

function workspaceProfileKey(): string | null {
  const id = activeWorkspaceId();
  return id ? `id:${peerScope()?.deviceId ?? "local"}:${id}` : null;
}

/** The active workspace's profiles: its id entry, else the legacy entry under its root. */
export function profilesFor(root: string | null): TerminalProfile[] {
  const key = workspaceProfileKey();
  const map = terminalProfiles();
  if (key && map[key]) return map[key];
  if (!root) return [];
  return map[root] ?? [];
}

function writeProfiles(next: TerminalProfile[]): void {
  const key = workspaceProfileKey();
  if (!key) return;
  terminalProfiles.update(current => ({ ...current, [key]: next }));
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
  profileNotice.set("");
}

export function closeProfileDraft(): void {
  profileDraft.set(null);
}

export function updateProfileDraft(patch: Partial<TerminalProfile>): void {
  profileDraft.update(current => (current ? { ...current, ...patch } : current));
}

export async function saveProfileDraft(): Promise<void> {
  const draft = profileDraft();
  const root = activeWorkspaceRoot();
  if (!draft || !root) return;
  if (!draft.name.trim()) {
    profileNotice.set("A profile needs a name");
    return;
  }
  const existing = profilesFor(root);
  if (existing.some(profile => profile.name === draft.name.trim() && profile.id !== draft.id)) {
    profileNotice.set(`A profile named ${draft.name.trim()} already exists`);
    return;
  }
  if (!draft.id && existing.length >= MAX_PROFILES) {
    profileNotice.set(`${MAX_PROFILES} profiles are enough for one workspace; delete one first`);
    return;
  }
  const saved: TerminalProfile = {
    id: draft.id || `profile-${Date.now().toString(36)}-${nextId++}`,
    name: draft.name.trim(),
    shellId: draft.shellId,
    shellType: draft.shellType,
    startupCommand: draft.startupCommand.trim(),
  };
  const next = draft.id
    ? existing.map(profile => (profile.id === draft.id ? saved : profile))
    : [...existing, saved];
  writeProfiles(next);
  // The panel stays open so the list and the confirmation are both readable; the
  // form is cleared for the next profile.
  profileDraft.set({
    id: "",
    name: `Terminal ${next.length + 1}`,
    shellId: saved.shellId,
    shellType: saved.shellType,
    startupCommand: "",
  });
  profileNotice.set(`Saved ${saved.name}`);
  persist();
}

export function deleteProfile(profileId: string): void {
  const root = activeWorkspaceRoot();
  if (!root) return;
  const next = profilesFor(root).filter(profile => profile.id !== profileId);
  writeProfiles(next);
  profileNotice.set("Profile deleted");
  persist();
}

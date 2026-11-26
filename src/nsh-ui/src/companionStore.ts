// The companion pet (tauri-gap §1.5, §4.4): the ambient face of the fleet's
// attention on the desktop app. Its settings are this device's
// `app.ai_experience` values (`enable_agent_companion`, `agent_companion_pet`,
// `enable_desktop_cards`), its characters come from `list_agent_companion_pets`
// (built-in sets plus the user's imports), their pictures in a picker from
// `load_agent_companion_pet_still` and the shown pet's frames from
// `load_agent_companion_pet_spritesheet`.
//
// What the pet shows is the Inbox's own state: the first non-empty group the
// backend ranks first in `fleet_attention` (needs you, failed, done), else
// working while the navigator counts running sessions, else rest. So a job
// that needs you on another machine wakes the pet on this one. The store maps
// that state onto a sprite row and draws nothing else into it.

import { computed, signal, untracked } from "nsh";
import { attentionGroups } from "./attentionStore";
import { errorMessageOf } from "./backendConnection";
import { entryDeviceId, fleetActive, invokeCommand, windowShellId } from "./bridge";
import { fleetDevices, fleetTotals } from "./fleetStore";
import { tr } from "./i18n";
import { acknowledgedAt, statusOfSession } from "./sessionStatusStore";
import { deviceContext, isSessionArchived, runningTurns, sessionKey, sessionLastActivityMs, sessions } from "./state";
import type { MarkState } from "./ui/fleet";

export const COMPANION_ENABLED_PATH = "app.ai_experience.enable_agent_companion";
export const COMPANION_PET_PATH = "app.ai_experience.agent_companion_pet";
export const DESKTOP_CARDS_ENABLED_PATH = "app.ai_experience.enable_desktop_cards";

/** A pet package as the host lists it (`PetPackage`). */
export interface CompanionPet {
  id: string;
  displayName: string;
  description?: string | null;
  /** `builtin` (ships with the app) or `user` (imported). */
  source: string;
  packagePath: string;
  spritesheetPath: string;
  spritesheetMimeType: string;
  spriteVersionNumber?: number | null;
}

/** Petdex keeps the first nine animation rows stable across sprite v1 and v2. */
export const PET_ROW_FRAMES: ReadonlyArray<number> = [6, 8, 8, 4, 5, 8, 6, 6, 6];
export const PET_COLUMNS = 8;
/** How long one sprite frame shows. */
export const PET_FRAME_MS = 160;

/** The sprite row each attention state plays. */
const ROW_BY_STATE: Partial<Record<MarkState, number>> = {
  idle: 0,
  done: 4,
  failed: 5,
  needs_you: 6,
  waiting: 6,
  working: 7,
  thinking: 8,
};

export function petRows(version: number | null | undefined): number {
  return version === 2 ? 11 : 9;
}

export function petRowFor(state: MarkState): number {
  return ROW_BY_STATE[state] ?? 0;
}

// ── Settings ────────────────────────────────────────────────────────────────

export const companionEnabled = signal<boolean | null>(null);
export const desktopCardsEnabled = signal<boolean | null>(null);
export const selectedPet = signal<CompanionPet | null>(null);
export const companionPets = signal<CompanionPet[] | null>(null);
export const companionNotice = signal("");
export const companionBusy = signal<string | null>(null);

/** The pet and cards live in the native desktop app only. */
export function companionAvailableHere(): boolean {
  return windowShellId() === "nsh-desktop";
}

function readPet(value: unknown): CompanionPet | null {
  if (!value || typeof value !== "object") return null;
  const pet = value as Partial<CompanionPet>;
  if (typeof pet.id !== "string" || typeof pet.spritesheetPath !== "string") return null;
  return {
    id: pet.id,
    displayName: typeof pet.displayName === "string" ? pet.displayName : pet.id,
    description: pet.description ?? null,
    source: typeof pet.source === "string" ? pet.source : "user",
    packagePath: typeof pet.packagePath === "string" ? pet.packagePath : "",
    spritesheetPath: pet.spritesheetPath,
    spritesheetMimeType: typeof pet.spritesheetMimeType === "string" ? pet.spritesheetMimeType : "image/webp",
    spriteVersionNumber: typeof pet.spriteVersionNumber === "number" ? pet.spriteVersionNumber : null,
  };
}

/** Companion pet & desktop cards belong to this local desktop (`entryDeviceId()`), never a remote peer. */
function localTarget(): { target: string } | undefined {
  if (!fleetActive()) return undefined;
  const entry = entryDeviceId();
  return entry ? { target: entry } : undefined;
}

/** Reads the three settings once more. */
export async function loadCompanionSettings(): Promise<void> {
  const target = localTarget();
  try {
    const [enabled, pet, cards] = await Promise.all([
      invokeCommand<unknown>("get_config", { path: COMPANION_ENABLED_PATH, skipRetryOnNotFound: true }, target),
      invokeCommand<unknown>("get_config", { path: COMPANION_PET_PATH, skipRetryOnNotFound: true }, target),
      invokeCommand<unknown>("get_config", { path: DESKTOP_CARDS_ENABLED_PATH, skipRetryOnNotFound: true }, target),
    ]);
    companionEnabled.set(enabled !== false);
    selectedPet.set(readPet(pet));
    desktopCardsEnabled.set(cards !== false);
  } catch (error) {
    companionNotice.set(errorMessageOf(error));
  }
}

/** Lists the characters (built-in first, as the host orders them). */
export async function loadCompanionPets(): Promise<void> {
  try {
    const answer = await invokeCommand<{ pets?: unknown[] }>("list_agent_companion_pets", {});
    companionPets.set((answer?.pets ?? []).map(readPet).filter((pet): pet is CompanionPet => pet !== null));
  } catch (error) {
    companionPets.set([]);
    companionNotice.set(errorMessageOf(error));
  }
}

async function write(path: string, value: unknown, busy: string): Promise<boolean> {
  companionBusy.set(busy);
  companionNotice.set("");
  try {
    await invokeCommand<unknown>("set_config", { path, value }, localTarget());
    return true;
  } catch (error) {
    companionNotice.set(errorMessageOf(error));
    return false;
  } finally {
    companionBusy.set(null);
  }
}

export async function setCompanionEnabled(enabled: boolean): Promise<void> {
  if (await write(COMPANION_ENABLED_PATH, enabled, "enabled")) companionEnabled.set(enabled);
}

export async function setDesktopCardsEnabled(enabled: boolean): Promise<void> {
  if (await write(DESKTOP_CARDS_ENABLED_PATH, enabled, "cards")) desktopCardsEnabled.set(enabled);
}

export async function selectCompanionPet(pet: CompanionPet): Promise<void> {
  const selection = {
    id: pet.id,
    displayName: pet.displayName,
    ...(pet.description ? { description: pet.description } : {}),
    source: pet.source,
    packagePath: pet.packagePath,
    spritesheetPath: pet.spritesheetPath,
    spritesheetMimeType: pet.spritesheetMimeType,
    ...(typeof pet.spriteVersionNumber === "number" ? { spriteVersionNumber: pet.spriteVersionNumber } : {}),
  };
  if (await write(COMPANION_PET_PATH, selection, `select:${pet.id}`)) selectedPet.set(pet);
}

/** Imports a `.zip` pack the user picked (its bytes, base64). */
export async function importCompanionPetArchive(name: string, base64: string): Promise<void> {
  companionBusy.set("import");
  companionNotice.set("");
  try {
    const pet = readPet(
      await invokeCommand<unknown>("import_agent_companion_pet_package", { path: "", archiveBase64: base64, archiveName: name }),
    );
    await loadCompanionPets();
    if (pet) await selectCompanionPet(pet);
  } catch (error) {
    companionNotice.set(errorMessageOf(error));
  } finally {
    companionBusy.set(null);
  }
}

/** Imports an unpacked Petdex folder on this device. */
export async function importCompanionPetFolder(path: string): Promise<void> {
  companionBusy.set("import");
  companionNotice.set("");
  try {
    const pet = readPet(await invokeCommand<unknown>("import_agent_companion_pet_package", { path }));
    await loadCompanionPets();
    if (pet) await selectCompanionPet(pet);
  } catch (error) {
    companionNotice.set(errorMessageOf(error));
  } finally {
    companionBusy.set(null);
  }
}

export async function deleteCompanionPet(pet: CompanionPet): Promise<void> {
  companionBusy.set(`delete:${pet.id}`);
  companionNotice.set("");
  try {
    await invokeCommand<void>("delete_agent_companion_pet_package", { packagePath: pet.packagePath });
    await loadCompanionPets();
    // The host falls back to its default when the selection is gone.
    if (selectedPet()?.packagePath === pet.packagePath) await loadCompanionSettings();
  } catch (error) {
    companionNotice.set(errorMessageOf(error));
  } finally {
    companionBusy.set(null);
  }
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** Rest-pose stills as data URLs, by package path: a few KB each, read once per run. */
export const petStills = signal<Record<string, string>>({});
export const petStillErrors = signal<Record<string, string>>({});
const loadingStills = new Set<string>();

/** Reads one pet's still through the host. */
export async function loadPetStill(packagePath: string): Promise<void> {
  if (petStills()[packagePath] || loadingStills.has(packagePath)) return;
  loadingStills.add(packagePath);
  try {
    const answer = await invokeCommand<{ mimeType?: string; base64?: string }>("load_agent_companion_pet_still", {
      packagePath,
    });
    if (!answer?.base64) throw new Error("The pet still is empty");
    petStills.set({ ...petStills(), [packagePath]: `data:${answer.mimeType ?? "image/png"};base64,${answer.base64}` });
  } catch (error) {
    petStillErrors.set({ ...petStillErrors(), [packagePath]: errorMessageOf(error) });
  } finally {
    loadingStills.delete(packagePath);
  }
}

// ── Frames ──────────────────────────────────────────────────────────────────

/**
 * Spritesheets as data URLs, by spritesheet path. Only the pet window draws
 * them, so only the chosen pet's is kept (a decoded sheet is about 11 MB).
 */
export const petSheets = signal<Record<string, string>>({});
export const petSheetErrors = signal<Record<string, string>>({});
const loadingSheets = new Set<string>();

/** Reads one spritesheet through the host. */
export async function loadPetSheet(spritesheetPath: string): Promise<void> {
  if (!spritesheetPath || petSheets()[spritesheetPath] || loadingSheets.has(spritesheetPath)) return;
  loadingSheets.add(spritesheetPath);
  try {
    const answer = await invokeCommand<{ mimeType?: string; base64?: string }>("load_agent_companion_pet_spritesheet", {
      spritesheetPath,
    });
    if (!answer?.base64) throw new Error("The spritesheet is empty");
    const next = { [spritesheetPath]: `data:${answer.mimeType ?? "image/webp"};base64,${answer.base64}` };
    const chosen = selectedPet()?.spritesheetPath;
    const kept = chosen ? petSheets()[chosen] : undefined;
    if (chosen && kept) next[chosen] = kept;
    petSheets.set(next);
  } catch (error) {
    petSheetErrors.set({ ...petSheetErrors(), [spritesheetPath]: errorMessageOf(error) });
  } finally {
    loadingSheets.delete(spritesheetPath);
  }
}

/** Frees the spritesheets once no pet is to be shown. */
export function releasePetSheets(): void {
  untracked(() => {
    if (Object.keys(petSheets()).length > 0) petSheets.set({});
  });
}

// ── What the pet shows ───────────────────────────────────────────────────────

/** Maximum number of session bubbles shown on the left of the companion pet. */
export const MAX_PET_BUBBLES = 2;

export type PetBubbleState = "needs_you" | "running" | "failed" | "unread";

export interface PetSessionBubble {
  /** Stable deduplication key: `${deviceId}/${sessionId}` or `cloud/${conversationId}`. */
  key: string;
  deviceId: string;
  deviceName?: string;
  workspaceId?: string;
  sessionId?: string;
  conversationId?: string;
  title: string;
  state: PetBubbleState;
  /** Latest known activity timestamp (ms) used for ordering and dismissal re-arming. */
  activityMs: number;
}

type PetBubbleDismissBucket = "active" | "notice";

interface PetBubbleDismissRecord {
  bucket: PetBubbleDismissBucket;
  activityMs: number;
}

const PET_BUBBLE_PRIORITY: Readonly<Record<PetBubbleState, number>> = {
  needs_you: 0,
  running: 1,
  failed: 2,
  unread: 3,
};

function petBubbleDismissBucket(state: PetBubbleState): PetBubbleDismissBucket {
  return state === "running" ? "active" : "notice";
}

const dismissedPetBubbles = signal<Record<string, PetBubbleDismissRecord>>({});

function isBubbleDismissed(
  bubble: PetSessionBubble,
  dismissed: Record<string, PetBubbleDismissRecord>,
): boolean {
  const rec = dismissed[bubble.key];
  if (!rec) return false;
  if (rec.bucket !== petBubbleDismissBucket(bubble.state)) return false;
  return bubble.activityMs <= rec.activityMs;
}

/**
 * All active (running / waiting) and unread sessions across the fleet (and
 * local single-device state), deduplicated and sorted by urgency then recency.
 */
const candidatePetBubbles = computed<PetSessionBubble[]>(() => {
  const byKey = new Map<string, PetSessionBubble>();
  const acked = acknowledgedAt();
  const running = runningTurns();
  const devices = fleetDevices();
  const multiDevice = devices.length > 1;
  const deviceNames = new Map<string, string>();
  for (const device of devices) {
    deviceNames.set(device.deviceId, device.name);
  }

  const isAcked = (key: string, activityMs: number, bareId?: string): boolean => {
    const stamp = acked[key] ?? (!fleetActive() && bareId ? acked[bareId] : undefined);
    return stamp !== undefined && activityMs <= stamp;
  };

  const upsert = (next: PetSessionBubble) => {
    const existing = byKey.get(next.key);
    if (!existing) {
      byKey.set(next.key, next);
      return;
    }
    const nextPriority = PET_BUBBLE_PRIORITY[next.state];
    const prevPriority = PET_BUBBLE_PRIORITY[existing.state];
    const state = nextPriority < prevPriority ? next.state : existing.state;
    const title = existing.title || next.title;
    const workspaceId = existing.workspaceId ?? next.workspaceId;
    const deviceName = existing.deviceName ?? next.deviceName;
    const activityMs = Math.max(existing.activityMs, next.activityMs);
    byKey.set(next.key, {
      ...existing,
      ...next,
      state,
      title,
      workspaceId,
      deviceName,
      activityMs,
    });
  };

  // 1. Attention groups (`fleet_attention` / `fleet_prompts`): needs_you, unread failed, unread done.
  const now = Date.now();
  for (const group of attentionGroups()) {
    for (const item of group.items) {
      let state: PetBubbleState | null = null;
      if (group.id === "needs_you") {
        state = "needs_you";
      } else if (group.id === "failed" && item.unread !== false) {
        state = "failed";
      } else if (group.id === "done" && item.unread === true) {
        state = "unread";
      }
      if (!state) continue;
      const deviceId = item.source.deviceId ?? "";
      const sessionId = item.source.sessionId;
      const conversationId = item.source.conversationId;
      const key = conversationId
        ? `cloud/${conversationId}`
        : `${deviceId}/${sessionId ?? item.itemId}`;
      const activityMs = typeof item.ageMs === "number" && Number.isFinite(item.ageMs)
        ? Math.max(0, now - item.ageMs)
        : 0;
      if (state !== "needs_you" && sessionId && isAcked(key, activityMs, sessionId)) {
        continue;
      }
      upsert({
        key,
        deviceId,
        deviceName: multiDevice ? (item.deviceName ?? deviceNames.get(deviceId)) : undefined,
        workspaceId: item.source.workspaceId,
        sessionId,
        conversationId,
        title: item.title?.trim() || tr("allSessions.untitled"),
        state,
        activityMs,
      });
    }
  }

  // 2. Fleet navigator sessions across all account devices (running, waiting, unread, failed).
  if (fleetActive()) {
    for (const device of devices) {
      for (const workspace of device.workspaces) {
        for (const session of workspace.sessions) {
          if (session.parentSessionId) continue;
          const key = `${device.deviceId}/${session.sessionId}`;
          const activityMs = session.lastActivityMs ?? 0;
          const liveRunning = session.status === "running" || Boolean(running[key]);
          const waiting = session.status === "waiting" || session.needsAttention === true;
          const ackedHere = isAcked(key, activityMs, session.sessionId);
          const failed = session.status === "error" && session.unread && !ackedHere;
          const unread = session.unread === true && !ackedHere;
          const state: PetBubbleState | null = waiting
            ? "needs_you"
            : liveRunning
              ? "running"
              : failed
                ? "failed"
                : unread
                  ? "unread"
                  : null;
          if (!state) continue;
          upsert({
            key,
            deviceId: device.deviceId,
            deviceName: multiDevice ? device.name : undefined,
            workspaceId: session.workspaceId || workspace.workspaceId,
            sessionId: session.sessionId,
            title: session.title?.trim() || tr("allSessions.untitled"),
            state,
            activityMs,
          });
        }
      }
    }
  }

  // 3. Local/active device session list (covers non-fleet hosts and immediate live running turns).
  const statusOf = statusOfSession();
  const fallbackDevice = fleetActive() ? deviceContext() : "";
  for (const row of sessions()) {
    if (isSessionArchived(row)) continue;
    const activityMs = sessionLastActivityMs(row) ?? 0;
    const mark = statusOf(row.sessionId, activityMs, row.messageCount, row.deviceId);
    if (!mark || mark.kind === "queued") continue;
    const state: PetBubbleState =
      mark.kind === "approval"
        ? "needs_you"
        : mark.kind === "running"
          ? "running"
          : mark.kind === "failed"
            ? "failed"
            : "unread";
    const deviceId = row.deviceId ?? fallbackDevice;
    const key = sessionKey(row.sessionId, deviceId);
    upsert({
      key,
      deviceId,
      deviceName: multiDevice && deviceId ? deviceNames.get(deviceId) : undefined,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId,
      title: row.sessionName?.trim() || tr("allSessions.untitled"),
      state,
      activityMs,
    });
  }

  return [...byKey.values()].sort(
    (a, b) =>
      PET_BUBBLE_PRIORITY[a.state] - PET_BUBBLE_PRIORITY[b.state] ||
      b.activityMs - a.activityMs ||
      a.key.localeCompare(b.key),
  );
});

/** Up to `MAX_PET_BUBBLES` (2) active/unread session bubbles shown to the left of the pet. */
export const petSessionBubbles = computed<PetSessionBubble[]>(() => {
  const dismissed = dismissedPetBubbles();
  return candidatePetBubbles()
    .filter(bubble => !isBubbleDismissed(bubble, dismissed))
    .slice(0, MAX_PET_BUBBLES);
});

/** Closes one session bubble (silences its current active or notice bucket until state/activity changes). */
export function dismissPetBubble(bubble: Pick<PetSessionBubble, "key" | "state" | "activityMs">): void {
  dismissedPetBubbles.update(current => ({
    ...current,
    [bubble.key]: {
      bucket: petBubbleDismissBucket(bubble.state),
      activityMs: bubble.activityMs,
    },
  }));
}

/** Closes every currently eligible session bubble so queued items do not immediately replace the closed pair. */
export function dismissAllPetBubbles(): void {
  const candidates = candidatePetBubbles();
  if (candidates.length === 0) return;
  dismissedPetBubbles.update(current => {
    const next = { ...current };
    for (const bubble of candidates) {
      next[bubble.key] = {
        bucket: petBubbleDismissBucket(bubble.state),
        activityMs: bubble.activityMs,
      };
    }
    return next;
  });
}

/**
 * The fleet's attention as one state: the first non-empty Inbox group in the
 * backend's order (an unseen item for done and failed), else working while
 * anything runs, else rest.
 */
export const petState = computed<MarkState>(() => {
  for (const group of attentionGroups()) {
    if (group.items.length === 0) continue;
    if (group.id === "needs_you") return "needs_you";
    if (group.id === "failed" && group.items.some(item => item.unread !== false)) return "failed";
    if (group.id === "done" && group.items.some(item => item.unread === true)) return "done";
  }
  if ((fleetTotals()?.running ?? 0) > 0) return "working";
  if (Object.keys(runningTurns()).length > 0) return "working";
  return "idle";
});

export function resetCompanionForTests(): void {
  companionEnabled.set(null);
  desktopCardsEnabled.set(null);
  selectedPet.set(null);
  companionPets.set(null);
  companionNotice.set("");
  companionBusy.set(null);
  dismissedPetBubbles.set({});
  petSheets.set({});
  petSheetErrors.set({});
  loadingSheets.clear();
  petStills.set({});
  petStillErrors.set({});
  loadingStills.clear();
}

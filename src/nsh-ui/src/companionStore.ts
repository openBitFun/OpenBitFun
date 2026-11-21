// The companion pet (tauri-gap §1.5, §4.4): the ambient face of the fleet's
// attention on the desktop app. Its settings are this device's
// `app.ai_experience` values (`enable_agent_companion`, `agent_companion_pet`,
// `enable_desktop_cards`), its characters come from `list_agent_companion_pets`
// (built-in sets plus the user's imports) and its frames from
// `load_agent_companion_pet_spritesheet`.
//
// What the pet shows is the Inbox's own state: the first non-empty group the
// backend ranks first in `fleet_attention` (needs you, failed, done), else
// working while the navigator counts running sessions, else rest. So a job
// that needs you on another machine wakes the pet on this one. The store maps
// that state onto a sprite row and draws nothing else into it.

import { computed, signal } from "nsh";
import { setConfig, getConfig } from "./api";
import { attentionGroups } from "./attentionStore";
import { errorMessageOf } from "./backendConnection";
import { invokeCommand, windowShellId } from "./bridge";
import { fleetTotals } from "./fleetStore";
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

/** Reads the three settings once more. */
export async function loadCompanionSettings(): Promise<void> {
  try {
    const [enabled, pet, cards] = await Promise.all([
      getConfig(COMPANION_ENABLED_PATH, true),
      getConfig(COMPANION_PET_PATH, true),
      getConfig(DESKTOP_CARDS_ENABLED_PATH, true),
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
    await setConfig(path, value);
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

// ── Frames ──────────────────────────────────────────────────────────────────

/** Spritesheets as data URLs, by spritesheet path (read once per run). */
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
    petSheets.set({ ...petSheets(), [spritesheetPath]: `data:${answer.mimeType ?? "image/webp"};base64,${answer.base64}` });
  } catch (error) {
    petSheetErrors.set({ ...petSheetErrors(), [spritesheetPath]: errorMessageOf(error) });
  } finally {
    loadingSheets.delete(spritesheetPath);
  }
}

// ── What the pet shows ───────────────────────────────────────────────────────

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
  return "idle";
});

export function resetCompanionForTests(): void {
  companionEnabled.set(null);
  desktopCardsEnabled.set(null);
  selectedPet.set(null);
  companionPets.set(null);
  companionNotice.set("");
  companionBusy.set(null);
  petSheets.set({});
  petSheetErrors.set({});
  loadingSheets.clear();
}

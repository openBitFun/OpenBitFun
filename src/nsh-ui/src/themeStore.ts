// The appearance this surface shows.
//
// Preserves `openbitfun.nsh.appearance.v1` ("system" | "light" | "dark") and
// persists specific 9-preset selections under `openbitfun.nsh.appearance-id.v1`,
// keeping NSH's native widgets (`Terminal`, `DiffView`, `Editor`, `TextView`,
// `Tree`) and custom scrollbars synced across launches and live switches.

import { Storage, setColorScheme } from "nsh";
import { getConfig, setConfig } from "./api";
import {
  APPEARANCE_ID_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  appearanceId,
  appearanceMode,
  getAppearancePreset,
  isAppearanceId,
  resolvedScheme,
  selectAppearancePreset,
  syncGlobalNativeTheme,
  type AppearanceId,
} from "./theme";

/**
 * The host keeps the appearance as `appearance.selection` (a preset id or
 * `system`), which account settings sync carries to the account's other
 * devices. The two plain schemes are the default presets of each scheme.
 */
const HOST_SELECTION_PATH = "appearance.selection";
const LIGHT_SELECTION: AppearanceId = "openbitfun-light";
const DARK_SELECTION: AppearanceId = "openbitfun-dark";

/** The host selection for what this surface shows now. */
export function currentAppearanceSelection(): string {
  const id = appearanceId();
  if (id) return id;
  const mode = appearanceMode();
  if (mode === "light") return LIGHT_SELECTION;
  if (mode === "dark") return DARK_SELECTION;
  return "system";
}

function storeOnHost(selection: string): void {
  void setConfig(HOST_SELECTION_PATH, selection).catch(() => {
    // An older or unreachable host keeps the choice in this surface only.
  });
}

/**
 * Shows the host's selection when it differs from this surface's (account
 * settings sync changed it on another device). On the first read after an
 * upgrade the host may still hold the untouched default while this surface
 * remembers a choice: the choice is written to the host instead.
 */
export async function syncAppearanceFromHost(options: { initial?: boolean } = {}): Promise<void> {
  let selection: unknown;
  try {
    selection = await getConfig(HOST_SELECTION_PATH, true);
  } catch {
    return;
  }
  if (typeof selection !== "string" || !selection.trim()) return;
  const local = currentAppearanceSelection();
  if (selection === local) return;
  if (options.initial && selection === "system") {
    storeOnHost(local);
    return;
  }
  if (selection === "system") {
    applyLocalAppearance("system");
  } else if (isAppearanceId(selection)) {
    selectAppearancePreset(selection);
  }
}

/** Picks a preset (the swatch gallery) and keeps it on the host. */
export function chooseAppearancePreset(id: AppearanceId): void {
  selectAppearancePreset(id);
  storeOnHost(currentAppearanceSelection());
}

export type AppearanceMode = "system" | "light" | "dark";

function isMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

/** Reads the remembered appearance preset or scheme and syncs native widgets. */
export async function loadAppearance(): Promise<void> {
  // Sync native widgets and scrollbars immediately for the initial scheme.
  syncGlobalNativeTheme();
  try {
    const [storedMode, storedPresetId] = await Promise.all([
      Storage.getItem(APPEARANCE_STORAGE_KEY),
      Storage.getItem(APPEARANCE_ID_STORAGE_KEY),
    ]);
    if (isAppearanceId(storedPresetId)) {
      const preset = getAppearancePreset(storedPresetId);
      const scheme: "light" | "dark" = preset.isLight ? "light" : "dark";
      appearanceId.set(storedPresetId);
      appearanceMode.set(scheme);
      setColorScheme(scheme);
      syncGlobalNativeTheme();
      return;
    }
    if (isMode(storedMode)) {
      appearanceId.set(null);
      appearanceMode.set(storedMode);
      setColorScheme(storedMode);
      syncGlobalNativeTheme();
    }
  } catch {
    // Storage is a preference cache: an unreadable one keeps the host's scheme.
  }
}

/** Sets the scheme the host draws (native widgets included) and remembers it. */
export function applyAppearance(mode: AppearanceMode): void {
  applyLocalAppearance(mode);
  storeOnHost(currentAppearanceSelection());
}

function applyLocalAppearance(mode: AppearanceMode): void {
  appearanceId.set(null);
  appearanceMode.set(mode);
  setColorScheme(mode);
  syncGlobalNativeTheme();
  void Storage.setItem(APPEARANCE_STORAGE_KEY, mode).catch(() => {
    // A full store still shows the choice for this run.
  });
  void Storage.removeItem(APPEARANCE_ID_STORAGE_KEY).catch(() => {});
}

/** Flips between the two schemes the app draws, leaving `system` behind. */
export function toggleAppearance(): void {
  applyAppearance(resolvedScheme() === "dark" ? "light" : "dark");
}

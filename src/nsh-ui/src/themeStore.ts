// The appearance this surface shows.
//
// Preserves `openbitfun.nsh.appearance.v1` ("system" | "light" | "dark") and
// persists specific 9-preset selections under `openbitfun.nsh.appearance-id.v1`,
// keeping NSH's native widgets (`Terminal`, `DiffView`, `Editor`, `TextView`,
// `Tree`) and custom scrollbars synced across launches and live switches.

import { Storage, setColorScheme } from "nsh";
import {
  APPEARANCE_ID_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  appearanceId,
  appearanceMode,
  getAppearancePreset,
  isAppearanceId,
  resolvedScheme,
  syncGlobalNativeTheme,
} from "./theme";

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

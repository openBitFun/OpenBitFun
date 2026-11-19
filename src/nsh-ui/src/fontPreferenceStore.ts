// The host's font preference: one baseline px that the whole surface scales from.
//
// The desktop keeps it in the `font` config as `{ uiSize: { level, customPx? } }`
// and derives its type ramp from the baseline — the presets are 12/13/14/15/16 px
// and `custom` takes 12–20. This surface reads the same document and writes it the
// same way, so a size picked in either frontend is the size the other draws.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { BASE_FONT_SIZE, uiFontBasePx } from "./theme";

export type FontLevel = "compact" | "small" | "default" | "medium" | "large" | "custom";

/** Where both surfaces keep it. */
const CONFIG_PATH = "font";

export const MIN_FONT_PX = 12;
export const MAX_FONT_PX = 20;

/** The levels the desktop's picker draws, with the baseline each one means. */
export const FONT_LEVELS: ReadonlyArray<{ level: Exclude<FontLevel, "custom">; label: string; px: number }> = [
  { level: "compact", label: "Compact", px: 12 },
  { level: "small", label: "Small", px: 13 },
  { level: "default", label: "Default", px: 14 },
  { level: "medium", label: "Medium", px: 15 },
  { level: "large", label: "Large", px: 16 },
];

export const fontLevel = signal<FontLevel>("default");
/** The baseline in px the scale comes from, resolved for the level. */
export const fontPx = signal(BASE_FONT_SIZE);
export const fontNotice = signal("");

function isLevel(value: unknown): value is FontLevel {
  return value === "compact" || value === "small" || value === "default"
    || value === "medium" || value === "large" || value === "custom";
}

function clampPx(value: number): number {
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(value)));
}

/** The px a level means, with `custom` taken from the stored size. */
export function pxOfLevel(level: FontLevel, customPx?: number): number {
  if (level === "custom") return clampPx(customPx ?? BASE_FONT_SIZE);
  const preset = FONT_LEVELS.find(entry => entry.level === level);
  return preset ? preset.px : BASE_FONT_SIZE;
}

/** Applies a baseline to the surface, which repaints every text size from it. */
function apply(level: FontLevel, px: number): void {
  fontLevel.set(level);
  fontPx.set(px);
  uiFontBasePx.set(px);
}

/**
 * Reads the stored preference. A host that stores nothing keeps this surface at
 * the default, which is what the desktop's own default is.
 */
export async function loadFontPreference(): Promise<void> {
  try {
    const stored = (await getConfig(CONFIG_PATH, true)) as
      | { uiSize?: { level?: unknown; customPx?: unknown } }
      | null;
    const level = isLevel(stored?.uiSize?.level) ? stored.uiSize.level : "default";
    const customPx = typeof stored?.uiSize?.customPx === "number" ? stored.uiSize.customPx : undefined;
    apply(level, pxOfLevel(level, customPx));
  } catch {
    apply("default", BASE_FONT_SIZE);
  }
}

/** Writes the whole document, which is the shape the desktop stores. */
async function store(level: FontLevel, px: number): Promise<void> {
  apply(level, px);
  fontNotice.set("");
  try {
    await setConfig(CONFIG_PATH, {
      uiSize: level === "custom" ? { level, customPx: px } : { level },
    });
  } catch (error) {
    fontNotice.set(
      `The host did not store the size: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function chooseFontLevel(level: FontLevel): Promise<void> {
  await store(level, pxOfLevel(level, fontPx()));
}

/**
 * One step of the custom size. The desktop turns an adjusted preset into
 * `custom` at the resulting px, because the presets are fixed sizes.
 */
export async function adjustFontPx(delta: number): Promise<void> {
  const next = clampPx(fontPx() + delta);
  if (next === fontPx()) return;
  await store("custom", next);
}

export async function resetFontPreference(): Promise<void> {
  await store("default", BASE_FONT_SIZE);
}

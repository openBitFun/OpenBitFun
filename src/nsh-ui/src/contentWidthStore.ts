// The content width preference: how wide the conversation column grows.
//
// The desktop keeps this one in the page's local storage rather than the config,
// because it describes the controller's own window and never travels to a peer.
// This surface stores it under the same key, so a host that maps `Storage` onto
// the page's local storage shows one width in both frontends rather than two.

import { Storage, signal } from "nsh";

/** The desktop's `control.flowChat.transcriptMaxWidth` token. */
export const DEFAULT_CONTENT_WIDTH = 900;
/** Two thirds of the default, which is where the desktop stops narrowing. */
export const MIN_CONTENT_WIDTH = Math.round((DEFAULT_CONTENT_WIDTH * 2) / 3);
/** The step its stepper takes. */
export const CONTENT_WIDTH_STEP = 10;
/** Where the desktop keeps it. */
export const CONTENT_WIDTH_STORAGE_KEY = "openbitfun:appearance:flowChatWidth";

export const contentWidth = signal(DEFAULT_CONTENT_WIDTH);
/** Set when the stored value could not be read or written. */
export const contentWidthNotice = signal("");

function clampWidth(value: number): number {
  return Math.max(MIN_CONTENT_WIDTH, Math.round(value));
}

/**
 * Reads the stored width. A saved value below the floor is treated as unset, the
 * way the desktop falls back to its default instead of honouring a number its own
 * stepper can no longer reach.
 */
export async function loadContentWidth(): Promise<void> {
  try {
    const raw = await Storage.getItem(CONTENT_WIDTH_STORAGE_KEY);
    if (!raw || !raw.trim()) return;
    const saved = Number(raw);
    if (Number.isFinite(saved) && saved >= MIN_CONTENT_WIDTH) contentWidth.set(clampWidth(saved));
  } catch {
    contentWidthNotice.set("The saved content width could not be read; this run uses the default.");
  }
}

/** Applies a width, which the conversation panes read on every paint. */
export function setContentWidth(width: number): void {
  if (!Number.isFinite(width)) return;
  const next = clampWidth(width);
  if (next === contentWidth()) return;
  contentWidth.set(next);
  contentWidthNotice.set("");
  void Storage.setItem(CONTENT_WIDTH_STORAGE_KEY, String(next)).catch(() => {
    // A store that refuses the write still shows the width for this run.
    contentWidthNotice.set("The content width was not saved; this run keeps it in memory.");
  });
}

/** One step of the stepper. */
export function adjustContentWidth(delta: number): void {
  setContentWidth(contentWidth() + delta);
}

export function resetContentWidth(): void {
  setContentWidth(DEFAULT_CONTENT_WIDTH);
}

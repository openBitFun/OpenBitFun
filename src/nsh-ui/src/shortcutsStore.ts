// Shortcut remapping (wave 22 P5). The shell binds its shortcuts by id (the
// desktop's shortcut registry ids), and a user override lives in
// `app.keybindings` as `{ __version__: 1, overrides: { id: { key, ctrl, shift,
// alt, meta } } }` (a legacy flat map is still read). Settings › Shortcuts lists
// the shell's shortcuts, records a new key and writes the document back with
// `set_config`; the shell rebinds when the overrides change.

import { signal } from "nsh";
import { entryDeviceId, fleetActive, invokeCommand } from "./bridge";
import type { MessageKey } from "./locales/en-US";

export interface ShortcutDefinition {
  id: string;
  /** The default keystroke, as `keymap` names it (`"mod+k"`). */
  keystroke: string;
  labelKey: MessageKey;
}

/** The shell's shortcuts, in the order Settings lists them. Ids match `App.tsx`'s `SHELL_SHORTCUTS`. */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: "search.global", keystroke: "mod+k", labelKey: "shortcuts.action.search" },
  { id: "chat.newSession", keystroke: "mod+n", labelKey: "shortcuts.action.newConversation" },
  { id: "inbox.toggle", keystroke: "mod+i", labelKey: "shortcuts.action.inbox" },
  { id: "panel.toggleLeft", keystroke: "mod+b", labelKey: "shortcuts.action.sidebar" },
  { id: "panel.toggleRight", keystroke: "mod+j", labelKey: "shortcuts.action.sidePane" },
  { id: "scene.openSettings", keystroke: "mod+,", labelKey: "shortcuts.action.settings" },
];

interface StoredBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** The overrides as keystrokes, by id; what the shell binds instead of the defaults. */
export const keybindingOverrides = signal<Record<string, string>>({});
/** The raw stored entries, kept so a write preserves ids this client does not list. */
let storedEntries: Record<string, unknown> = {};
export const keybindingsLoaded = signal(false);
export const shortcutRecording = signal<string | null>(null);
export const shortcutNotice = signal("");

export function keystrokeFromBinding(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.key !== "string" || !value.key.trim()) return null;
  const parts: string[] = [];
  // The desktop treats `ctrl` as the primary modifier (Command on macOS).
  if (value.ctrl === true || value.meta === true) parts.push("mod");
  if (value.shift === true) parts.push("shift");
  if (value.alt === true) parts.push("alt");
  parts.push(value.key.trim().toLowerCase());
  return parts.join("+");
}

function bindingFromKeystroke(keystroke: string): StoredBinding {
  const parts = keystroke.split("+");
  const key = parts.pop() ?? "";
  return {
    key,
    ctrl: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    meta: false,
  };
}

/** The entries of a stored document: version 1, or the legacy flat map. */
export function readStoredEntries(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const doc = raw as Record<string, unknown>;
  if (doc.__version__ === 1 && doc.overrides && typeof doc.overrides === "object") {
    return { ...(doc.overrides as Record<string, unknown>) };
  }
  if ("__version__" in doc) return {};
  return Object.fromEntries(Object.entries(doc).filter(([id]) => !id.startsWith("__")));
}

export function readKeybindingOverrides(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(readStoredEntries(raw))) {
    const keystroke = keystrokeFromBinding(value);
    if (keystroke) out[id] = keystroke;
  }
  return out;
}

export function applyStoredKeybindings(raw: unknown): void {
  storedEntries = readStoredEntries(raw);
  keybindingOverrides.set(readKeybindingOverrides(raw));
  keybindingsLoaded.set(true);
}

/** Shortcuts belong to this client's entry device, never a remote peer `deviceContext()`. */
function localTarget(): { target: string } | undefined {
  if (!fleetActive()) return undefined;
  const entry = entryDeviceId();
  return entry ? { target: entry } : undefined;
}

export async function loadKeybindings(): Promise<void> {
  try {
    applyStoredKeybindings(
      await invokeCommand<unknown>(
        "get_config",
        { path: "app.keybindings", skipRetryOnNotFound: true },
        localTarget(),
      ),
    );
  } catch {
    // No document yet: every shortcut is its default.
    applyStoredKeybindings(null);
  }
}

/** The keystroke a shortcut runs on now. */
export function effectiveKeystroke(definition: ShortcutDefinition): string {
  return keybindingOverrides()[definition.id] ?? definition.keystroke;
}

/** The shortcut that already uses `keystroke`, other than `exceptId`. */
export function shortcutUsing(keystroke: string, exceptId: string): ShortcutDefinition | null {
  return SHORTCUT_DEFINITIONS.find(item => item.id !== exceptId && effectiveKeystroke(item) === keystroke) ?? null;
}

/**
 * Re-reads the latest `app.keybindings` from this client's entry device before
 * applying `mutate` so concurrent or synced changes are never clobbered by a
 * stale load-time snapshot.
 */
async function updateStoredEntries(mutate: (entries: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const target = localTarget();
  let base: Record<string, unknown>;
  try {
    const fresh = await invokeCommand<unknown>(
      "get_config",
      { path: "app.keybindings", skipRetryOnNotFound: true },
      target,
    );
    base = fresh != null ? readStoredEntries(fresh) : { ...storedEntries };
  } catch {
    base = { ...storedEntries };
  }
  const next = mutate(base);
  const document = { __version__: 1, overrides: next };
  await invokeCommand<unknown>("set_config", { path: "app.keybindings", value: document }, target);
  applyStoredKeybindings(document);
}

/** Stores `keystroke` for `id`; the default keystroke removes the override. */
export async function setShortcut(id: string, keystroke: string): Promise<void> {
  const definition = SHORTCUT_DEFINITIONS.find(item => item.id === id);
  if (!definition) return;
  await updateStoredEntries(entries => {
    const next = { ...entries };
    if (keystroke === definition.keystroke) delete next[id];
    else next[id] = bindingFromKeystroke(keystroke);
    return next;
  });
}

export async function resetShortcut(id: string): Promise<void> {
  await updateStoredEntries(entries => {
    const next = { ...entries };
    delete next[id];
    return next;
  });
}

export async function resetAllShortcuts(): Promise<void> {
  const listed = new Set(SHORTCUT_DEFINITIONS.map(item => item.id));
  await updateStoredEntries(entries =>
    Object.fromEntries(Object.entries(entries).filter(([id]) => !listed.has(id))),
  );
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "OS", "CapsLock", "Fn"]);

const NAMED_KEYS: Record<string, string> = {
  " ": "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "escape",
  Enter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  Tab: "tab",
};

/**
 * A pressed key as a keystroke (`"mod+shift+p"`), or `null` while only
 * modifiers are down. A shortcut needs the primary modifier or Alt, so typing
 * alone never fires it.
 */
export function keystrokeFromKeyEvent(event: {
  key: string;
  code?: string;
  modifiers: { control: boolean; alt: boolean; shift: boolean; platform: boolean };
}): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === "Unidentified") return null;
  const code = event.code ?? "";
  let key = NAMED_KEYS[event.key] ?? "";
  if (!key && /^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (!key && /^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (!key && /^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) key = event.key.toLowerCase();
  else if (!key) key = event.key.length === 1 ? event.key.toLowerCase() : "";
  if (!key) return null;
  const parts: string[] = [];
  if (event.modifiers.platform || event.modifiers.control) parts.push("mod");
  if (event.modifiers.shift) parts.push("shift");
  if (event.modifiers.alt) parts.push("alt");
  if (!parts.includes("mod") && !parts.includes("alt")) return null;
  parts.push(key);
  return parts.join("+");
}

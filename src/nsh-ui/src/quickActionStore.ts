// The quick actions the composer offers above the input: a label, the prompt it
// sends, and whether it is shown. They live in the leaf
// `app.ai_experience.quick_actions`, which is read and written on its own, so a
// write can never put back a sibling setting another section just changed. The
// host applies the product defaults when the leaf was never stored, so this
// surface keeps no copy of them.

import { tr } from "./i18n";
import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { runStep } from "./state";

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  enabled: boolean;
}

export interface QuickActionDraft {
  /** Empty when the draft creates a new action. */
  id: string;
  label: string;
  prompt: string;
}

const LEAF_PATH = "app.ai_experience.quick_actions";

export const quickActions = signal<QuickAction[]>([]);
export const quickActionsNotice = signal("");
export const quickActionDraft = signal<QuickActionDraft | null>(null);

let loading = false;
let loaded = false;

function readable(raw: unknown): QuickAction[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: QuickAction[] = [];
  for (const value of raw) {
    const entry = value as Partial<QuickAction>;
    if (typeof entry?.id !== "string" || !entry.id) continue;
    if (typeof entry.label !== "string" || typeof entry.prompt !== "string") continue;
    rows.push({
      id: entry.id,
      label: entry.label,
      prompt: entry.prompt,
      enabled: entry.enabled !== false,
    });
  }
  return rows;
}

export function ensureQuickActions(): void {
  if (loaded || loading) return;
  loading = true;
  void loadQuickActions().finally(() => {
    loading = false;
    loaded = true;
  });
}

export async function loadQuickActions(): Promise<void> {
  await runStep(async () => {
    try {
      // The host answers with its defaults when the list was never stored.
      const rows = readable(await getConfig(LEAF_PATH, true));
      quickActions.set(rows ?? []);
      quickActionsNotice.set(rows ? "" : tr("chat.quickAction.unreadable"));
    } catch (error) {
      quickActions.set([]);
      quickActionsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

async function writeActions(next: QuickAction[], message: string): Promise<boolean> {
  let saved = false;
  await runStep(async () => {
    try {
      await setConfig(LEAF_PATH, next);
      quickActions.set(next);
      quickActionsNotice.set(message);
      saved = true;
    } catch (error) {
      quickActionsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
  return saved;
}

export async function toggleQuickAction(id: string): Promise<void> {
  const next = quickActions().map(action =>
    action.id === id ? { ...action, enabled: !action.enabled } : action,
  );
  const action = next.find(entry => entry.id === id);
  await writeActions(next, tr(action?.enabled ? "chat.quickAction.shown" : "chat.quickAction.hidden", { label: action?.label ?? id }));
}

export function openQuickActionDraft(action?: QuickAction): void {
  quickActionDraft.set(
    action ? { id: action.id, label: action.label, prompt: action.prompt } : { id: "", label: "", prompt: "" },
  );
  quickActionsNotice.set("");
}

export function closeQuickActionDraft(): void {
  quickActionDraft.set(null);
}

export function updateQuickActionDraft(patch: Partial<QuickActionDraft>): void {
  quickActionDraft.update(current => (current ? { ...current, ...patch } : current));
}

/** Saves the open draft: an empty id creates, a real one edits in place. */
export async function saveQuickActionDraft(): Promise<void> {
  const draft = quickActionDraft();
  if (!draft) return;
  const label = draft.label.trim();
  const prompt = draft.prompt.trim();
  if (!label || !prompt) {
    quickActionsNotice.set(tr("chat.quickAction.needsLabel"));
    return;
  }
  const existing = quickActions();
  const next = draft.id
    ? existing.map(action => (action.id === draft.id ? { ...action, label, prompt } : action))
    : [...existing, { id: `custom-${Date.now().toString(36)}`, label, prompt, enabled: true }];
  if (await writeActions(next, `Saved ${label}`)) quickActionDraft.set(null);
}

export async function deleteQuickAction(id: string): Promise<void> {
  const action = quickActions().find(entry => entry.id === id);
  await writeActions(
    quickActions().filter(entry => entry.id !== id),
    `Removed ${action?.label ?? id}`,
  );
}

/** Moves an action one place; the composer shows them in this order. */
export async function moveQuickAction(id: string, delta: number): Promise<void> {
  const rows = [...quickActions()];
  const index = rows.findIndex(action => action.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= rows.length) return;
  const [moved] = rows.splice(index, 1);
  rows.splice(target, 0, moved);
  await writeActions(rows, `Moved ${moved.label}`);
}

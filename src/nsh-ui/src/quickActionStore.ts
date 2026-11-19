// The quick actions the composer offers above the input: a label, the prompt it
// sends, and whether it is shown. They live in `app.ai_experience.quick_actions`,
// an object this surface also draws other fields from, so every write re-reads
// that object first and merges only this array — a whole-object write from a
// snapshot taken at page load would drop a setting another section just changed.

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

const CONFIG_PATH = "app.ai_experience";
const FIELD = "quick_actions";

/** What the desktop product ships; a host with no stored list runs these. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: "commit", label: "Commit", prompt: "Commit all current code changes", enabled: true },
  { id: "create_pr", label: "Create PR", prompt: "Create a Pull Request for the current branch", enabled: true },
];

export const quickActions = signal<QuickAction[]>(DEFAULT_QUICK_ACTIONS);
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
      const config = await getConfig(CONFIG_PATH, true);
      const stored = config && typeof config === "object"
        ? (config as Record<string, unknown>)[FIELD]
        : undefined;
      const rows = readable(stored);
      // An absent field is the host applying its defaults, not an empty list.
      quickActions.set(rows ?? DEFAULT_QUICK_ACTIONS);
      quickActionsNotice.set("");
    } catch {
      quickActions.set(DEFAULT_QUICK_ACTIONS);
    }
  });
}

async function writeActions(next: QuickAction[], message: string): Promise<boolean> {
  let saved = false;
  await runStep(async () => {
    try {
      // Read first: this object holds the voice-input and suggestion settings the
      // `Input` section writes, so merging into a fresh copy is what keeps them.
      let base: Record<string, unknown> = {};
      try {
        const current = await getConfig(CONFIG_PATH, true);
        if (current && typeof current === "object") base = current as Record<string, unknown>;
      } catch {
        // A host that never stored the object gets it created by this write.
      }
      await setConfig(CONFIG_PATH, { ...base, [FIELD]: next });
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
  await writeActions(next, `${action?.enabled ? "Shown" : "Hidden"}: ${action?.label ?? id}`);
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
    quickActionsNotice.set("An action needs a label and a prompt");
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

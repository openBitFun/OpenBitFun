// Models for the product's own small AI tasks: generating a session title, and
// writing a commit message. The host keeps them in `ai.task_models`, where each
// task is either `"Inherit"` (the session's model) or `{"Fixed":{"model_id":…}}`
// — the serde shape of `TaskModelSelection`, so the whole object is written back
// rather than a leaf path.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { peerScope, peerSupports } from "./peerState";
import { runStep } from "./state";

/** The tasks the host reconciles against `ai.models`, in the desktop's order. */
export const TASK_MODEL_ROWS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "session_title", label: "Session title", hint: "Names a session from its first message" },
  { id: "git_commit", label: "Commit message", hint: "Writes a message from the staged diff" },
];

export interface TaskModelChoice {
  /** `inherit` follows whatever model the session runs on. */
  kind: "inherit" | "fixed";
  modelId: string;
}

export const taskModels = signal<Record<string, TaskModelChoice>>({});
/** `null` until the host has been asked; `false` means it has no such section. */
export const taskModelsSupported = signal<boolean | null>(null);
export const taskModelsNotice = signal("");
/** Whether the host stores no `ai.task_models` at all, so the rows show its defaults. */
export const taskModelsAbsent = signal(false);
/** The task whose model picker is open, or `null` while no picker is shown. */
export const taskModelPicker = signal<string | null>(null);

let loading = false;

function readSelection(value: unknown): TaskModelChoice {
  if (value === "Inherit") return { kind: "inherit", modelId: "" };
  const fixed = (value as { Fixed?: { model_id?: unknown } } | undefined)?.Fixed;
  if (fixed && typeof fixed.model_id === "string" && fixed.model_id) {
    return { kind: "fixed", modelId: fixed.model_id };
  }
  // A shape this surface does not know is shown as inherit rather than as a
  // broken row; saving rewrites it in the shape the host understands.
  return { kind: "inherit", modelId: "" };
}

function readTaskModels(document: unknown): Record<string, TaskModelChoice> {
  const source = (document ?? {}) as Record<string, unknown>;
  const result: Record<string, TaskModelChoice> = {};
  for (const row of TASK_MODEL_ROWS) result[row.id] = readSelection(source[row.id]);
  return result;
}

function toWire(choice: TaskModelChoice): unknown {
  if (choice.kind === "inherit" || !choice.modelId) return "Inherit";
  return { Fixed: { model_id: choice.modelId } };
}

/** Reads the section once; the settings scene calls this on every render. */
export function ensureTaskModels(): void {
  if (taskModelsSupported() !== null || loading) return;
  if (peerScope() && peerSupports("model_pool_selection_v1") === false) {
    // The section is model selection like the pools are; a peer that selects
    // none of them has nothing to set here either.
    taskModelsSupported.set(false);
    return;
  }
  loading = true;
  void loadTaskModels().finally(() => {
    loading = false;
  });
}

/** `Fixed { fast }` is what an absent section means: the host's own default. */
const DEFAULT_CHOICE: TaskModelChoice = { kind: "fixed", modelId: "fast" };

function defaultTaskModels(): Record<string, TaskModelChoice> {
  const result: Record<string, TaskModelChoice> = {};
  for (const row of TASK_MODEL_ROWS) result[row.id] = { ...DEFAULT_CHOICE };
  return result;
}

export async function loadTaskModels(): Promise<void> {
  await runStep(async () => {
    try {
      const document = await getConfig("ai.task_models", true);
      taskModels.set(readTaskModels(document));
      taskModelsSupported.set(true);
      taskModelsAbsent.set(false);
      taskModelsNotice.set("");
    } catch {
      // A config file written before this section existed has no
      // `ai.task_models`; the host still applies its own default, so the rows
      // show that default and the first write creates the section. Only a host
      // that refuses the read outright hides the rows.
      try {
        await getConfig("app", true);
        taskModels.set(defaultTaskModels());
        taskModelsSupported.set(true);
        taskModelsAbsent.set(true);
        taskModelsNotice.set("The host stores no value yet; these are its defaults.");
      } catch {
        taskModelsSupported.set(false);
        taskModels.set({});
      }
    }
  });
}

export function openTaskModelPicker(task: string): void {
  taskModelPicker.set(taskModelPicker() === task ? null : task);
  taskModelsNotice.set("");
}

export async function chooseTaskModel(task: string, choice: TaskModelChoice): Promise<void> {
  const next = { ...taskModels(), [task]: choice };
  await runStep(async () => {
    const document: Record<string, unknown> = {};
    for (const row of TASK_MODEL_ROWS) document[row.id] = toWire(next[row.id] ?? { kind: "inherit", modelId: "" });
    try {
      await setConfig("ai.task_models", document);
      taskModels.set(next);
      taskModelsAbsent.set(false);
      taskModelPicker.set(null);
      const label = TASK_MODEL_ROWS.find(row => row.id === task)?.label ?? task;
      taskModelsNotice.set(`Saved ${label}`);
    } catch (error) {
      taskModelsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

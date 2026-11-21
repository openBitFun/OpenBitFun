// Models for the product's own small AI tasks: generating a session title, and
// writing a commit message. The host keeps them in `ai.task_models`, where each
// task is `{"kind":"inherit"}` (the session's model) or
// `{"kind":"fixed","model_id":…}` — `TaskModelSelection` is
// `serde(tag = "kind", rename_all = "snake_case")`. A write is one
// `set_task_model` intent: the host validates the task and selection, merges it
// into what it stores (keeping tasks this surface does not draw) and answers with
// every task's selection. The externally tagged shapes an earlier build of this
// surface wrote (`"Inherit"`, `{"Fixed":{"model_id":…}}`) are still read here and
// by the host, which rewrites them in its own shape on the next save.

import { signal } from "nsh";
import { getConfig } from "./api";
import { tr } from "./i18n";
import { errorText, invokeSettingsMutation } from "./settingsMutations";
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

export function readSelection(value: unknown): TaskModelChoice {
  // The host skips a task whose selection is its default (`fixed: fast`), so an
  // absent key reads as that default, not as inherit.
  if (value === undefined || value === null) return { kind: "fixed", modelId: "fast" };
  if (value === "Inherit" || value === "inherit") return { kind: "inherit", modelId: "" };
  if (value && typeof value === "object") {
    const record = value as { kind?: unknown; model_id?: unknown; Fixed?: { model_id?: unknown } };
    const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
    if (kind === "inherit") return { kind: "inherit", modelId: "" };
    if (kind === "fixed" && typeof record.model_id === "string" && record.model_id) {
      return { kind: "fixed", modelId: record.model_id };
    }
    // Legacy externally tagged shape an earlier build of this surface wrote.
    const fixed = record.Fixed;
    if (fixed && typeof fixed.model_id === "string" && fixed.model_id) {
      return { kind: "fixed", modelId: fixed.model_id };
    }
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

export function toWire(choice: TaskModelChoice): unknown {
  if (choice.kind === "inherit" || !choice.modelId) return { kind: "inherit" };
  return { kind: "fixed", model_id: choice.modelId };
}

/** Reads the section once; the settings scene calls this on every render. */
export function ensureTaskModels(): void {
  if (taskModelsSupported() !== null || loading) return;
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
  await runStep(async () => {
    try {
      const result = await invokeSettingsMutation<{ taskModels?: unknown }>("set_task_model", {
        task,
        selection: toWire(choice),
      });
      taskModels.set(readTaskModels(result?.taskModels));
      taskModelsAbsent.set(false);
      taskModelPicker.set(null);
      const label = task === "git_commit" ? tr("settings.taskModels.commitMessage") : tr("settings.taskModels.sessionTitle");
      taskModelsNotice.set(tr("settings.notice.savedField", { label }));
    } catch (error) {
      taskModelsNotice.set(errorText(error));
    }
  });
}

// The permission policy the host applies to tool calls, read from
// `tool_permissions` and reduced to the three modes the desktop offers.
//
// The write mirrors the desktop page: the mode is not a field, it is a
// combination of `policy.preset`, `interaction.auto_approve_ask` and
// `approval.strategy`, so switching it rewrites those three and keeps the rule
// list and every other field the host stored. The rule list and the automatic
// approval settings are edited here too, through the same whole-document write,
// because `ToolPermissionConfig` is exactly those three fields.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { invokeCommand } from "./bridge";
import { runStep } from "./state";

export type PermissionMode = "ask" | "auto" | "full_access";

export const PERMISSION_MODES: ReadonlyArray<{ value: PermissionMode; label: string; hint: string }> = [
  { value: "ask", label: "Ask", hint: "Every tool call waits for you" },
  { value: "auto", label: "Auto", hint: "A model answers the prompts for you" },
  { value: "full_access", label: "Full access", hint: "Every tool call runs without asking" },
];

/**
 * The actions the desktop's rule editor offers. The list is a convenience, not a
 * constraint: the host matches whatever action a tool reports, so the field takes
 * any action name and `*` for all of them.
 */
export const PERMISSION_ACTIONS: readonly string[] = [
  "*",
  "read",
  "edit",
  "bash",
  "git",
  "websearch",
  "webfetch",
  "task",
  "skill",
  "mcp",
  "computer_use",
  "custom_tool",
  "external_directory",
];

export const PERMISSION_EFFECTS: ReadonlyArray<{ value: PermissionEffect; label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
];

const DEFAULT_APPROVAL_MODEL_ID = "fast";

interface ApprovalConfig {
  strategy?: string;
  model_kind?: string;
  chat_model_id?: string;
  timeout_ms?: number;
  on_ask?: string;
  on_error?: string;
}

export type PermissionEffect = "allow" | "ask" | "deny";

interface PermissionRule {
  action?: string;
  resource?: string;
  effect?: string;
}

interface ToolPermissionConfig {
  policy: { preset: string; rules: PermissionRule[] };
  interaction: { auto_approve_ask: boolean };
  approval?: ApprovalConfig;
}

/** A rule being edited; `localId` keeps rows stable while the list is reordered. */
export interface PermissionRuleDraft {
  localId: string;
  action: string;
  resource: string;
  effect: PermissionEffect;
}

/** The automatic approval settings the desktop groups under one heading. */
export interface ApprovalSettings {
  modelKind: "chat" | "decision";
  chatModelId: string;
  timeoutSeconds: number;
  onAsk: "user" | "reject";
  onError: "ask" | "reject";
}

/** One choice of approval model: a role name (`fast` / `primary`) or a model id. */
export interface ApprovalModelOption {
  value: string;
  label: string;
  hint: string;
  disabled: boolean;
}

export const permissionMode = signal<PermissionMode | null>(null);
export const permissionRuleCount = signal(0);
/** The stored rules, as the list shows them outside the editor. */
export const permissionRules = signal<PermissionRuleDraft[]>([]);
/** `null` while the editor is closed; the draft is what the row writes touch. */
export const ruleDraft = signal<PermissionRuleDraft[] | null>(null);
export const rulesNotice = signal("");
/** `null` until the host has been asked; `false` means it has no such config. */
export const permissionsSupported = signal<boolean | null>(null);
export const permissionsNotice = signal("");
export const permissionModeControl = signal<boolean | null>(null);
/** Set when the user asked for full access; it takes a second press to apply. */
export const pendingFullAccess = signal(false);
export const approvalSettings = signal<ApprovalSettings | null>(null);
export const approvalNotice = signal("");
/** The chat models this host offers for automatic approval, by id and name. */
export const approvalModels = signal<ApprovalModelOption[]>([]);
/** The decision model's own endpoint record (`ai.decision_model`). */
export const decisionModel = signal<{ modelName: string; endpoint: string } | null>(null);
/** `null` when the host has no decision-model credential command at all. */
export const decisionCredential = signal<boolean | null>(null);

let loading = false;
let stored: ToolPermissionConfig | null = null;
let draftSequence = 0;

/** Reads a stored config into the shape `set_config` is given back. */
function normalize(value: unknown): ToolPermissionConfig {
  const input = (value ?? {}) as {
    policy?: { preset?: unknown; rules?: unknown };
    interaction?: { auto_approve_ask?: unknown };
    approval?: ApprovalConfig;
  };
  const rules = Array.isArray(input.policy?.rules)
    ? (input.policy.rules as PermissionRule[]).filter(
        rule => rule && typeof rule.action === "string" && typeof rule.resource === "string",
      )
    : [];
  const approval = input.approval;
  return {
    policy: {
      // Anything but the stored `full_access` reads as `ask`, which is what the
      // desktop normalizer does with an unknown preset.
      preset: input.policy?.preset === "full_access" ? "full_access" : "ask",
      rules,
    },
    interaction: { auto_approve_ask: input.interaction?.auto_approve_ask === true },
    ...(approval && typeof approval === "object"
      ? {
          approval: {
            strategy:
              approval.strategy === "model" || approval.strategy === "immediate_allow"
                ? approval.strategy
                : "interactive",
            model_kind: approval.model_kind === "decision" ? "decision" : "chat",
            chat_model_id: typeof approval.chat_model_id === "string" ? approval.chat_model_id : "",
            timeout_ms:
              typeof approval.timeout_ms === "number" && approval.timeout_ms > 0
                ? Math.min(approval.timeout_ms, 300000)
                : 30000,
            on_ask: approval.on_ask === "reject" ? "reject" : "user",
            on_error: approval.on_error === "reject" ? "reject" : "ask",
          },
        }
      : {}),
  };
}

function modeOf(config: ToolPermissionConfig): PermissionMode {
  if (config.policy.preset === "full_access") return "full_access";
  const strategy = config.approval?.strategy;
  if (strategy === "model" || strategy === "immediate_allow") return "auto";
  return config.interaction.auto_approve_ask ? "auto" : "ask";
}

function fieldsOf(rule: PermissionRule): Omit<PermissionRuleDraft, "localId"> {
  return {
    action: typeof rule.action === "string" && rule.action ? rule.action : "*",
    resource: typeof rule.resource === "string" ? rule.resource : "",
    effect: rule.effect === "allow" || rule.effect === "deny" ? rule.effect : "ask",
  };
}

/**
 * A rule inside the editor. The ids restart at every draft so the rows a person
 * (or an automation) presses are the same ones across sessions; the id follows the
 * rule when the list is reordered, which is what keeps a reorder from retyping it.
 */
function draftRuleOf(rule: PermissionRule): PermissionRuleDraft {
  draftSequence += 1;
  return { localId: `rule-${draftSequence}`, ...fieldsOf(rule) };
}

/** The stored rules, only used to count them and to seed a draft. */
function rulesOf(config: ToolPermissionConfig): PermissionRuleDraft[] {
  return config.policy.rules.map((rule, index) => ({ localId: `stored-${index}`, ...fieldsOf(rule) }));
}

function approvalOf(config: ToolPermissionConfig): ApprovalSettings {
  const approval = config.approval ?? {};
  const seconds = Math.round((approval.timeout_ms ?? 30000) / 1000);
  return {
    modelKind: approval.model_kind === "decision" ? "decision" : "chat",
    chatModelId: typeof approval.chat_model_id === "string" ? approval.chat_model_id : "",
    timeoutSeconds: Math.min(300, Math.max(1, seconds)),
    onAsk: approval.on_ask === "reject" ? "reject" : "user",
    onError: approval.on_error === "reject" ? "reject" : "ask",
  };
}

/**
 * Writes the whole `tool_permissions` document and republishes what it now says.
 * The command is one struct of exactly `policy`, `interaction` and `approval`, so
 * a field this surface does not draw is always carried over from `stored`.
 */
async function writePolicy(
  next: ToolPermissionConfig,
  message: string,
  notice: (text: string) => void,
): Promise<boolean> {
  try {
    await setConfig("tool_permissions", next);
    stored = next;
    permissionMode.set(modeOf(next));
    permissionRules.set(rulesOf(next));
    permissionRuleCount.set(next.policy.rules.length);
    approvalSettings.set(approvalOf(next));
    notice(message);
    return true;
  } catch (error) {
    notice(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Reads the policy once; the settings scene calls this on every render. */
export function ensurePermissions(): void {
  if (permissionsSupported() !== null || loading) return;
  loading = true;
  void loadPermissions().finally(() => {
    loading = false;
  });
}

export async function loadPermissions(): Promise<void> {
  await runStep(async () => {
    try {
      const config = normalize(await getConfig("tool_permissions", true));
      stored = config;
      permissionMode.set(modeOf(config));
      permissionRules.set(rulesOf(config));
      permissionRuleCount.set(config.policy.rules.length);
      approvalSettings.set(approvalOf(config));
      permissionsSupported.set(true);
    } catch {
      // A host without the config keeps the section out of the way.
      permissionsSupported.set(false);
      permissionMode.set(null);
    }
    try {
      permissionModeControl.set((await getConfig("app.flow_chat.show_permission_mode_control", true)) === true);
    } catch {
      permissionModeControl.set(null);
    }
    await loadApprovalModels();
    await loadDecisionModel();
  });
}

/**
 * The models automatic approval can pick, in the desktop's own order: the
 * workspace's fast and primary roles first, then every configured chat model.
 * The stored value is an id or one of those two role names.
 */
async function loadApprovalModels(): Promise<void> {
  try {
    const [rawModels, rawDefaults] = await Promise.all([
      getConfig("ai.models", true),
      getConfig("ai.default_models", true),
    ]);
    const models = Array.isArray(rawModels)
      ? rawModels.flatMap(entry => {
          const record = (entry ?? {}) as { id?: unknown; name?: unknown; model_name?: unknown };
          if (typeof record.id !== "string" || !record.id) return [];
          const name =
            typeof record.model_name === "string" && record.model_name
              ? record.model_name
              : typeof record.name === "string" && record.name
                ? record.name
                : record.id;
          return [{ id: record.id, name }];
        })
      : [];
    const defaults = (rawDefaults ?? {}) as { primary?: unknown; fast?: unknown };
    const role = (value: "primary" | "fast", storedId: unknown): ApprovalModelOption | null => {
      if (typeof storedId !== "string" || !storedId) return null;
      const match = models.find(entry => entry.id === storedId);
      return {
        value: value,
        label: value === "fast" ? "Fast model" : "Primary model",
        hint: match ? match.name : `Unavailable model (${storedId})`,
        disabled: !match,
      };
    };
    const options = [role("fast", defaults.fast), role("primary", defaults.primary)].filter(
      (entry): entry is ApprovalModelOption => entry !== null,
    );
    for (const model of models) {
      options.push({ value: model.id, label: model.name, hint: model.id, disabled: false });
    }
    const selected = approvalSettings()?.chatModelId ?? "";
    if (selected && !options.some(entry => entry.value === selected)) {
      options.unshift({ value: selected, label: `Unavailable model (${selected})`, hint: "", disabled: true });
    }
    approvalModels.set(options);
  } catch {
    // A host with no model list leaves the approval model to the stored value.
    approvalModels.set([]);
  }
}

/** The decision model (`ai.decision_model`) and whether its key is in the vault. */
export async function loadDecisionModel(): Promise<void> {
  try {
    const raw = (await getConfig("ai.decision_model", true)) ?? {};
    const record = raw as { model_name?: unknown; endpoint?: unknown };
    decisionModel.set({
      modelName: typeof record.model_name === "string" ? record.model_name : "",
      endpoint: typeof record.endpoint === "string" ? record.endpoint : "",
    });
  } catch {
    decisionModel.set(null);
  }
  try {
    const status = await invokeCommand<{ configured?: boolean }>("get_decision_model_credential_status", {});
    decisionCredential.set(status?.configured === true);
  } catch {
    // An older host has no decision-model credential commands at all.
    decisionCredential.set(null);
  }
}

/**
 * Switches the policy to `mode`. `full_access` is applied only on a second
 * press, because it removes every prompt.
 */
export async function choosePermissionMode(mode: PermissionMode): Promise<void> {
  if (mode === "full_access" && !pendingFullAccess()) {
    pendingFullAccess.set(true);
    permissionsNotice.set("");
    return;
  }
  pendingFullAccess.set(false);
  const current = stored;
  if (!current) return;
  const approval: ApprovalConfig = {
    strategy: mode === "auto" ? "model" : "interactive",
    model_kind: current.approval?.model_kind ?? "chat",
    chat_model_id:
      mode === "auto"
        ? current.approval?.chat_model_id?.trim() || DEFAULT_APPROVAL_MODEL_ID
        : current.approval?.chat_model_id ?? "",
    timeout_ms: current.approval?.timeout_ms ?? 30000,
    on_ask: current.approval?.on_ask ?? "user",
    on_error: current.approval?.on_error ?? "ask",
  };
  const next: ToolPermissionConfig = {
    policy: { ...current.policy, preset: mode === "full_access" ? "full_access" : "ask" },
    interaction: { ...current.interaction, auto_approve_ask: mode === "auto" },
    approval,
  };
  await runStep(async () => {
    await writePolicy(
      next,
      `Saved ${PERMISSION_MODES.find(entry => entry.value === mode)?.label ?? mode}`,
      text => permissionsNotice.set(text),
    );
  });
}

/** Opens the rule editor on a copy, so an abandoned edit changes nothing. */
export function beginRulesDraft(): void {
  if (ruleDraft() !== null) return;
  draftSequence = 0;
  rulesNotice.set("");
  ruleDraft.set(
    permissionRules().map(rule =>
      draftRuleOf({ action: rule.action, resource: rule.resource, effect: rule.effect }),
    ),
  );
}

export function addPermissionRule(): void {
  ruleDraft.set([...(ruleDraft() ?? []), draftRuleOf({ action: "*", resource: "", effect: "ask" })]);
}

export function patchPermissionRule(
  localId: string,
  change: Partial<Omit<PermissionRuleDraft, "localId">>,
): void {
  ruleDraft.update(current =>
    (current ?? []).map(rule => (rule.localId === localId ? { ...rule, ...change } : rule)),
  );
}

export function movePermissionRule(localId: string, delta: number): void {
  ruleDraft.update(current => {
    const list = [...(current ?? [])];
    const index = list.findIndex(rule => rule.localId === localId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const [rule] = list.splice(index, 1);
    list.splice(target, 0, rule);
    return list;
  });
}

export function removePermissionRule(localId: string): void {
  ruleDraft.set((ruleDraft() ?? []).filter(rule => rule.localId !== localId));
}

export function discardRuleDraft(): void {
  ruleDraft.set(null);
  rulesNotice.set("");
}

/**
 * Saves the rule list in the order it is drawn. Order matters to the host — the
 * first matching rule decides — so the list is written as it stands.
 */
export async function saveRuleDraft(): Promise<void> {
  const draft = ruleDraft();
  const current = stored;
  if (!draft || !current) return;
  if (draft.some(rule => !rule.action.trim())) {
    rulesNotice.set("Every rule needs an action, or * for all of them");
    return;
  }
  if (draft.some(rule => !rule.resource.trim())) {
    rulesNotice.set("Every rule needs a resource, for example workspace/*");
    return;
  }
  const rules: PermissionRule[] = draft.map(rule => ({
    action: rule.action.trim(),
    resource: rule.resource.trim(),
    effect: rule.effect,
  }));
  await runStep(async () => {
    const saved = await writePolicy(
      { ...current, policy: { ...current.policy, rules } },
      `Saved ${rules.length} rule${rules.length === 1 ? "" : "s"}`,
      text => rulesNotice.set(text),
    );
    if (saved) ruleDraft.set(null);
  });
}

/**
 * Writes one automatic approval change. The mode owns `approval.strategy`, so an
 * edit here never turns automatic approval on or off by itself.
 */
export async function saveApproval(change: Partial<ApprovalSettings>): Promise<void> {
  const current = stored;
  const settings = approvalSettings();
  if (!current || !settings) return;
  const merged = { ...settings, ...change };
  const approval: ApprovalConfig = {
    strategy: current.approval?.strategy ?? (modeOf(current) === "auto" ? "model" : "interactive"),
    model_kind: merged.modelKind,
    chat_model_id: merged.chatModelId.trim(),
    timeout_ms: Math.round(merged.timeoutSeconds * 1000),
    on_ask: merged.onAsk,
    on_error: merged.onError,
  };
  await runStep(async () => {
    await writePolicy(
      { ...current, approval },
      "Saved automatic approval",
      text => approvalNotice.set(text),
    );
  });
}

/** Writes the decision model's name and endpoint as the two leaves the host stores. */
export async function saveDecisionModel(modelName: string, endpoint: string): Promise<void> {
  await runStep(async () => {
    try {
      const name = modelName.trim();
      if (name) await setConfig("ai.decision_model.model_name", name);
      await setConfig("ai.decision_model.endpoint", endpoint.trim());
      await loadDecisionModel();
      approvalNotice.set("Saved the decision model");
    } catch (error) {
      approvalNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function saveDecisionCredential(secret: string): Promise<void> {
  const value = secret.trim();
  if (!value) {
    approvalNotice.set("A key is needed for the decision model");
    return;
  }
  await runStep(async () => {
    try {
      const status = await invokeCommand<{ configured?: boolean }>("save_decision_model_credential", {
        secret: value,
      });
      decisionCredential.set(status?.configured === true);
      approvalNotice.set("Saved the decision model key");
    } catch (error) {
      approvalNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function clearDecisionCredential(): Promise<void> {
  await runStep(async () => {
    try {
      const status = await invokeCommand<{ configured?: boolean }>("clear_decision_model_credential", {});
      decisionCredential.set(status?.configured === true);
      approvalNotice.set("Removed the decision model key");
    } catch (error) {
      approvalNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export function cancelFullAccess(): void {
  pendingFullAccess.set(false);
}

/** The composer switch a Desktop surface draws; this one keeps the setting. */
export async function setPermissionModeControl(visible: boolean): Promise<void> {
  await runStep(async () => {
    try {
      await setConfig("app.flow_chat.show_permission_mode_control", visible);
      permissionModeControl.set(visible);
      permissionsNotice.set("Saved the composer switch");
    } catch (error) {
      permissionsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

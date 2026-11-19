// State and backend operations for the Agents & Subagents Studio.
//
// Wire signatures follow the desktop Tauri command contracts:
// - `invokeCommand` wraps `{ request }` (agentic_api.rs, custom_agent_api.rs, subagent_api.rs)
// - `invokeRawCommand` sends positional top-level arguments (`list_agent_tool_names`,
//   `get_agent_profile_configs`, `set_agent_profile_config`, `reset_agent_profile_config`)

import { computed, signal } from "nsh";
import { reloadAgentModes } from "./agentModeStore";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { peerScope, peerSupports } from "./peerState";
import { activeWorkspace, activeWorkspaceId, activeWorkspaceRoot, startQuickPromptInSession } from "./state";

export type AgentKind = "mode" | "subagent";
export type AgentSource = "builtin" | "user" | "project" | "external";
export type AgentKindFilter = "all" | AgentKind;
export type AgentSourceFilter = "all" | AgentSource;
export type AgentBuilderMode = "create" | "edit-custom" | "configure-profile" | "configure-subagent" | "inspect-external";

export interface AgentCatalogItem {
  uid: string;
  id: string;
  kind: AgentKind;
  name: string;
  description: string;
  source: AgentSource;
  isReadonly: boolean;
  isReview: boolean;
  toolCount: number;
  defaultTools: string[];
  configProfileId: string;
  model: string | null;
  modelIsExplicit: boolean;
  effectiveEnabled: boolean;
  path?: string;
  externalProviderLabel?: string;
}

export interface AgentBuilderDraft {
  mode: AgentBuilderMode;
  kind: AgentKind;
  level: "user" | "project";
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  readonly: boolean;
  model: string;
  enabled: boolean;
  parentAgentType: string;
  source: AgentSource;
  path: string;
}

function emptyDraft(): AgentBuilderDraft {
  return {
    mode: "create",
    kind: "mode",
    level: "user",
    id: "",
    name: "",
    description: "",
    prompt: "",
    tools: [],
    readonly: false,
    model: "",
    enabled: true,
    parentAgentType: "Standard",
    source: "user",
    path: "",
  };
}

function normalizeSource(value: unknown): AgentSource {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "user" || raw === "project" || raw === "external" || raw === "builtin") {
    return raw;
  }
  return "builtin";
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }
  return [];
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeAgentRow(record: Record<string, unknown>, kind: AgentKind): AgentCatalogItem | null {
  const id = readString(record, ["id", "agentId", "subagentId"]);
  if (!id) return null;
  const defaultTools = readStringArray(record, ["defaultTools", "default_tools", "tools"]);
  const toolCount = readNumber(record, ["toolCount", "tool_count"]) ?? defaultTools.length;
  const source = normalizeSource(
    record.source ?? record.subagentSource ?? record.subagent_source,
  );
  return {
    uid: `${kind}:${id}`,
    id,
    kind,
    name: readString(record, ["name"]) || id,
    description: readString(record, ["description"]),
    source,
    isReadonly: readBoolean(record, ["isReadonly", "is_readonly", "readonly"], false),
    isReview: readBoolean(record, ["isReview", "is_review", "review"], false),
    toolCount,
    defaultTools,
    configProfileId: readString(record, ["configProfileId", "config_profile_id"]) || id,
    model: readOptionalString(record, ["model"]),
    modelIsExplicit: readBoolean(record, ["modelIsExplicit", "model_is_explicit"], false),
    effectiveEnabled: readBoolean(record, ["effectiveEnabled", "effective_enabled", "enabled"], true),
    path: readOptionalString(record, ["path"]) ?? undefined,
    externalProviderLabel:
      readOptionalString(record, ["externalProviderLabel", "external_provider_label"]) ?? undefined,
  };
}

export const agentsLoading = signal(false);
export const agentsCatalogError = signal<string | null>(null);
export const agentsNotice = signal<string | null>(null);
export const availableModes = signal<AgentCatalogItem[]>([]);
export const availableSubagents = signal<AgentCatalogItem[]>([]);
export const agentToolNames = signal<string[]>([]);
export const toolCatalogError = signal<string | null>(null);
export const agentProfileConfigs = signal<Record<string, Record<string, unknown>>>({});
export const agentKindFilter = signal<AgentKindFilter>("all");
export const agentSourceFilter = signal<AgentSourceFilter>("all");
export const agentSearchQuery = signal("");
export const confirmDeleteAgentUid = signal<string | null>(null);
export const builderOpen = signal(false);
export const builderLoading = signal(false);
export const builderSaving = signal(false);
export const builderError = signal<string | null>(null);
export const builderDraft = signal<AgentBuilderDraft>(emptyDraft());
export const agentsLoadedKey = signal<string | null>(null);
/** Tracks the initial model when editing a custom subagent so `update_subagent_config` runs only when changed. */
let initialEditModel = "";

export const allCatalogAgents = computed<AgentCatalogItem[]>(() => [
  ...availableModes(),
  ...availableSubagents(),
]);

export const pendingDeleteAgent = computed<AgentCatalogItem | null>(
  () => allCatalogAgents().find(item => item.uid === confirmDeleteAgentUid()) ?? null,
);

export const filteredAgents = computed<AgentCatalogItem[]>(() => {
  const kind = agentKindFilter();
  const source = agentSourceFilter();
  const query = agentSearchQuery().trim().toLowerCase();
  return allCatalogAgents().filter(item => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (source !== "all" && item.source !== source) return false;
    if (!query) return true;
    const haystack = `${item.id} ${item.name} ${item.description} ${item.model ?? ""} ${item.source}`.toLowerCase();
    return haystack.includes(query);
  });
});

export const selectableToolNames = computed<string[]>(() => {
  const set = new Set<string>(agentToolNames());
  for (const tool of builderDraft().tools) {
    if (tool.trim()) set.add(tool);
  }
  return Array.from(set);
});

export function isRemoteAgentWorkspace(): boolean {
  return activeWorkspace()?.workspaceKind === "remote";
}

export function canMutateCustomAgents(): boolean {
  return !isRemoteAgentWorkspace();
}

export function isCustomSource(source: AgentSource): boolean {
  return source === "user" || source === "project";
}

export function effectiveToolsForAgent(item: AgentCatalogItem): string[] {
  if (item.kind === "mode") {
    const configs = agentProfileConfigs();
    const profile = configs[item.configProfileId] ?? configs[item.id];
    if (profile) {
      const configured = readStringArray(profile, ["enabled_tools", "enabledTools"]);
      if (configured.length > 0 || Array.isArray(profile.enabled_tools) || Array.isArray(profile.enabledTools)) {
        return configured;
      }
    }
  }
  return item.defaultTools;
}

export function effectiveToolCountForAgent(item: AgentCatalogItem): number {
  if (item.kind === "mode") {
    const configs = agentProfileConfigs();
    const profile = configs[item.configProfileId] ?? configs[item.id];
    if (profile && (Array.isArray(profile.enabled_tools) || Array.isArray(profile.enabledTools))) {
      return readStringArray(profile, ["enabled_tools", "enabledTools"]).length;
    }
  }
  return item.defaultTools.length > 0 ? item.defaultTools.length : item.toolCount;
}

let catalogLoadTicket = 0;

export async function loadAgentsCatalog(contextKey?: string): Promise<void> {
  const ticket = ++catalogLoadTicket;
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? undefined;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || undefined;
  const key = contextKey ?? `${peerScope()?.deviceId ?? "local"}:${workspaceId ?? "none"}:${workspacePath ?? ""}`;

  agentsLoading.set(true);
  agentsCatalogError.set(null);
  toolCatalogError.set(null);
  confirmDeleteAgentUid.set(null);

  const canQueryTools = peerScope() ? peerSupports("tool_catalog") !== false : true;

  const [modesRes, subagentsRes, toolsRes, profilesRes] = await Promise.allSettled([
    invokeCommand<Array<Record<string, unknown>>>("get_available_modes", {
      workspaceId,
      ...(workspacePath ? { workspacePath } : {}),
    }),
    invokeCommand<Array<Record<string, unknown>>>("list_subagents", {
      workspaceId,
      ...(workspacePath ? { workspacePath } : {}),
    }),
    canQueryTools ? invokeRawCommand<string[]>("list_agent_tool_names", {}) : Promise.resolve([] as string[]),
    invokeRawCommand<Record<string, Record<string, unknown>>>("get_agent_profile_configs", {}),
  ]);

  if (ticket !== catalogLoadTicket) return;

  const errors: string[] = [];
  if (modesRes.status === "fulfilled") {
    const rows = Array.isArray(modesRes.value) ? modesRes.value : [];
    availableModes.set(
      rows
        .map(row => normalizeAgentRow(row ?? {}, "mode"))
        .filter((item): item is AgentCatalogItem => item !== null),
    );
  } else {
    availableModes.set([]);
    errors.push(modesRes.reason instanceof Error ? modesRes.reason.message : String(modesRes.reason));
  }

  if (subagentsRes.status === "fulfilled") {
    const rows = Array.isArray(subagentsRes.value) ? subagentsRes.value : [];
    availableSubagents.set(
      rows
        .map(row => normalizeAgentRow(row ?? {}, "subagent"))
        .filter((item): item is AgentCatalogItem => item !== null),
    );
  } else {
    availableSubagents.set([]);
    errors.push(subagentsRes.reason instanceof Error ? subagentsRes.reason.message : String(subagentsRes.reason));
  }

  if (!canQueryTools) {
    agentToolNames.set([]);
    toolCatalogError.set("Connected peer host does not expose the tool catalog.");
  } else if (toolsRes.status === "fulfilled") {
    const names = Array.isArray(toolsRes.value)
      ? toolsRes.value.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];
    agentToolNames.set(names);
  } else {
    agentToolNames.set([]);
    toolCatalogError.set(toolsRes.reason instanceof Error ? toolsRes.reason.message : String(toolsRes.reason));
  }

  if (profilesRes.status === "fulfilled" && profilesRes.value && typeof profilesRes.value === "object") {
    agentProfileConfigs.set(profilesRes.value);
  } else if (profilesRes.status === "rejected") {
    agentProfileConfigs.set({});
  }

  if (modesRes.status === "rejected" && subagentsRes.status === "rejected") {
    agentsCatalogError.set(errors.join(" | "));
  } else if (errors.length > 0) {
    agentsNotice.set(errors.join(" | "));
  }

  agentsLoadedKey.set(key);
  agentsLoading.set(false);
}

export async function reloadAgentsCatalog(): Promise<void> {
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? undefined;
  agentsNotice.set(null);

  if (workspace?.workspaceKind !== "remote") {
    await Promise.allSettled([
      invokeCommand<unknown>("reload_custom_agents", {
        ...(workspaceId ? { workspaceId } : {}),
      }),
      ...(workspaceId
        ? [invokeCommand<unknown>("reload_subagents", { workspaceId })]
        : []),
    ]);
  }
  await loadAgentsCatalog();
  reloadAgentModes();
  if (!agentsCatalogError()) {
    agentsNotice.set("Reloaded agent and subagent definitions.");
  }
}

export function startThreadWithMode(modeId: string): void {
  void startQuickPromptInSession("", modeId);
}

export function closeBuilder(): void {
  builderOpen.set(false);
  builderLoading.set(false);
  builderSaving.set(false);
  builderError.set(null);
}

export function openCreateBotBuilder(defaultKind: AgentKind = "mode"): void {
  if (isRemoteAgentWorkspace()) {
    agentsNotice.set("Custom agent creation is unsupported for remote workspaces.");
    return;
  }
  confirmDeleteAgentUid.set(null);
  const availableTools = agentToolNames();
  const initialTools = defaultKind === "mode"
    ? availableTools.slice(0, Math.min(8, availableTools.length))
    : ["LS", "Read", "Glob", "Grep"].filter(tool => availableTools.length === 0 || availableTools.includes(tool));
  builderError.set(null);
  builderLoading.set(false);
  builderSaving.set(false);
  builderDraft.set({
    mode: "create",
    kind: defaultKind,
    level: "user",
    id: "",
    name: "",
    description: "",
    prompt: "",
    tools: initialTools,
    readonly: defaultKind === "subagent",
    model: "",
    enabled: true,
    parentAgentType: availableModes()[0]?.id ?? "Standard",
    source: "user",
    path: "",
  });
  builderOpen.set(true);
}

export function updateBuilderDraft(patch: Partial<AgentBuilderDraft>): void {
  builderDraft.update(current => {
    const next = { ...current, ...patch };
    if (patch.kind === "mode" && next.mode === "create") {
      next.level = "user";
    }
    return next;
  });
}

export function toggleBuilderTool(toolName: string): void {
  builderDraft.update(current => {
    const exists = current.tools.includes(toolName);
    const nextTools = exists
      ? current.tools.filter(item => item !== toolName)
      : [...current.tools, toolName];
    return { ...current, tools: nextTools };
  });
}

export function selectAllBuilderTools(): void {
  builderDraft.update(current => ({
    ...current,
    tools: [...selectableToolNames()],
  }));
}

export function clearBuilderTools(): void {
  builderDraft.update(current => ({
    ...current,
    tools: [],
  }));
}

export async function openAgentInspector(item: AgentCatalogItem): Promise<void> {
  const workspaceId = activeWorkspaceId() ?? undefined;
  confirmDeleteAgentUid.set(null);
  builderError.set(null);
  builderSaving.set(false);
  builderOpen.set(true);

  if (item.source === "external") {
    builderLoading.set(false);
    builderDraft.set({
      mode: "inspect-external",
      kind: item.kind,
      level: "user",
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: "",
      tools: [...item.defaultTools],
      readonly: item.isReadonly,
      model: item.model ?? "",
      enabled: item.effectiveEnabled,
      parentAgentType: availableModes()[0]?.id ?? "Standard",
      source: item.source,
      path: item.path ?? "",
    });
    return;
  }

  if (item.kind === "mode" && item.source === "builtin") {
    builderLoading.set(false);
    const tools = effectiveToolsForAgent(item);
    builderDraft.set({
      mode: "configure-profile",
      kind: "mode",
      level: "user",
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: "",
      tools: [...tools],
      readonly: item.isReadonly,
      model: item.model ?? "",
      enabled: true,
      parentAgentType: item.id,
      source: "builtin",
      path: item.path ?? "",
    });
    return;
  }

  if (item.kind === "subagent" && item.source === "builtin") {
    builderLoading.set(false);
    builderDraft.set({
      mode: "configure-subagent",
      kind: "subagent",
      level: "user",
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: "",
      tools: [...item.defaultTools],
      readonly: item.isReadonly,
      model: item.model ?? "",
      enabled: item.effectiveEnabled,
      parentAgentType: availableModes()[0]?.id ?? "Standard",
      source: "builtin",
      path: item.path ?? "",
    });
    return;
  }

  if (isRemoteAgentWorkspace()) {
    builderLoading.set(false);
    builderDraft.set({
      mode: "inspect-external",
      kind: item.kind,
      level: item.source === "project" ? "project" : "user",
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: "",
      tools: [...item.defaultTools],
      readonly: item.isReadonly,
      model: item.model ?? "",
      enabled: item.effectiveEnabled,
      parentAgentType: availableModes()[0]?.id ?? "Standard",
      source: item.source,
      path: item.path ?? "",
    });
    builderError.set("Custom agent inspection and editing are unsupported for remote workspaces.");
    return;
  }

  builderLoading.set(true);
  initialEditModel = item.kind === "subagent" ? (item.model ?? "").trim() : "";
  builderDraft.set({
    mode: "edit-custom",
    kind: item.kind,
    level: item.source === "project" ? "project" : "user",
    id: item.id,
    name: item.name,
    description: item.description,
    prompt: "",
    tools: [...item.defaultTools],
    readonly: item.isReadonly,
    model: item.model ?? "",
    enabled: item.effectiveEnabled,
    parentAgentType: availableModes()[0]?.id ?? "Standard",
    source: item.source,
    path: item.path ?? "",
  });

  try {
    if (item.kind === "mode") {
      const detail = await invokeCommand<Record<string, unknown>>("get_custom_agent_detail", {
        agentId: item.id,
        ...(workspaceId ? { workspaceId } : {}),
      });
      const tools = readStringArray(detail, ["tools", "defaultTools"]);
      builderDraft.update(current => ({
        ...current,
        id: readString(detail, ["agentId", "id"]) || current.id,
        name: readString(detail, ["name"]) || current.name,
        description: readString(detail, ["description"]) || current.description,
        prompt: readString(detail, ["prompt"]),
        tools: tools.length > 0 ? tools : current.tools,
        readonly: readBoolean(detail, ["readonly", "isReadonly"], current.readonly),
        model: readOptionalString(detail, ["model"]) ?? current.model,
        level: readString(detail, ["level"]) === "project" ? "project" : "user",
        path: readString(detail, ["path"]) || current.path,
      }));
    } else {
      const detail = await invokeCommand<Record<string, unknown>>("get_subagent_detail", {
        subagentId: item.id,
        ...(workspaceId ? { workspaceId } : {}),
      });
      const tools = readStringArray(detail, ["tools", "defaultTools"]);
      const loadedModel = (readOptionalString(detail, ["model"]) ?? item.model ?? "").trim();
      initialEditModel = loadedModel;
      builderDraft.update(current => ({
        ...current,
        id: readString(detail, ["subagentId", "agentId", "id"]) || current.id,
        name: readString(detail, ["name"]) || current.name,
        description: readString(detail, ["description"]) || current.description,
        prompt: readString(detail, ["prompt"]),
        tools: tools.length > 0 ? tools : current.tools,
        readonly: readBoolean(detail, ["readonly", "isReadonly"], current.readonly),
        model: loadedModel,
        enabled: readBoolean(detail, ["enabled", "effectiveEnabled"], current.enabled),
        level: readString(detail, ["level"]) === "project" ? "project" : "user",
        path: readString(detail, ["path"]) || current.path,
      }));
    }
  } catch (error) {
    builderError.set(error instanceof Error ? error.message : String(error));
  } finally {
    builderLoading.set(false);
  }
}

export async function saveBuilderBot(): Promise<void> {
  const draft = builderDraft();
  const workspaceId = activeWorkspaceId() ?? undefined;
  builderError.set(null);

  if (isRemoteAgentWorkspace()) {
    builderError.set("Custom agent management is unsupported for remote workspaces.");
    return;
  }

  const trimmedId = draft.id.trim();
  const trimmedName = draft.name.trim() || trimmedId;
  const resolvedId = trimmedId || trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const trimmedDesc = draft.description.trim();
  const trimmedPrompt = draft.prompt.trim();
  const trimmedModel = draft.model.trim();

  if (draft.mode === "create" && !resolvedId) {
    builderError.set("Bot ID is required.");
    return;
  }
  if (!trimmedName) {
    builderError.set("Name is required.");
    return;
  }
  if (!trimmedDesc) {
    builderError.set("Description is required.");
    return;
  }
  if (!trimmedPrompt) {
    builderError.set("System prompt is required.");
    return;
  }
  if (draft.kind === "subagent" && draft.level === "project" && !workspaceId) {
    builderError.set("Project-level subagents require an active workspace.");
    return;
  }

  builderSaving.set(true);
  try {
    if (draft.mode === "create") {
      if (draft.kind === "mode") {
        await invokeCommand<unknown>("create_custom_agent", {
          kind: "mode",
          level: draft.level,
          id: resolvedId,
          name: trimmedName,
          description: trimmedDesc,
          prompt: trimmedPrompt,
          tools: draft.tools,
          readonly: draft.readonly,
          model: trimmedModel || null,
          ...(workspaceId ? { workspaceId } : {}),
        });
      } else {
        await invokeCommand<unknown>("create_subagent", {
          level: draft.level,
          id: resolvedId,
          name: trimmedName,
          description: trimmedDesc,
          prompt: trimmedPrompt,
          tools: draft.tools,
          readonly: draft.readonly,
          ...(workspaceId ? { workspaceId } : {}),
        });
        // Real Rust `CreateSubagentRequest` has no `model` field; subagent
        // model overrides are persisted via `update_subagent_config`.
        if (trimmedModel) {
          await invokeCommand<unknown>("update_subagent_config", {
            subagentId: resolvedId,
            model: trimmedModel,
            ...(workspaceId ? { workspaceId } : {}),
          });
        }
      }
      agentsNotice.set(`Created ${draft.kind === "mode" ? "primary agent" : "subagent"} '${trimmedName}'.`);
    } else if (draft.mode === "edit-custom") {
      if (draft.kind === "mode") {
        await invokeCommand<unknown>("update_custom_agent", {
          agentId: draft.id,
          name: trimmedName,
          description: trimmedDesc,
          prompt: trimmedPrompt,
          tools: draft.tools,
          readonly: draft.readonly,
          model: trimmedModel || null,
          ...(workspaceId ? { workspaceId } : {}),
        });
      } else {
        await invokeCommand<unknown>("update_subagent", {
          subagentId: draft.id,
          name: trimmedName,
          description: trimmedDesc,
          prompt: trimmedPrompt,
          tools: draft.tools,
          readonly: draft.readonly,
          ...(workspaceId ? { workspaceId } : {}),
        });
        // Real Rust `UpdateSubagentRequest` has no `model` field; persist
        // model changes (or clears) through `update_subagent_config`.
        if (trimmedModel !== initialEditModel) {
          await invokeCommand<unknown>("update_subagent_config", {
            subagentId: draft.id,
            ...(trimmedModel ? { model: trimmedModel } : { clearModelOverride: true }),
            ...(workspaceId ? { workspaceId } : {}),
          });
          initialEditModel = trimmedModel;
        }
      }
      agentsNotice.set(`Updated '${trimmedName}'.`);
    }
    builderOpen.set(false);
    await loadAgentsCatalog();
    reloadAgentModes();
  } catch (error) {
    builderError.set(error instanceof Error ? error.message : String(error));
  } finally {
    builderSaving.set(false);
  }
}

export async function saveProfileConfig(): Promise<void> {
  const draft = builderDraft();
  if (draft.mode !== "configure-profile") return;
  builderError.set(null);
  builderSaving.set(true);
  try {
    const modeItem = availableModes().find(item => item.id === draft.id);
    const profileKey = modeItem?.configProfileId || draft.id;
    const existing = agentProfileConfigs()[profileKey] ?? agentProfileConfigs()[draft.id] ?? {};
    const config = {
      ...existing,
      profile_id: (existing.profile_id as string | undefined) ?? profileKey,
      default_tools: (existing.default_tools as string[] | undefined) ?? modeItem?.defaultTools ?? [],
      enabled_tools: [...draft.tools],
    };
    await invokeRawCommand<unknown>("set_agent_profile_config", {
      agentId: draft.id,
      config,
    });
    agentsNotice.set(`Saved profile tool settings for '${draft.name}'.`);
    await loadAgentsCatalog();
    reloadAgentModes();
  } catch (error) {
    builderError.set(error instanceof Error ? error.message : String(error));
  } finally {
    builderSaving.set(false);
  }
}

export async function resetProfileConfig(): Promise<void> {
  const draft = builderDraft();
  if (draft.mode !== "configure-profile") return;
  builderError.set(null);
  builderSaving.set(true);
  try {
    await invokeRawCommand<unknown>("reset_agent_profile_config", {
      agentId: draft.id,
    });
    await loadAgentsCatalog();
    const refreshed = availableModes().find(item => item.id === draft.id);
    if (refreshed) {
      builderDraft.update(current => ({
        ...current,
        tools: [...effectiveToolsForAgent(refreshed)],
      }));
    }
    reloadAgentModes();
    agentsNotice.set(`Reset profile '${draft.name}' to defaults.`);
  } catch (error) {
    builderError.set(error instanceof Error ? error.message : String(error));
  } finally {
    builderSaving.set(false);
  }
}

export async function saveSubagentRuntimeConfig(): Promise<void> {
  const draft = builderDraft();
  if (draft.kind !== "subagent") return;
  const workspaceId = activeWorkspaceId() ?? undefined;
  if (isRemoteAgentWorkspace()) {
    builderError.set("Subagent configuration is unsupported for remote workspaces.");
    return;
  }
  builderError.set(null);
  builderSaving.set(true);
  try {
    const trimmedModel = draft.model.trim();
    await invokeCommand<unknown>("update_subagent_config", {
      subagentId: draft.id,
      enabled: draft.enabled,
      model: trimmedModel || null,
      parentAgentType: draft.parentAgentType || "Standard",
      ...(workspaceId ? { workspaceId } : {}),
    });
    agentsNotice.set(`Updated runtime config for subagent '${draft.name}'.`);
    await loadAgentsCatalog();
  } catch (error) {
    builderError.set(error instanceof Error ? error.message : String(error));
  } finally {
    builderSaving.set(false);
  }
}

export async function deleteCatalogAgent(item: AgentCatalogItem): Promise<void> {
  if (!isCustomSource(item.source)) return;
  if (isRemoteAgentWorkspace()) {
    agentsNotice.set("Custom agent deletion is unsupported for remote workspaces.");
    return;
  }
  const workspaceId = activeWorkspaceId() ?? undefined;
  agentsNotice.set(null);
  try {
    if (item.kind === "mode") {
      await invokeCommand<unknown>("delete_custom_agent", {
        agentId: item.id,
        ...(workspaceId ? { workspaceId } : {}),
      });
    } else {
      await invokeCommand<unknown>("delete_subagent", {
        subagentId: item.id,
        ...(workspaceId ? { workspaceId } : {}),
      });
    }
    confirmDeleteAgentUid.set(null);
    if (builderOpen() && builderDraft().id === item.id && builderDraft().kind === item.kind) {
      closeBuilder();
    }
    agentsNotice.set(`Deleted '${item.name}'.`);
    await loadAgentsCatalog();
    reloadAgentModes();
  } catch (error) {
    agentsNotice.set(error instanceof Error ? error.message : String(error));
  }
}

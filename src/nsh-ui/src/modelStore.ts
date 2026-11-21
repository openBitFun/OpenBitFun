// The models a chat can run and the one each session picked. The host keeps the
// catalog and the session binding; this store only mirrors them for the composer.

import { computed, signal } from "nsh";
import {
  getConfig,
  getModelCatalog,
  getSessionModelTarget,
  projectAiModelReasoningCatalog,
  updateSessionModel,
  type ModelCatalogEntry,
  type ReasoningCatalogProjection,
} from "./api";
import { entryDeviceId, fleetActive, invokeCommand, listenEvent } from "./bridge";
import { FLEET_INDEX_CHANGED_EVENT } from "./fleetTypes";
import { loadModels as loadStoredModels, storedModels, type StoredModel } from "./modelSettingsStore";
import { activeSessionId, activeWorkspaceId, deviceOfSession, onWorkspaceChanged, runStep, sessions } from "./state";

// ── The account-wide catalog (`fleet_models`) ─────────────────────────────────
// Every device's models, grouped by device, as the entry projects them: the
// device that runs the session first, each device's state, which rows can be
// picked, and the reference to store. Nothing is ordered or gated here.

/** One configured model of a device (`FleetModel`). */
export interface FleetModel {
  modelId: string;
  displayName: string;
  provider: string;
  modelName?: string;
  capabilities?: string[];
  contextWindow?: number;
  primary?: boolean;
}

/** One row of the picker (`FleetModelChoice`). */
export interface FleetModelChoice extends FleetModel {
  /** What `update_session_model` stores (plain for this device, `fleet:<device>/<model>` otherwise). */
  modelRef: string;
  selectable: boolean;
}

/** One device's group (`FleetModelsDevice`). */
export interface FleetModelsDevice {
  deviceId: string;
  name: string;
  hostKind?: string;
  state?: string;
  online: boolean;
  isThisDevice: boolean;
  /** `device_offline`, `device_requires_update`, `no_model`; absent when its models can be picked. */
  unavailableReason?: string;
  models: FleetModelChoice[];
}

/** The groups the entry answered for the open session, or `null` (no fleet, older host): the local list. */
export const fleetModelGroups = signal<FleetModelsDevice[] | null>(null);

/** The device that runs the open session, when it is not the entry itself (`fleet_models {deviceId}`). */
function catalogDeviceId(): string | undefined {
  const owner = deviceOfSession(activeSessionId());
  return owner && owner !== entryDeviceId() ? owner : undefined;
}

let fleetModelsTicket = 0;
let fleetModelsFollowing = false;

/**
 * Reads `fleet_models` for the open session. A host that does not answer it
 * (signed out, no fleet, an older build) keeps the local-only list.
 */
export async function refreshFleetModels(): Promise<void> {
  const ticket = ++fleetModelsTicket;
  if (!fleetActive()) {
    fleetModelGroups.set(null);
    return;
  }
  if (!fleetModelsFollowing) {
    fleetModelsFollowing = true;
    listenEvent(FLEET_INDEX_CHANGED_EVENT, () => {
      if (fleetModelGroups() !== null) void refreshFleetModels();
    });
  }
  const deviceId = catalogDeviceId();
  try {
    const answer = await invokeCommand<{ devices?: FleetModelsDevice[] }>(
      "fleet_models",
      deviceId ? { deviceId } : {},
    );
    if (ticket !== fleetModelsTicket) return;
    fleetModelGroups.set(Array.isArray(answer?.devices) && answer.devices.length > 0 ? answer.devices : null);
  } catch {
    if (ticket === fleetModelsTicket) fleetModelGroups.set(null);
  }
}

/** The catalog row and its device for a stored reference, when the catalog lists it. */
export function fleetChoiceOf(ref: string | null | undefined): { device: FleetModelsDevice; choice: FleetModelChoice } | null {
  if (!ref) return null;
  for (const device of fleetModelGroups() ?? []) {
    const choice = device.models.find(model => model.modelRef === ref);
    if (choice) return { device, choice };
  }
  return null;
}

export interface ModelOption {
  /** Wire value sent to `update_session_model` (config ID on real Rust hosts). */
  id: string;
  /** Stable config entry ID from `RemoteModelConfig.id`. */
  configId: string;
  /** Upstream model identifier (`RemoteModelConfig.model_name`). */
  modelName: string;
  label: string;
  provider: string;
  /** Models that cannot chat (image or speech models) are not offered. */
  chat: boolean;
  /** The context window the catalog declares, for the composer's usage ring. */
  contextWindow?: number;
}

export const models = signal<ModelOption[]>([]);
/** Role -> configured model reference from `catalog.default_models` (e.g. `primary`, `fast`). */
export const defaultModels = signal<Record<string, string | null | undefined>>({});
/** The workspace's default when the session has not been bound to one yet. */
export const defaultModelId = signal<string | null>(null);
/** Session id → the model the user picked in this surface. */
export const sessionModels = signal<Record<string, string>>({});
export const modelPickerOpen = signal(false);

const SYMBOLIC_PRIMARY_ROLES = new Set(["", "primary", "auto", "default"]);

function findOption(ref: string | null | undefined): ModelOption | undefined {
  if (!ref) return undefined;
  const list = models();
  return (
    list.find(option => option.id === ref) ??
    list.find(option => option.configId === ref) ??
    list.find(option => option.modelName === ref)
  );
}

/**
 * Resolves symbolic session roles (`"primary"`, `"fast"`, `"auto"`, `"default"`)
 * against `catalog.default_models` so the composer shows the real configured
 * model name instead of a raw internal role string.
 */
export function resolveModelRef(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return defaultModelId();

  // An explicit configured model whose ID literally equals a role name wins first.
  const direct = findOption(trimmed);
  if (direct) return direct.id;

  const lower = trimmed.toLowerCase();
  const defaults = defaultModels();
  if (SYMBOLIC_PRIMARY_ROLES.has(lower)) {
    const primaryRef = defaults.primary;
    const primaryMatch = findOption(primaryRef);
    if (primaryMatch) return primaryMatch.id;
    return defaultModelId() ?? (primaryRef && primaryRef.trim() ? primaryRef.trim() : null);
  }
  if (lower === "fast") {
    const fastRef = defaults.fast ?? defaults.primary;
    const fastMatch = findOption(fastRef);
    if (fastMatch) return fastMatch.id;
    return defaultModelId() ?? (fastRef && fastRef.trim() ? fastRef.trim() : null);
  }

  // Unknown session-only model id stays verbatim so the user sees what the session ran on.
  return trimmed;
}

export const activeModelId = computed<string | null>(() => {
  const sessionId = activeSessionId();
  if (!sessionId) return resolveModelRef(defaultModelId());
  const raw = sessionModels()[sessionId] ?? boundModelOf(sessionId) ?? defaultModelId();
  return resolveModelRef(raw);
});

/** The model the host already has this session on, from its own record. */
function boundModelOf(sessionId: string): string | undefined {
  const name = sessions().find(row => row.sessionId === sessionId)?.modelName;
  return name && name.trim() ? name.trim() : undefined;
}

export const activeModelLabel = computed<string>(() => {
  const id = activeModelId();
  if (!id) return "default model";
  const match = findOption(id);
  if (match) return match.label;
  // Another device's model: its name and the device it lives on.
  const remote = fleetChoiceOf(id);
  if (remote && !remote.device.isThisDevice) return `${remote.choice.displayName || remote.choice.modelId} · ${remote.device.name}`;
  return remote ? remote.choice.displayName || id : id;
});

/** What the picker offers: a model that cannot chat is not a choice here. */
export const chatModels = computed<ModelOption[]>(() => models().filter(option => option.chat));

function projectionToChoices(projection: ReasoningCatalogProjection | null | undefined): ReasoningChoice[] | null {
  if (!projection || typeof projection !== "object") return null;
  if (projection.status === "unsupported") return [];
  return (projection.presets ?? [])
    .filter(preset => preset && preset.id)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map(preset => ({ id: preset.id, label: preset.label || preset.id }));
}

/** Loads the catalog once per workspace; the composer asks on mount. */
export function ensureModelsLoaded(): void {
  void refreshFleetModels();
  if (models().length) return;
  // A host without a catalog leaves the composer on its default model instead of
  // showing a failure banner for a picker the user did not ask for.
  void loadModels().catch(() => undefined);
}

export async function loadModels(): Promise<void> {
  await runStep(
    async () => {
      const catalog = await getModelCatalog();
      const rawEntries = (catalog?.models ?? []).filter(
        entry => entry && entry.enabled !== false && (entry.id || entry.model_name),
      );
      const preferred = catalog?.default_models?.primary ?? null;
      // Real Rust `get_ai_model_catalog` keys `default_models.primary` and
      // `update_session_model` by `entry.id` (config ID). Legacy mock fixtures
      // occasionally point `default_models.primary` at `entry.model_name` while
      // using a distinct `entry.id`; detect that shape without breaking real hosts.
      const legacyModelNameKeying = Boolean(
        preferred && rawEntries.some(entry => entry.model_name === preferred && entry.id !== preferred),
      );

      const options = rawEntries.map(entry => optionOf(entry, legacyModelNameKeying));
      models.set(options);
      defaultModels.set({ ...(catalog?.default_models ?? {}) });

      // Seed embedded reasoning projections straight from `get_ai_model_catalog`
      // so real Tauri hosts need zero extra `get_config`/`project_*` IPCs.
      const embeddedReasoning: Record<string, ReasoningChoice[]> = {};
      for (let index = 0; index < rawEntries.length; index += 1) {
        const choices = projectionToChoices(rawEntries[index].reasoning);
        if (choices !== null) {
          embeddedReasoning[options[index].id] = choices;
        }
      }
      if (Object.keys(embeddedReasoning).length > 0) {
        reasoningByModel.update(current => ({ ...current, ...embeddedReasoning }));
      }

      const usable = preferred
        ? options.find(option => option.id === preferred || option.configId === preferred || option.modelName === preferred)?.id ?? null
        : null;
      defaultModelId.set(usable ?? options.find(option => option.chat)?.id ?? null);
    },
    { trackBusy: false, clearError: false },
  );
}

function optionOf(entry: ModelCatalogEntry, legacyModelNameKeying: boolean): ModelOption {
  const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];
  const configId = entry.id || entry.model_name;
  const modelName = entry.model_name || entry.id;
  return {
    id: legacyModelNameKeying ? modelName : configId,
    configId,
    modelName,
    label: entry.name || modelName,
    provider: entry.provider ?? "",
    // Real Rust emits `"text_chat"`; accept `"chat"` as well for legacy fixtures.
    // An empty capability list stays offerable for hosts without capability metadata.
    chat:
      capabilities.length === 0 ||
      capabilities.includes("text_chat") ||
      capabilities.includes("chat"),
    ...(typeof entry.context_window === "number" && entry.context_window > 0
      ? { contextWindow: entry.context_window }
      : {}),
  };
}

/** Binds the selected session to a model, the way the composer's picker does. */
export async function chooseModel(modelId: string): Promise<void> {
  const sessionId = activeSessionId();
  modelPickerOpen.set(false);
  if (!sessionId) return;
  const resolved = findOption(modelId)?.id ?? modelId;
  const workspaceId = activeWorkspaceId();
  await runStep(async () => {
    await updateSessionModel({
      sessionId,
      modelName: resolved,
      // A preset the new model does not offer would be refused as a pair, so the
      // session keeps its setting only when this surface knows it is offered.
      ...(reasoningOfferedFor(resolved) ? { reasoningPreset: activeReasoningId() } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      includeInternal: false,
    });
    sessionModels.update(current => ({ ...current, [sessionId]: resolved }));
    if (!reasoningOfferedFor(resolved)) applyReasoningToSession(sessionId, null);
  });
}

/** One reasoning setting a model offers, as the composer draws it. */
export interface ReasoningChoice {
  id: string;
  label: string;
}

/** Session id → the reasoning setting the host reported or this surface wrote. */
export const sessionReasoning = signal<Record<string, string | null>>({});
/** Model id → the settings that model offers; `null` before the host answered. */
export const reasoningByModel = signal<Record<string, ReasoningChoice[] | null>>({});
export const reasoningPickerOpen = signal(false);

/**
 * Session id → the model whose reasoning was already read. The composer's effect
 * recomputes the active model whenever the session catalog moves, and a host round
 * trip per pass would be paid for nothing.
 */
const reasoningReadFor: Record<string, string> = {};

/**
 * What the next turn runs at, `null` for the model's own default. A session this
 * surface never read a setting for reads as the default rather than as an unknown
 * value, which is also how the host reports a session nobody has set.
 */
export const activeReasoningId = computed<string | null>(() => {
  const sessionId = activeSessionId();
  if (!sessionId) return null;
  return sessionReasoning()[sessionId] ?? null;
});

export const activeReasoningChoices = computed<ReasoningChoice[]>(() => {
  const modelId = activeModelId();
  if (!modelId) return [];
  return reasoningByModel()[modelId] ?? [];
});

export const activeReasoningLabel = computed<string>(() => {
  const id = activeReasoningId();
  if (!id) return "Default";
  const match = activeReasoningChoices().find(choice => choice.id === id);
  return match ? match.label : id;
});

function reasoningOfferedFor(modelId: string): boolean {
  const choices = reasoningByModel()[modelId];
  // Until the host answers, the pair is left alone: sending a preset it may not
  // know would make the model change fail, which is worse than not carrying it.
  if (choices === null || choices === undefined) return false;
  const id = activeReasoningId();
  return id !== null && choices.some(choice => choice.id === id);
}

function applyReasoningToSession(sessionId: string, preset: string | null): void {
  sessionReasoning.update(current => ({ ...current, [sessionId]: preset }));
}

/**
 * Reads the session's own binding and, from the model it runs, the settings that
 * model offers. A host without the catalog commands leaves both empty and the
 * composer draws no reasoning control at all.
 */
export async function ensureReasoningLoaded(): Promise<void> {
  const sessionId = activeSessionId();
  const modelId = activeModelId();
  if (!sessionId || !modelId) return;
  // The effect that asks for this re-runs whenever the model binding is recomputed,
  // so a session already read is not read again on every pass.
  if (reasoningReadFor[sessionId] === modelId) return;
  reasoningReadFor[sessionId] = modelId;
  const workspaceId = activeWorkspaceId();
  const alreadyKnown = reasoningByModel()[modelId];
  await runStep(
    async () => {
      if (alreadyKnown === undefined) {
        reasoningByModel.update(current => ({ ...current, [modelId]: null }));
        const choices = await reasoningChoicesFor(modelId).catch(() => [] as ReasoningChoice[]);
        reasoningByModel.update(current => ({ ...current, [modelId]: choices }));
      }
      const target = await getSessionModelTarget({
        sessionId,
        ...(workspaceId ? { workspaceId } : {}),
      }).catch(() => null);
      // A host older than the field omits it; that is not a session set to the
      // default, so nothing is written for it.
      if (!target || target.reasoningPreset === undefined) return;
      applyReasoningToSession(sessionId, target.reasoningPreset ?? null);
    },
    { trackBusy: false, clearError: false },
  );
}

/** The presets a model's provider compiles its reasoning into (fallback when catalog omitted `reasoning`). */
async function reasoningChoicesFor(modelId: string): Promise<ReasoningChoice[]> {
  const entry = await storedModelEntry(modelId);
  if (!entry) return [];
  const block = entry.reasoning;
  const projection = await projectAiModelReasoningCatalog({
    provider: entry.provider,
    modelName: entry.model_name,
    baseUrl: entry.base_url ?? "",
    ...(typeof entry.context_window === "number" ? { contextWindow: entry.context_window } : {}),
    ...(typeof entry.max_tokens === "number" ? { maxTokens: entry.max_tokens } : {}),
    reasoning: block && typeof block === "object" ? (block as Record<string, unknown>) : {},
  });
  return projectionToChoices(projection) ?? [];
}

/**
 * The model's own `ai.models` entry. Used only as fallback when `get_ai_model_catalog`
 * did not embed the model's projected reasoning presets.
 */
async function storedModelEntry(modelId: string): Promise<StoredModel | null> {
  if (!storedModels().length) {
    await loadStoredModels().catch(() => undefined);
  }
  const opt = findOption(modelId);
  const direct = storedModels().find(
    entry =>
      entry.id === modelId ||
      entry.model_name === modelId ||
      (opt ? entry.id === opt.configId || entry.model_name === opt.modelName : false),
  );
  if (direct) return direct;
  // A session can name a role (`primary`) rather than a model, which is what an
  // install that never picked one stores. The host's own default table resolves
  // it, and that model is what the runtime will run.
  const defaults = (await getConfig("ai.default_models", true).catch(() => null)) as
    | Record<string, string | null>
    | null;
  const resolved = defaults?.[modelId];
  if (!resolved) return null;
  return storedModels().find(entry => entry.id === resolved || entry.model_name === resolved) ?? null;
}

/** Sets the reasoning the next turn runs at, alongside the model it is bound to. */
export async function chooseReasoning(presetId: string | null): Promise<void> {
  const sessionId = activeSessionId();
  const modelId = activeModelId();
  reasoningPickerOpen.set(false);
  if (!sessionId || !modelId) return;
  const workspaceId = activeWorkspaceId();
  await runStep(async () => {
    await updateSessionModel({
      sessionId,
      modelName: modelId,
      reasoningPreset: presetId,
      ...(workspaceId ? { workspaceId } : {}),
      includeInternal: false,
    });
    applyReasoningToSession(sessionId, presetId);
  });
}

onWorkspaceChanged(() => {
  models.set([]);
  defaultModels.set({});
  defaultModelId.set(null);
  sessionModels.set({});
  fleetModelGroups.set(null);
  modelPickerOpen.set(false);
  // Presets belong to a model and a session belongs to a workspace, so neither
  // reading survives that change.
  reasoningPickerOpen.set(false);
  sessionReasoning.set({});
  reasoningByModel.set({});
  for (const sessionId of Object.keys(reasoningReadFor)) delete reasoningReadFor[sessionId];
  void loadModels().catch(() => undefined);
});

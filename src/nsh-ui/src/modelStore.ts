// The models a chat can run and the one each session picked. The host keeps the
// catalog and the session binding; this store only mirrors them for the composer.

import { computed, signal } from "nsh";
import {
  getConfig,
  getModelCatalog,
  getSessionModelTarget,
  projectAiModelReasoningCatalog,
  updateSessionModel,
  updateSessionModelTarget,
  type ModelCatalogEntry,
  type ReasoningCatalogProjection,
  type SessionModelTargetResponse,
} from "./api";
import { entryDeviceId, fleetActive, invokeCommand, listenEvent } from "./bridge";
import { FLEET_INDEX_CHANGED_EVENT } from "./fleetTypes";
import {
  loadModels as loadStoredModels,
  onDefaultModelsChanged,
  storedModels,
  type StoredModel,
} from "./modelSettingsStore";
import {
  activeSessionDevice,
  activeSessionId,
  activeSessionKey,
  activeWorkspaceId,
  deviceOfSession,
  onSessionCreated,
  onWorkspaceChanged,
  runStep,
  sessionKey,
  sessions,
} from "./state";

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
  /** What every list shows first: the model (the host's label rule). */
  label?: string;
  /** The secondary text beside `label`: the provider, numbered when two read the same. */
  detail?: string;
}

/**
 * A device model's label and secondary text as the host projected them. A host
 * from before the label rule sends neither: its name and provider are read as
 * they were shown then.
 */
export function fleetModelText(model: FleetModel): { label: string; detail: string } {
  if (model.label) return { label: model.label, detail: model.detail ?? "" };
  return { label: model.displayName || model.modelId, detail: model.provider ?? "" };
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
  /** What the picker shows first (the host's `label`). */
  label: string;
  /** The secondary text beside `label` (the host's `detail`). */
  detail: string;
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
/** `sessionKey` → the model the host reported or the user picked in this surface. */
export const sessionModels = signal<Record<string, string>>({});
/** `sessionKey` → pool id when the session is bound to a model pool. */
const sessionPoolIds = signal<Record<string, string>>({});
export const modelPickerOpen = signal(false);

/** Monotonic write counter per `sessionKey` so an in-flight read cannot overwrite a newer pick. */
const sessionWriteGen: Record<string, number> = {};
/** `sessionKey`s whose `get_session_model_target` has already been read for this workspace. */
const targetReadFor = new Set<string>();
let modelEventsSubscribed = false;

function bumpWriteGen(key: string): number {
  const next = (sessionWriteGen[key] ?? 0) + 1;
  sessionWriteGen[key] = next;
  return next;
}

function setSessionModelBinding(
  key: string,
  sessionId: string,
  modelRef: string,
  poolId?: string | null,
): void {
  sessionModels.update(current => (current[key] === modelRef ? current : { ...current, [key]: modelRef }));
  if (poolId) {
    sessionPoolIds.update(current => (current[key] === poolId ? current : { ...current, [key]: poolId }));
  } else if (key in sessionPoolIds()) {
    sessionPoolIds.update(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  sessions.update(rows => {
    let changed = false;
    const next = rows.map(row => {
      if (row.sessionId !== sessionId || row.modelName === modelRef) return row;
      changed = true;
      return { ...row, modelName: modelRef };
    });
    return changed ? next : rows;
  });
}

function extractTargetModel(target: SessionModelTargetResponse): { modelRef: string | null; poolId: string | null } {
  const selection = target.selection;
  if (selection && typeof selection === "object") {
    if (selection.kind === "model") {
      const ref = typeof selection.model_ref === "string" ? selection.model_ref.trim() : "";
      if (ref) return { modelRef: ref, poolId: null };
    } else if (selection.kind === "pool") {
      const poolId = typeof selection.pool_id === "string" ? selection.pool_id.trim() : "";
      const boundModel = typeof target.binding?.modelId === "string" ? target.binding.modelId.trim() : "";
      return { modelRef: boundModel || poolId || null, poolId: poolId || null };
    }
  }
  const legacyModel = typeof target.modelId === "string" ? target.modelId.trim() : "";
  return { modelRef: legacyModel || null, poolId: null };
}

function subscribeModelEvents(): void {
  if (modelEventsSubscribed) return;
  modelEventsSubscribed = true;
  listenEvent<{ sessionId?: string; newModelId?: string }>(
    "agentic://session-model-fallback-applied",
    (payload, meta) => {
      const sid = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
      const nextModel = typeof payload?.newModelId === "string" ? payload.newModelId.trim() : "";
      if (!sid || !nextModel) return;
      const key = sessionKey(sid, meta?.origin);
      bumpWriteGen(key);
      targetReadFor.add(key);
      setSessionModelBinding(key, sid, nextModel, null);
    },
  );
  listenEvent<{ sessionId?: string }>(
    "agentic://session-reasoning-preset-auto-cleared",
    (payload, meta) => {
      const sid = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
      if (!sid) return;
      const key = sessionKey(sid, meta?.origin);
      applyReasoningToSession(key, null);
    },
  );
}

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

export interface SessionModelTarget {
  sessionId: string | null;
  deviceId?: string;
  workspaceId?: string | null;
}

function resolveTarget(target?: SessionModelTarget): {
  sessionId: string | null;
  deviceId: string;
  key: string | null;
  workspaceId: string | null;
} {
  if (!target) {
    const sessionId = activeSessionId();
    return {
      sessionId,
      deviceId: activeSessionDevice(),
      key: activeSessionKey() ?? (sessionId ? sessionKey(sessionId) : null),
      workspaceId: activeWorkspaceId(),
    };
  }
  const sessionId = target.sessionId;
  const deviceId = target.deviceId ?? activeSessionDevice();
  return {
    sessionId,
    deviceId,
    key: sessionId ? sessionKey(sessionId, deviceId) : null,
    workspaceId: target.workspaceId !== undefined ? target.workspaceId : activeWorkspaceId(),
  };
}

export function modelIdForSession(sessionId: string | null, deviceId?: string): string | null {
  if (!sessionId) return resolveModelRef(defaultModelId());
  const key = sessionKey(sessionId, deviceId ?? activeSessionDevice());
  const raw = sessionModels()[key] ?? boundModelOf(sessionId, deviceId ?? activeSessionDevice()) ?? defaultModelId();
  return resolveModelRef(raw);
}

export function modelTextForSession(sessionId: string | null, deviceId?: string): { label: string; detail: string } {
  const id = modelIdForSession(sessionId, deviceId);
  if (!id) return { label: "default model", detail: "" };
  const remote = fleetChoiceOf(id);
  if (remote) {
    const text = fleetModelText(remote.choice);
    return remote.device.isThisDevice ? text : { label: `${text.label} · ${remote.device.name}`, detail: text.detail };
  }
  const match = findOption(id);
  if (match) return { label: match.label, detail: match.detail };
  return { label: id, detail: "" };
}

export const activeModelId = computed<string | null>(() =>
  modelIdForSession(activeSessionId(), activeSessionDevice()),
);

/** The model the host already has this session on, from its own record. */
function boundModelOf(sessionId: string, deviceId?: string): string | undefined {
  const name = sessions().find(
    row => row.sessionId === sessionId && (!fleetActive() || !row.deviceId || !deviceId || row.deviceId === deviceId),
  )?.modelName;
  return name && name.trim() ? name.trim() : undefined;
}

const activeModelText = computed<{ label: string; detail: string }>(() =>
  modelTextForSession(activeSessionId(), activeSessionDevice()),
);

/** The session's model as the composer badge names it: the model, and the device for another device's. */
export const activeModelLabel = computed<string>(() => activeModelText().label);

/** The secondary text of the session's model (its provider), for the badge's tooltip. */
export const activeModelDetail = computed<string>(() => activeModelText().detail);

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
  subscribeModelEvents();
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
      const primaryRef = catalog?.default_models?.primary ?? null;
      // Backend snapshots new sessions from `ai.agent_model_selections.mode`
      // (`mode_default_model_id`), falling back to `default_models.primary` on
      // older hosts that omit the field.
      const preferred = catalog?.mode_default_model_id ?? primaryRef;
      // Real Rust `get_ai_model_catalog` keys `default_models.primary` and
      // `update_session_model` by `entry.id` (config ID). Legacy mock fixtures
      // occasionally point `default_models.primary` at `entry.model_name` while
      // using a distinct `entry.id`; detect that shape without breaking real hosts.
      const legacyModelNameKeying = Boolean(
        primaryRef && rawEntries.some(entry => entry.model_name === primaryRef && entry.id !== primaryRef),
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
    // The host labels each model; a host from before the rule sends no label,
    // and its entries read as they were shown then.
    label: entry.label || entry.name || modelName,
    detail: entry.label ? entry.detail ?? "" : entry.provider ?? "",
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

/** Binds the target (or active) session to a model, the way the composer's picker does. */
export async function chooseModel(modelId: string, target?: SessionModelTarget): Promise<void> {
  const { sessionId, deviceId, key, workspaceId } = resolveTarget(target);
  modelPickerOpen.set(false);
  if (!sessionId || !key) return;
  const resolved = findOption(modelId)?.id ?? modelId;
  const wasPool = Boolean(sessionPoolIds()[key]);
  const currentReasoning = reasoningIdForSession(sessionId, deviceId);
  const keepReasoning = reasoningOfferedFor(resolved, currentReasoning);
  const preset = keepReasoning ? currentReasoning : null;
  bumpWriteGen(key);
  await runStep(async () => {
    if (wasPool) {
      await updateSessionModelTarget({
        sessionId,
        selection: { kind: "model", model_ref: resolved },
        ...(workspaceId ? { workspaceId } : {}),
        includeInternal: false,
      });
      if (keepReasoning && preset !== null) {
        await updateSessionModel({
          sessionId,
          modelName: resolved,
          reasoningPreset: preset,
          ...(workspaceId ? { workspaceId } : {}),
          includeInternal: false,
        });
      }
    } else {
      await updateSessionModel({
        sessionId,
        modelName: resolved,
        // A preset the new model does not offer would be refused as a pair, so the
        // session keeps its setting only when this surface knows it is offered.
        ...(keepReasoning ? { reasoningPreset: preset } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        includeInternal: false,
      });
    }
    targetReadFor.add(key);
    setSessionModelBinding(key, sessionId, resolved, null);
    if (!keepReasoning) applyReasoningToSession(key, null);
  });
}

/** One reasoning setting a model offers, as the composer draws it. */
export interface ReasoningChoice {
  id: string;
  label: string;
}

/** `sessionKey` → the reasoning setting the host reported or this surface wrote. */
export const sessionReasoning = signal<Record<string, string | null>>({});
/** Model id → the settings that model offers; `null` before the host answered. */
export const reasoningByModel = signal<Record<string, ReasoningChoice[] | null>>({});
export const reasoningPickerOpen = signal(false);

/**
 * `sessionKey` → the model whose reasoning was already read. The composer's effect
 * recomputes the active model whenever the session catalog moves, and a host round
 * trip per pass would be paid for nothing.
 */
const reasoningReadFor: Record<string, string> = {};

export function reasoningIdForSession(sessionId: string | null, deviceId?: string): string | null {
  if (!sessionId) return null;
  const key = sessionKey(sessionId, deviceId ?? activeSessionDevice());
  return sessionReasoning()[key] ?? null;
}

export function reasoningChoicesForSession(sessionId: string | null, deviceId?: string): ReasoningChoice[] {
  const modelId = modelIdForSession(sessionId, deviceId);
  if (!modelId) return [];
  return reasoningByModel()[modelId] ?? [];
}

export function reasoningLabelForSession(sessionId: string | null, deviceId?: string): string {
  const id = reasoningIdForSession(sessionId, deviceId);
  if (!id) return "Default";
  const match = reasoningChoicesForSession(sessionId, deviceId).find(choice => choice.id === id);
  return match ? match.label : id;
}

/**
 * What the next turn runs at, `null` for the model's own default. A session this
 * surface never read a setting for reads as the default rather than as an unknown
 * value, which is also how the host reports a session nobody has set.
 */
export const activeReasoningId = computed<string | null>(() =>
  reasoningIdForSession(activeSessionId(), activeSessionDevice()),
);

export const activeReasoningChoices = computed<ReasoningChoice[]>(() =>
  reasoningChoicesForSession(activeSessionId(), activeSessionDevice()),
);

export const activeReasoningLabel = computed<string>(() =>
  reasoningLabelForSession(activeSessionId(), activeSessionDevice()),
);

function reasoningOfferedFor(modelId: string, presetId: string | null = activeReasoningId()): boolean {
  const choices = reasoningByModel()[modelId];
  // Until the host answers, the pair is left alone: sending a preset it may not
  // know would make the model change fail, which is worse than not carrying it.
  if (choices === null || choices === undefined) return false;
  return presetId !== null && choices.some(choice => choice.id === presetId);
}

function applyReasoningToSession(key: string, preset: string | null): void {
  sessionReasoning.update(current => ({ ...current, [key]: preset }));
}

/**
 * Reads the session's authoritative model & reasoning binding from the host
 * (`get_session_model_target`) and ensures reasoning presets for that model are
 * loaded. Reading the target first guarantees the composer shows the session's
 * actual bound model (even on fleet connections where `FleetSession` omits
 * `modelName`) and loads reasoning options for that real model.
 */
export async function ensureReasoningLoaded(target?: SessionModelTarget): Promise<void> {
  const { sessionId, deviceId, key, workspaceId } = resolveTarget(target);
  if (!sessionId || !key) return;
  const needTarget = !targetReadFor.has(key);
  const initialModelId = modelIdForSession(sessionId, deviceId);
  const needReasoningForInitial =
    !needTarget && Boolean(initialModelId) && reasoningReadFor[key] !== initialModelId;
  if (!needTarget && !needReasoningForInitial) return;

  if (needTarget) targetReadFor.add(key);
  const writeGenBefore = sessionWriteGen[key] ?? 0;

  await runStep(
    async () => {
      if (needTarget) {
        const result = await getSessionModelTarget({
          sessionId,
          ...(workspaceId ? { workspaceId } : {}),
        }).catch(() => null);
        // Never overwrite an explicit user pick made while this read was in flight.
        if (result && (sessionWriteGen[key] ?? 0) === writeGenBefore) {
          const { modelRef, poolId } = extractTargetModel(result);
          if (modelRef) {
            setSessionModelBinding(key, sessionId, modelRef, poolId);
          }
          // A host older than the field omits it; that is not a session set to the
          // default, so nothing is written for it.
          if (result.reasoningPreset !== undefined) {
            applyReasoningToSession(key, result.reasoningPreset ?? null);
          }
        }
      }

      const effectiveModelId = modelIdForSession(sessionId, deviceId);
      if (!effectiveModelId) return;
      if (reasoningReadFor[key] === effectiveModelId && reasoningByModel()[effectiveModelId] !== undefined) {
        return;
      }
      reasoningReadFor[key] = effectiveModelId;
      if (reasoningByModel()[effectiveModelId] === undefined) {
        reasoningByModel.update(current => ({ ...current, [effectiveModelId]: null }));
        const choices = await reasoningChoicesFor(effectiveModelId).catch(() => [] as ReasoningChoice[]);
        reasoningByModel.update(current => ({ ...current, [effectiveModelId]: choices }));
      }
    },
    { trackBusy: false, clearError: false },
  );
}

/** The presets a model's provider compiles its reasoning into (fallback when catalog omitted `reasoning`). */
async function reasoningChoicesFor(modelId: string): Promise<ReasoningChoice[]> {
  const entry = await storedModelEntry(modelId);
  if (entry) {
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
  const fleetMatch = fleetChoiceOf(modelId);
  if (!fleetMatch) return [];
  const projection = await projectAiModelReasoningCatalog({
    provider: fleetMatch.choice.provider,
    modelName: fleetMatch.choice.modelName || fleetMatch.choice.modelId,
    baseUrl: "",
    ...(typeof fleetMatch.choice.contextWindow === "number" ? { contextWindow: fleetMatch.choice.contextWindow } : {}),
    reasoning: {},
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
export async function chooseReasoning(presetId: string | null, target?: SessionModelTarget): Promise<void> {
  const { sessionId, deviceId, key, workspaceId } = resolveTarget(target);
  reasoningPickerOpen.set(false);
  if (!sessionId || !key) return;
  // Ensure the session's authoritative model has been read before writing the pair,
  // so changing reasoning never overwrites the session's real model with a default.
  if (!targetReadFor.has(key)) {
    await ensureReasoningLoaded(target);
  }
  const modelId = modelIdForSession(sessionId, deviceId);
  if (!modelId) return;
  bumpWriteGen(key);
  await runStep(async () => {
    await updateSessionModel({
      sessionId,
      modelName: modelId,
      reasoningPreset: presetId,
      ...(workspaceId ? { workspaceId } : {}),
      includeInternal: false,
    });
    applyReasoningToSession(key, presetId);
  });
}

onSessionCreated(({ sessionId, deviceId, modelId }) => {
  if (!sessionId || !modelId) return;
  const key = sessionKey(sessionId, deviceId);
  setSessionModelBinding(key, sessionId, modelId, null);
});

onDefaultModelsChanged(() => {
  void loadModels().catch(() => undefined);
});

onWorkspaceChanged(() => {
  models.set([]);
  defaultModels.set({});
  defaultModelId.set(null);
  sessionModels.set({});
  sessionPoolIds.set({});
  fleetModelGroups.set(null);
  modelPickerOpen.set(false);
  // Presets belong to a model and a session belongs to a workspace, so neither
  // reading survives that change.
  reasoningPickerOpen.set(false);
  sessionReasoning.set({});
  reasoningByModel.set({});
  targetReadFor.clear();
  for (const key of Object.keys(reasoningReadFor)) delete reasoningReadFor[key];
  for (const key of Object.keys(sessionWriteGen)) delete sessionWriteGen[key];
  void loadModels().catch(() => undefined);
  void refreshFleetModels();
});

// The AI model list. Reads come from `ai.models`; every write is one typed intent
// (`ai_model_upsert`, `ai_model_delete`) the host applies to the list it stores
// right now: it mints ids, clamps the output limit, derives the stored request
// URL, fills capability defaults and repairs default slots, then answers with
// the stored list. This surface only parses the form text and renders.

import { signal } from "nsh";
import { getConfig, getModelCatalog, setConfig } from "./api";
import { invokeCommand } from "./bridge";
import { tr } from "./i18n";
import { errorText, invokeSettingsMutation } from "./settingsMutations";
import { runStep } from "./state";

/** The persisted shape `AIModelConfig` stores; fields this surface does not edit are kept. */
export interface StoredModel {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  base_url: string;
  request_url?: string;
  api_key: string;
  context_window?: number | null;
  max_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  enabled: boolean;
  category: string;
  capabilities: string[];
  recommended_for?: string[];
  [key: string]: unknown;
}

export const storedModels = signal<StoredModel[]>([]);
export const modelSettingsLoaded = signal(false);
export const modelSettingsNotice = signal("");

/**
 * Request formats the host's providers speak, as the React model editor lists
 * them. The Responses API is `responses`; `response` is an older spelling a
 * stored entry may still carry, read as `responses`.
 */
export const MODEL_FORMATS = ["openai", "responses", "anthropic", "gemini"] as const;

/** `response` is the legacy spelling of the Responses format. */
export function normalizeModelFormat(provider: string | undefined): string {
  const value = (provider ?? "").trim().toLowerCase();
  return value === "response" ? "responses" : value || "openai";
}

/** `ModelCategory` values the form offers; the host decides the capabilities each implies. */
export const MODEL_CATEGORIES = ["general_chat", "multimodal", "speech_recognition"] as const;

/**
 * The stored capability list. The host fills a category's defaults when it loads
 * or saves an entry that stores none, so this surface keeps no copy of them.
 */
export function effectiveCapabilities(model: Pick<StoredModel, "capabilities">): string[] {
  return Array.isArray(model.capabilities) ? model.capabilities.filter(cap => typeof cap === "string") : [];
}

/** A model the composer can run on: enabled, with an id, and able to chat. */
export function isSelectableForCapability(model: StoredModel, capability: string): boolean {
  return Boolean(model.id?.trim()) && model.enabled === true && effectiveCapabilities(model).includes(capability);
}

export function selectableChatModels(): StoredModel[] {
  return storedModels().filter(model => isSelectableForCapability(model, "text_chat"));
}

/**
 * Model id -> how every list shows it, as the host labels its catalog
 * (`get_ai_model_catalog`: the model first, then its provider, numbered when two
 * read the same). This surface keeps no label rule of its own.
 */
export const modelLabels = signal<Record<string, { label: string; detail: string }>>({});

let modelLabelsTicket = 0;

/** Re-reads the host's labels; follows every change of the stored list. */
export async function refreshModelLabels(): Promise<void> {
  const ticket = ++modelLabelsTicket;
  try {
    const catalog = await getModelCatalog();
    if (ticket !== modelLabelsTicket) return;
    const next: Record<string, { label: string; detail: string }> = {};
    for (const entry of catalog?.models ?? []) {
      if (entry?.id && entry.label) next[entry.id] = { label: entry.label, detail: entry.detail ?? "" };
    }
    modelLabels.set(next);
  } catch {
    // A host without the catalog keeps the entries' own names below.
    if (ticket === modelLabelsTicket) modelLabels.set({});
  }
}

function setStoredModels(list: StoredModel[]): void {
  storedModels.set(list);
  void refreshModelLabels();
}

/**
 * The host's label for a stored model. A host from before the label rule sends
 * none: the entry's name and model are read as they were shown then.
 */
function modelText(model: StoredModel): { label: string; detail: string } {
  const labelled = modelLabels()[model.id];
  if (labelled) return labelled;
  const name = (model.name ?? "").trim();
  const modelName = (model.model_name ?? "").trim();
  return { label: modelName || name || model.id, detail: name && name !== modelName ? name : model.provider ?? "" };
}

/** What a model list shows first: the model. */
export function modelOptionLabel(model: StoredModel): string {
  return modelText(model).label;
}

/** The secondary text beside the label: the provider. */
export function modelOptionDetail(model: StoredModel): string {
  return modelText(model).detail;
}

/** Both in one line (`gpt-5 · OpenAI`), where a list has room for one text only. */
export function modelOptionText(model: StoredModel): string {
  const { label, detail } = modelText(model);
  return detail ? `${label} · ${detail}` : label;
}

/** The form the user is filling in; empty strings keep a field untouched on save. */
export interface ModelDraft {
  /** The stored entry this form edits; absent while adding a new one. */
  editingId?: string;
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  /** Token limits the catalog may fill; empty leaves the limit unset. */
  contextWindow: string;
  maxTokens: string;
  /** `ModelCategory`; the capabilities follow from it, as the desktop editor writes them. */
  category: string;
  /** One `Name: value` per line; empty stores no custom headers. */
  customHeaders: string;
  /** `merge` applies the provider's headers first, `replace` sends only these. */
  customHeadersMode: "merge" | "replace";
  /** Skip TLS certificate checks (self-signed gateways); off by default. */
  skipSslVerify: boolean;
}

/** `Name: value` lines into the header map the host stores; a malformed line is reported. */
export function parseHeaderLines(text: string): Record<string, string> | string {
  const headers: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return line;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return line;
    headers[name] = value;
  }
  return headers;
}

function headerLines(headers: unknown): string {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return "";
  return Object.entries(headers as Record<string, unknown>)
    .map(([name, value]) => `${name}: ${String(value ?? "")}`)
    .join("\n");
}

const EMPTY_DRAFT: ModelDraft = {
  name: "",
  provider: "openai",
  modelName: "",
  baseUrl: "",
  apiKey: "",
  contextWindow: "",
  maxTokens: "",
  category: "general_chat",
  customHeaders: "",
  customHeadersMode: "merge",
  skipSslVerify: false,
};

export const modelDraft = signal<ModelDraft>({ ...EMPTY_DRAFT });

export const modelFormOpen = signal(false);

/**
 * The host's own models.dev projections, read once on demand. This is a
 * controller-local command (a peer state is never asked for its copy), so the
 * picker is only drawn while this machine is driving itself.
 */
export interface ModelCatalogEndpoint {
  baseUrl: string;
  format: string;
  label: string;
}

export interface ModelCatalogModel {
  id: string;
  label: string;
  context?: number;
  output?: number;
}

export interface ModelCatalogProvider {
  id: string;
  name: string;
  endpoints: ModelCatalogEndpoint[];
  models: ModelCatalogModel[];
}

export const modelCatalog = signal<ModelCatalogProvider[]>([]);
export const modelCatalogLoaded = signal(false);
export const modelCatalogNotice = signal("");
export const modelCatalogQuery = signal("");
export const modelCatalogProvider = signal<string | null>(null);

let catalogRequested = false;

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readCatalog(raw: unknown): ModelCatalogProvider[] {
  const catalog = (raw as { provider_catalog?: { providers?: unknown } } | null)?.provider_catalog;
  const providers = catalog?.providers;
  if (!Array.isArray(providers)) return [];
  return providers
    .filter((provider): provider is Record<string, unknown> => Boolean(provider) && typeof provider === "object")
    .map(provider => {
      const endpoints = Array.isArray(provider.endpoints) ? provider.endpoints : [];
      const models = Array.isArray(provider.models) ? provider.models : [];
      return {
        id: String(provider.id ?? ""),
        name: String(provider.name ?? provider.id ?? ""),
        endpoints: endpoints
          .filter((endpoint): endpoint is Record<string, unknown> => Boolean(endpoint) && typeof endpoint === "object")
          .map(endpoint => ({
            baseUrl: String(endpoint.base_url ?? ""),
            format: String(endpoint.api_format ?? "openai"),
            label: String(endpoint.label ?? endpoint.base_url ?? ""),
          }))
          .filter(endpoint => endpoint.baseUrl !== ""),
        models: models
          .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === "object")
          .map(model => {
            const limits = (model.limits ?? {}) as Record<string, unknown>;
            return {
              id: String(model.id ?? ""),
              label: String(model.display_name ?? model.id ?? ""),
              context: optionalNumber(limits.context),
              output: optionalNumber(limits.output),
            };
          })
          .filter(model => model.id !== ""),
      };
    })
    .filter(provider => provider.id !== "");
}

export async function loadModelCatalog(): Promise<void> {
  if (catalogRequested) return;
  catalogRequested = true;
  await runStep(async () => {
    try {
      const raw = await invokeCommand<unknown>("get_local_models_dev_catalogs");
      modelCatalog.set(readCatalog(raw));
      modelCatalogLoaded.set(true);
      if (!readCatalog(raw).length) {
        // A host that answers with nothing cached says so instead of drawing an
        // empty picker that looks like a broken search.
        modelCatalogNotice.set("This machine has no model catalog yet");
      }
    } catch {
      // A host without the command simply has no picker; the form still works.
      modelCatalog.set([]);
      modelCatalogLoaded.set(true);
    }
  });
}

/** The providers a query narrows to, so a long catalog is still usable. */
export function catalogProviders(): ModelCatalogProvider[] {
  const all = modelCatalog();
  const query = modelCatalogQuery().trim().toLowerCase();
  if (!query) return all.slice(0, 8);
  return all
    .filter(
      provider =>
        provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query),
    )
    .slice(0, 8);
}

export function selectedCatalogProvider(): ModelCatalogProvider | null {
  const id = modelCatalogProvider();
  return id ? modelCatalog().find(provider => provider.id === id) ?? null : null;
}

export function setCatalogQuery(text: string): void {
  modelCatalogQuery.set(text);
}

/** Choosing a provider fills the format and its default endpoint; the model stays open. */
export function chooseCatalogProvider(id: string): void {
  const provider = modelCatalog().find(entry => entry.id === id);
  if (!provider) return;
  modelCatalogProvider.set(id);
  const endpoint = provider.endpoints[0];
  if (endpoint) {
    modelDraft.update(current => ({
      ...current,
      provider: endpoint.format,
      baseUrl: endpoint.baseUrl,
      name: current.name || provider.name,
    }));
  }
}

export function chooseCatalogModel(modelId: string): void {
  const provider = selectedCatalogProvider();
  const model = provider?.models.find(entry => entry.id === modelId);
  if (!model) return;
  // The catalog's own output limit may exceed what the host accepts for that
  // window; the host clamps it on save and says so.
  const output = model.output;
  modelDraft.update(current => ({
    ...current,
    modelName: model.id,
    name: current.name || model.label,
    contextWindow: model.context ? String(model.context) : current.contextWindow,
    maxTokens: output ? String(output) : current.maxTokens,
  }));
}

export async function loadModels(): Promise<void> {
  await runStep(async () => {
    try {
      const list = await getConfig("ai.models");
      setStoredModels(normalizeModels(list));
      modelSettingsLoaded.set(true);
    } catch (error) {
      storedModels.set([]);
      modelSettingsLoaded.set(true);
      modelSettingsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

function normalizeModels(value: unknown): StoredModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => entry && typeof entry === "object").map(entry => entry as StoredModel);
}

/** One model intent as `ai_model_upsert` reads it: absent keeps, `null` clears. */
export interface ModelUpsert {
  id?: string;
  name?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number | null;
  maxTokens?: number | null;
  category?: string;
  capabilities?: string[];
  enabled?: boolean;
  customHeaders?: Record<string, string> | null;
  customHeadersMode?: string | null;
  skipSslVerify?: boolean;
}

export interface ModelUpsertResult {
  models: StoredModel[];
  ids: string[];
  clampedIds: string[];
}

/**
 * Sends model intents and publishes the list the host stored. The host owns ids,
 * the output-limit ceiling, the request URL and capability defaults; a limit it
 * lowered is reported next to `done`.
 */
export async function upsertModels(models: ModelUpsert[], done: (result: ModelUpsertResult) => string): Promise<ModelUpsertResult | null> {
  try {
    const raw = await invokeSettingsMutation<{ models?: unknown; ids?: unknown; clampedIds?: unknown }>(
      "ai_model_upsert",
      { models },
    );
    const result: ModelUpsertResult = {
      models: normalizeModels(raw?.models),
      ids: Array.isArray(raw?.ids) ? raw.ids.map(String) : [],
      clampedIds: Array.isArray(raw?.clampedIds) ? raw.clampedIds.map(String) : [],
    };
    setStoredModels(result.models);
    const clamped = result.clampedIds.length > 0 ? ` ${tr("settings.models.outputClamped")}` : "";
    modelSettingsNotice.set(`${done(result)}${clamped}`);
    return result;
  } catch (error) {
    modelSettingsNotice.set(errorText(error));
    return null;
  }
}

/** `ai.default_models`: the slot a role resolves to, by configured model id. */
export const DEFAULT_MODEL_SLOTS = ["primary", "fast", "economy", "image_understanding", "speech_recognition"] as const;
export type DefaultModelSlot = (typeof DEFAULT_MODEL_SLOTS)[number];

export const defaultModels = signal<Record<string, string | null>>({});
export const defaultModelsLoaded = signal(false);
export const defaultModelsNotice = signal("");
/** The slot being written, so its row shows that it is saving. */
export const defaultModelSaving = signal<string | null>(null);

function readDefaultModels(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = typeof entry === "string" && entry ? entry : null;
  }
  return result;
}

export async function loadDefaultModels(): Promise<void> {
  try {
    defaultModels.set(readDefaultModels(await getConfig("ai.default_models", true)));
  } catch {
    // An older host may not store the section yet; every slot reads as unset.
    defaultModels.set({});
  }
  defaultModelsLoaded.set(true);
}

/**
 * Points one slot at a model, or clears it with `null`. Only that slot's leaf is
 * written, so the slots this page does not draw (`search`, `image_generation`)
 * and a slot another surface just changed are never put back.
 */
export async function chooseDefaultModel(slot: DefaultModelSlot, modelId: string | null): Promise<void> {
  defaultModelSaving.set(slot);
  try {
    await setConfig(`ai.default_models.${slot}`, modelId);
    defaultModels.update(current => ({ ...current, [slot]: modelId }));
    defaultModelsNotice.set("");
  } catch (error) {
    defaultModelsNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    defaultModelSaving.set(null);
  }
}

/** How many default slots name a model, which a delete confirmation reports. */
export function defaultModelReferences(id: string): number {
  return Object.values(defaultModels()).filter(value => value === id).length;
}

export function updateDraft(patch: Partial<ModelDraft>): void {
  modelDraft.update(current => ({ ...current, ...patch }));
}

export function openModelForm(): void {
  modelDraft.set({ ...EMPTY_DRAFT });
  modelFormOpen.set(true);
  modelSettingsNotice.set("");
  // The picker reads this machine's own catalog once; a host without the command
  // simply leaves it empty and the form stays usable by hand.
  void loadModelCatalog();
}

/**
 * Opens the same form prefilled from a stored entry, as the desktop's editor
 * does; saving patches that entry through `patchModel` instead of appending.
 */
export function openModelEditor(id: string): void {
  const model = storedModels().find(entry => entry.id === id);
  if (!model) {
    modelSettingsNotice.set(`${id} is not in the stored list; reload`);
    return;
  }
  modelSettingsNotice.set("");
  modelDraft.set({
    editingId: id,
    name: String(model.name ?? ""),
    provider: normalizeModelFormat(model.provider),
    modelName: String(model.model_name ?? ""),
    baseUrl: String(model.base_url ?? ""),
    apiKey: String(model.api_key ?? ""),
    contextWindow: model.context_window ? String(model.context_window) : "",
    maxTokens: model.max_tokens ? String(model.max_tokens) : "",
    category: MODEL_CATEGORIES.includes(model.category as (typeof MODEL_CATEGORIES)[number])
      ? model.category
      : "general_chat",
    customHeaders: headerLines(model.custom_headers),
    customHeadersMode: model.custom_headers_mode === "replace" ? "replace" : "merge",
    skipSslVerify: model.skip_ssl_verify === true,
  });
  modelFormOpen.set(true);
}

export function closeModelForm(): void {
  modelFormOpen.set(false);
  modelDraft.set({ ...EMPTY_DRAFT });
  modelCatalogProvider.set(null);
  modelCatalogQuery.set("");
}

/**
 * Saves the form as one `ai_model_upsert` intent: a new model when the form adds
 * one, the edited entry otherwise. The form only parses its text; the host
 * validates the fields, normalizes the format, derives the request URL, keeps
 * the stored capabilities unless the category changed, and clamps the output
 * limit to what the context window allows.
 */
export async function saveModelDraft(): Promise<void> {
  const draft = modelDraft();
  const contextWindow = positiveInteger(draft.contextWindow);
  const maxTokens = positiveInteger(draft.maxTokens);
  if (contextWindow === null || maxTokens === null) {
    modelSettingsNotice.set("A limit is a positive whole number of tokens, or empty");
    return;
  }
  const headers = parseHeaderLines(draft.customHeaders);
  if (typeof headers === "string") {
    modelSettingsNotice.set(`A header is one "Name: value" per line; this line is not: ${headers}`);
    return;
  }
  const hasHeaders = Object.keys(headers).length > 0;
  const intent: ModelUpsert = {
    ...(draft.editingId ? { id: draft.editingId } : {}),
    name: draft.name,
    provider: draft.provider,
    modelName: draft.modelName,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    contextWindow: contextWindow ?? null,
    maxTokens: maxTokens ?? null,
    category: draft.category,
    customHeaders: hasHeaders ? headers : null,
    customHeadersMode: hasHeaders ? draft.customHeadersMode : null,
    skipSslVerify: draft.skipSslVerify,
  };
  const name = draft.name.trim();
  await runStep(async () => {
    const saved = await upsertModels([intent], () => (draft.editingId ? `Saved ${name}` : `Added ${name}`));
    if (saved) closeModelForm();
  });
}

/** The model a delete is waiting to be confirmed for. */
export const modelDeletePending = signal<string | null>(null);

export function requestModelDelete(id: string | null): void {
  modelDeletePending.set(id);
}

/**
 * Removes one entry through `ai_model_delete`. The host's model reconciliation
 * clears the default slots and task selections that named it, and the answer
 * carries both lists as they are now stored.
 */
export async function deleteModel(id: string): Promise<void> {
  modelDeletePending.set(null);
  await runStep(async () => {
    try {
      const target = storedModels().find(entry => entry.id === id);
      const raw = await invokeSettingsMutation<{ models?: unknown; defaultModels?: unknown }>("ai_model_delete", { id });
      setStoredModels(normalizeModels(raw?.models));
      if (raw && raw.defaultModels !== undefined) defaultModels.set(readDefaultModels(raw.defaultModels));
      modelSettingsNotice.set(`Removed ${target?.name ?? id}`);
    } catch (error) {
      modelSettingsNotice.set(errorText(error));
    }
  });
}

/** Changes fields of one stored entry; the rest of the entry stays as stored. */
async function patchModel(id: string, patch: Omit<ModelUpsert, "id">, done: string): Promise<boolean> {
  let saved = false;
  await runStep(async () => {
    saved = (await upsertModels([{ ...patch, id }], () => done)) !== null;
  });
  return saved;
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<void> {
  const name = storedModels().find(entry => entry.id === id)?.name ?? id;
  await patchModel(id, { enabled }, `${name} is ${enabled ? "enabled" : "disabled"}`);
}

/** The limits the host reads when it sizes a request; empty means "not set". */
export interface ModelLimitsDraft {
  id: string;
  contextWindow: string;
  maxTokens: string;
}

export const modelLimitsDraft = signal<ModelLimitsDraft | null>(null);

export function openModelLimits(id: string): void {
  const model = storedModels().find(entry => entry.id === id);
  if (!model) {
    modelSettingsNotice.set(`${id} is not in the stored list; reload`);
    return;
  }
  modelSettingsNotice.set("");
  modelLimitsDraft.set({
    id,
    contextWindow: model.context_window ? String(model.context_window) : "",
    maxTokens: model.max_tokens ? String(model.max_tokens) : "",
  });
}

export function closeModelLimits(): void {
  modelLimitsDraft.set(null);
}

export function updateModelLimitsDraft(patch: Partial<Omit<ModelLimitsDraft, "id">>): void {
  modelLimitsDraft.update(current => (current ? { ...current, ...patch } : current));
}

function positiveInteger(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

/**
 * Stores the context window and the output ceiling. The host owns the bounds: it
 * refuses a window below its floor and lowers an output limit above the share of
 * the window it accepts, reporting that it did.
 */
export async function saveModelLimits(): Promise<void> {
  const draft = modelLimitsDraft();
  if (!draft) return;
  const contextWindow = positiveInteger(draft.contextWindow);
  const maxTokens = positiveInteger(draft.maxTokens);
  if (contextWindow === null || maxTokens === null) {
    modelSettingsNotice.set("A limit is a positive whole number of tokens, or empty");
    return;
  }
  const name = storedModels().find(entry => entry.id === draft.id)?.name ?? draft.id;
  const saved = await patchModel(
    draft.id,
    { contextWindow: contextWindow ?? null, maxTokens: maxTokens ?? null },
    `Saved the limits of ${name}`,
  );
  if (saved) modelLimitsDraft.set(null);
}

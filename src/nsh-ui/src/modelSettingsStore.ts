// The AI model list: `ai.models` is one config path holding an array, so the
// whole list is read and written back. This is the credential path — a host with
// no model configured cannot run a turn — not the full model settings page (task
// model pools, subscription accounts and the models.dev catalog stay with their
// React owners).

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { invokeCommand } from "./bridge";
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

/** Request formats the host's providers speak, as the React model editor lists them. */
export const MODEL_FORMATS = ["openai", "anthropic", "gemini"] as const;

/** The form the user is filling in; empty strings keep a field untouched on save. */
export interface ModelDraft {
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  /** Token limits the catalog may fill; empty leaves the limit unset. */
  contextWindow: string;
  maxTokens: string;
}

const EMPTY_DRAFT: ModelDraft = {
  name: "",
  provider: "openai",
  modelName: "",
  baseUrl: "",
  apiKey: "",
  contextWindow: "",
  maxTokens: "",
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
  modelDraft.update(current => ({
    ...current,
    modelName: model.id,
    name: current.name || model.label,
    contextWindow: model.context ? String(model.context) : current.contextWindow,
    maxTokens: model.output ? String(model.output) : current.maxTokens,
  }));
}

export async function loadModels(): Promise<void> {
  await runStep(async () => {
    try {
      const list = await getConfig("ai.models");
      storedModels.set(normalizeModels(list));
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

export function updateDraft(patch: Partial<ModelDraft>): void {
  modelDraft.update(current => ({ ...current, ...patch }));
}

export function openModelForm(): void {
  modelFormOpen.set(true);
  modelSettingsNotice.set("");
  // The picker reads this machine's own catalog once; a host without the command
  // simply leaves it empty and the form stays usable by hand.
  void loadModelCatalog();
}

export function closeModelForm(): void {
  modelFormOpen.set(false);
  modelDraft.set({ ...EMPTY_DRAFT });
  modelCatalogProvider.set(null);
  modelCatalogQuery.set("");
}

/**
 * Appends the draft to `ai.models`. The endpoint is stored resolved — the format
 * decides the request path — so the runtime does not have to guess it, matching
 * what the React editor writes.
 */
export async function saveModelDraft(): Promise<void> {
  const draft = modelDraft();
  const name = draft.name.trim();
  const modelName = draft.modelName.trim();
  const baseUrl = draft.baseUrl.trim();
  const provider = draft.provider.trim() || "openai";
  if (!name || !modelName || !baseUrl) {
    modelSettingsNotice.set("A model needs a name, a model name and a base URL");
    return;
  }
  const entry: StoredModel = {
    id: `model_${Date.now().toString(36)}`,
    name,
    provider,
    model_name: modelName,
    base_url: baseUrl,
    request_url: resolveRequestUrl(baseUrl, provider),
    api_key: draft.apiKey.trim(),
    enabled: true,
    category: "general_chat",
    capabilities: ["text_chat"],
    recommended_for: [],
  };
  // A catalog pick fills the pair; the same ceiling the host applies is checked
  // here so a model it would refuse is not stored.
  const contextWindow = positiveInteger(draft.contextWindow);
  const maxTokens = positiveInteger(draft.maxTokens);
  if (contextWindow === null || maxTokens === null) {
    modelSettingsNotice.set("A limit is a positive whole number of tokens, or empty");
    return;
  }
  if (contextWindow !== undefined && maxTokens !== undefined && maxTokens * 100 > contextWindow * 40) {
    modelSettingsNotice.set("The output limit is at most 40% of the context window");
    return;
  }
  entry.context_window = contextWindow ?? null;
  entry.max_tokens = maxTokens ?? null;
  const next = [...storedModels(), entry];
  await runStep(async () => {
    try {
      await setConfig("ai.models", next);
      storedModels.set(next);
      closeModelForm();
      modelSettingsNotice.set(`Added ${name}`);
    } catch (error) {
      modelSettingsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function deleteModel(id: string): Promise<void> {
  const target = storedModels().find(entry => entry.id === id);
  const next = storedModels().filter(entry => entry.id !== id);
  await runStep(async () => {
    try {
      await setConfig("ai.models", next);
      storedModels.set(next);
      modelSettingsNotice.set(`Removed ${target?.name ?? id}`);
    } catch (error) {
      modelSettingsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/** Writes the list with one entry replaced, so fields this surface does not edit stay. */
async function patchModel(id: string, patch: Partial<StoredModel>, done: string): Promise<void> {
  const next = storedModels().map(entry => (entry.id === id ? { ...entry, ...patch } : entry));
  await runStep(async () => {
    try {
      await setConfig("ai.models", next);
      storedModels.set(next);
      modelSettingsNotice.set(done);
    } catch (error) {
      modelSettingsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
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
 * Stores the context window and the output ceiling. The host refuses an output
 * limit above 40% of the context window (`MAX_CONFIGURED_OUTPUT_TOKENS_RATIO_PERCENT`),
 * so the pair is checked here instead of being sent and rejected.
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
  if (contextWindow === undefined && maxTokens !== undefined) {
    modelSettingsNotice.set("An output limit needs a context window beside it");
    return;
  }
  if (contextWindow !== undefined && maxTokens !== undefined && maxTokens * 100 > contextWindow * 40) {
    modelSettingsNotice.set("The output limit is at most 40% of the context window");
    return;
  }
  const name = storedModels().find(entry => entry.id === draft.id)?.name ?? draft.id;
  await patchModel(
    draft.id,
    { context_window: contextWindow ?? null, max_tokens: maxTokens ?? null },
    `Saved the limits of ${name}`,
  );
  modelLimitsDraft.set(null);
}

/**
 * The stored request URL for a base URL and format: the format owns the resource
 * path, and a URL that already ends in it is kept as it is.
 */
export function resolveRequestUrl(baseUrl: string, provider: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed.endsWith("#")) return trimmed.slice(0, -1).replace(/\/+$/, "");
  if (provider === "openai") {
    return trimmed.endsWith("chat/completions") ? trimmed : `${trimmed}/chat/completions`;
  }
  if (provider === "anthropic") {
    if (trimmed.endsWith("/messages")) return trimmed;
    return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
  }
  if (provider === "gemini") {
    return trimmed
      .replace(/\/v1beta(?:\/models(?:\/[^/?#]*(?::(?:stream)?[Gg]enerateContent)?(?:\?[^]*)?)?)?$/, "")
      .replace(/\/models(?:\/[^/?#]*(?::(?:stream)?[Gg]enerateContent)?(?:\?[^]*)?)?$/, "")
      .replace(/\/+$/, "");
  }
  return trimmed;
}

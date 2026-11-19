// AI model URL resolution, remote `/models` discovery, transient config
// connection testing, and optional subscription account quota loading.

import { signal } from "nsh";
import { setConfig } from "./api";
import { invokeCommand, invokeRawCommand } from "./bridge";
import {
  modelCatalog,
  modelDraft,
  modelSettingsNotice,
  storedModels,
  type ModelDraft,
  type StoredModel,
} from "./modelSettingsStore";
import { runStep } from "./state";

export interface RemoteModelRouting {
  format: string;
  base_url: string;
  request_url: string;
}

export interface RemoteModelOption {
  id: string;
  display_name?: string;
  name?: string;
  owned_by?: string;
  context_window?: number;
  max_tokens?: number;
  capabilities?: string[];
  routing?: RemoteModelRouting;
}

export interface MergedDiscoveredModel {
  id: string;
  label: string;
  description?: string;
  source: "remote" | "catalog";
  context_window?: number;
  max_tokens?: number;
  capabilities?: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  response_time_ms?: number;
  responseTimeMs?: number;
  model_response?: string;
  message?: string;
  message_code?: string;
  error_details?: string;
  errorDetails?: string;
}

export interface ConnectionTestOutcome {
  status: "idle" | "testing" | "success" | "error";
  success?: boolean;
  message?: string;
  responseTimeMs?: number;
  errorDetails?: string;
}

export interface SubscriptionAccountSummary {
  provider: string;
  display_label: string;
  account?: string | null;
  connected: boolean;
  expires_at?: number | null;
  reauthentication_required?: boolean;
  suggested_format?: string;
}

export interface SubscriptionQuotaWindow {
  label?: string;
  used_percent?: number;
  remaining_percent?: number;
  reset_at?: string | number;
}

export interface SubscriptionQuotaSummary {
  account_id: string;
  provider: string;
  state: string;
  plan?: string | null;
  allowed?: boolean | null;
  has_credits?: boolean | null;
  primary_window?: SubscriptionQuotaWindow | null;
  secondary_window?: SubscriptionQuotaWindow | null;
  [key: string]: unknown;
}

export function isResponsesProvider(provider?: string): boolean {
  const normalized = (provider ?? "").trim().toLowerCase();
  return normalized === "response" || normalized === "responses";
}

/** Strip `/v1beta/models/...` or `/models/...` suffix from a Gemini URL. */
export function geminiBaseUrl(url: string): string {
  return url
    .replace(/\/v1beta(?:\/models(?:\/[^/?#]*(?::(?:stream)?[Gg]enerateContent)?(?:\?[^]*)?)?)?$/, "")
    .replace(/\/models(?:\/[^/?#]*(?::(?:stream)?[Gg]enerateContent)?(?:\?[^]*)?)?$/, "")
    .replace(/\/+$/, "");
}

/**
 * Compute the stored request URL from a base URL and provider format.
 * Trailing `#` forces the exact URL without appending resource paths.
 */
export function resolveRequestUrl(baseUrl: string, provider: string, _modelName = ""): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("#")) {
    return trimmed.slice(0, -1).replace(/\/+$/, "");
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai") {
    return trimmed.endsWith("chat/completions") ? trimmed : `${trimmed}/chat/completions`;
  }
  if (isResponsesProvider(normalized)) {
    return trimmed.endsWith("responses") ? trimmed : `${trimmed}/responses`;
  }
  if (normalized === "anthropic") {
    if (trimmed.endsWith("/messages")) return trimmed;
    return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
  }
  if (normalized === "gemini") {
    return geminiBaseUrl(trimmed);
  }
  return trimmed;
}

/** Build a human-readable live request URL preview for display in the editor. */
export function previewRequestUrl(baseUrl: string, provider: string, modelName?: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (provider.trim().toLowerCase() === "gemini" && !trimmed.endsWith("#")) {
    const model = modelName?.trim();
    const encoded = model ? encodeURIComponent(model) : "{model}";
    return `${geminiBaseUrl(trimmed)}/v1beta/models/${encoded}:streamGenerateContent?alt=sse`;
  }
  return resolveRequestUrl(baseUrl, provider, modelName);
}

interface DiscoveryOperation {
  signature: string;
}

/** Discards stale discovery replies after base URL, format, or key changes. */
export class ModelDiscoveryCoordinator {
  private active: DiscoveryOperation | null = null;
  private completed: string | null = null;

  begin(signature: string, force = false): DiscoveryOperation | null {
    if (this.active?.signature === signature || (!force && this.completed === signature)) {
      return null;
    }
    const operation = { signature };
    this.active = operation;
    return operation;
  }

  isCurrent(operation: DiscoveryOperation): boolean {
    return this.active === operation;
  }

  complete(operation: DiscoveryOperation, succeeded: boolean): boolean {
    if (!this.isCurrent(operation)) return false;
    this.completed = succeeded ? operation.signature : null;
    this.active = null;
    return true;
  }

  reset(): void {
    this.active = null;
    this.completed = null;
  }
}

const discoveryCoordinator = new ModelDiscoveryCoordinator();

export const remoteDiscoveredModels = signal<RemoteModelOption[]>([]);
export const remoteDiscoveryLoading = signal(false);
export const remoteDiscoveryError = signal<string | null>(null);
export const remoteDiscoveryFetched = signal(false);
export const discoveryPickerOpen = signal(false);
export const discoverySearchQuery = signal("");
export const selectedDiscoveredIds = signal<string[]>([]);

export const draftTestOutcome = signal<ConnectionTestOutcome>({ status: "idle" });
export const modelTestOutcomes = signal<Record<string, ConnectionTestOutcome>>({});

export const subscriptionAccounts = signal<SubscriptionAccountSummary[]>([]);
export const subscriptionQuotas = signal<Record<string, SubscriptionQuotaSummary>>({});
export const subscriptionsLoading = signal(false);
let subscriptionsLoadedOnce = false;

export function resetRemoteDiscovery(): void {
  discoveryCoordinator.reset();
  remoteDiscoveredModels.set([]);
  remoteDiscoveryLoading.set(false);
  remoteDiscoveryError.set(null);
  remoteDiscoveryFetched.set(false);
  draftTestOutcome.set({ status: "idle" });
}

export function buildTransientModelConfig(
  draft: ModelDraft,
  modelNameOverride?: string,
): StoredModel | null {
  const provider = draft.provider.trim() || "openai";
  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) return null;
  const modelName = (modelNameOverride ?? draft.modelName).trim() || "probe";
  const name = draft.name.trim() || modelName;
  const parsedContext = Number(draft.contextWindow.trim());
  const parsedMaxTokens = Number(draft.maxTokens.trim());
  return {
    id: `draft_${Date.now().toString(36)}`,
    name,
    provider,
    model_name: modelName,
    base_url: baseUrl,
    request_url: resolveRequestUrl(baseUrl, provider, modelName),
    api_key: draft.apiKey.trim(),
    context_window: Number.isFinite(parsedContext) && parsedContext > 0 ? Math.trunc(parsedContext) : null,
    max_tokens: Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0 ? Math.trunc(parsedMaxTokens) : null,
    enabled: true,
    category: "general_chat",
    capabilities: ["text_chat"],
    recommended_for: [],
    auth: { type: "api_key" },
  };
}

function discoverySignature(config: StoredModel): string {
  return JSON.stringify({
    provider: config.provider,
    base_url: config.base_url,
    api_key: config.api_key,
  });
}

export async function detectModelsForConfig(
  draft: ModelDraft,
  force = false,
): Promise<void> {
  if (!draft.baseUrl.trim()) {
    remoteDiscoveredModels.set([]);
    remoteDiscoveryError.set("Enter a base URL before detecting models.");
    remoteDiscoveryFetched.set(true);
    return;
  }
  if (!draft.apiKey.trim()) {
    remoteDiscoveredModels.set([]);
    remoteDiscoveryError.set("Enter an API key before fetching models from the endpoint.");
    remoteDiscoveryFetched.set(true);
    return;
  }
  const transient = buildTransientModelConfig(draft);
  if (!transient) return;
  const operation = discoveryCoordinator.begin(discoverySignature(transient), force);
  if (!operation) return;

  remoteDiscoveryLoading.set(true);
  remoteDiscoveryError.set(null);
  remoteDiscoveryFetched.set(true);
  let succeeded = false;

  try {
    const raw = await invokeCommand<RemoteModelOption[]>("list_ai_models_by_config", {
      config: transient,
    });
    if (!discoveryCoordinator.isCurrent(operation)) return;
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const deduped: RemoteModelOption[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim()) {
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    remoteDiscoveredModels.set(deduped);
    if (deduped.length === 0) {
      remoteDiscoveryError.set("No models returned by this endpoint; you can enter a model name manually.");
    } else {
      succeeded = true;
    }
  } catch (error) {
    if (!discoveryCoordinator.isCurrent(operation)) return;
    remoteDiscoveredModels.set([]);
    remoteDiscoveryError.set(
      error instanceof Error ? error.message : "Failed to query models from this endpoint.",
    );
  } finally {
    if (discoveryCoordinator.complete(operation, succeeded)) {
      remoteDiscoveryLoading.set(false);
    }
  }
}

function safeMaxTokens(contextWindow?: number, rawOutput?: number): number | undefined {
  if (!rawOutput || rawOutput <= 0) return undefined;
  if (!contextWindow || contextWindow <= 0) return rawOutput;
  const ceiling = Math.floor((contextWindow * 40) / 100);
  return ceiling > 0 ? Math.min(rawOutput, ceiling) : rawOutput;
}

function findCatalogMetadata(
  modelId: string,
  baseUrl: string,
  providerFormat: string,
): { context?: number; output?: number; label?: string; providerName?: string } | null {
  const needle = modelId.trim().toLowerCase();
  if (!needle) return null;
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  const providers = modelCatalog();

  // Prefer providers whose configured endpoint matches baseUrl/format.
  const ordered = [...providers].sort((a, b) => {
    const aMatch = a.endpoints.some(
      ep =>
        (normalizedBase && ep.baseUrl.replace(/\/+$/, "").toLowerCase() === normalizedBase) ||
        ep.format.toLowerCase() === providerFormat.toLowerCase(),
    );
    const bMatch = b.endpoints.some(
      ep =>
        (normalizedBase && ep.baseUrl.replace(/\/+$/, "").toLowerCase() === normalizedBase) ||
        ep.format.toLowerCase() === providerFormat.toLowerCase(),
    );
    return Number(bMatch) - Number(aMatch);
  });

  for (const prov of ordered) {
    const match = prov.models.find(m => m.id.trim().toLowerCase() === needle);
    if (match) {
      return {
        context: match.context,
        output: match.output,
        label: match.label,
        providerName: prov.name,
      };
    }
  }
  return null;
}

/** Merge remote `/models` discoveries with local models.dev catalog metadata. */
export function mergedDiscoveredOptions(draft: ModelDraft): MergedDiscoveredModel[] {
  const result: MergedDiscoveredModel[] = [];
  const seen = new Set<string>();
  const remotes = remoteDiscoveredModels();

  for (const remote of remotes) {
    const key = remote.id.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const catalogMeta = findCatalogMetadata(remote.id, draft.baseUrl, draft.provider);
    const ctx = remote.context_window ?? catalogMeta?.context;
    const out = safeMaxTokens(ctx, remote.max_tokens ?? catalogMeta?.output);
    const label = remote.display_name || remote.name || catalogMeta?.label || remote.id;
    const parts: string[] = [];
    if (remote.owned_by) parts.push(remote.owned_by);
    if (ctx) parts.push(`${Math.round(ctx / 1000)}K ctx`);
    if (out) parts.push(`${Math.round(out / 1000)}K out`);
    result.push({
      id: remote.id,
      label,
      description: parts.length > 0 ? parts.join(" · ") : remote.id,
      source: "remote",
      context_window: ctx,
      max_tokens: out,
      capabilities: remote.capabilities,
    });
  }

  // Include matching local catalog models when remote list is empty or incomplete.
  const normalizedBase = draft.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  const matchingCatalogProviders = modelCatalog().filter(
    prov =>
      prov.endpoints.some(
        ep =>
          (normalizedBase && ep.baseUrl.replace(/\/+$/, "").toLowerCase() === normalizedBase) ||
          ep.format.toLowerCase() === draft.provider.trim().toLowerCase(),
      ),
  );
  for (const prov of matchingCatalogProviders) {
    for (const model of prov.models) {
      const key = model.id.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const out = safeMaxTokens(model.context, model.output);
      const parts: string[] = [prov.name];
      if (model.context) parts.push(`${Math.round(model.context / 1000)}K ctx`);
      if (out) parts.push(`${Math.round(out / 1000)}K out`);
      result.push({
        id: model.id,
        label: model.label,
        description: parts.join(" · "),
        source: "catalog",
        context_window: model.context,
        max_tokens: out,
      });
    }
  }

  return result;
}

export function openDiscoveryPicker(draft: ModelDraft): void {
  discoverySearchQuery.set("");
  selectedDiscoveredIds.set(
    draft.modelName.trim() ? [draft.modelName.trim()] : [],
  );
  discoveryPickerOpen.set(true);
  if (
    draft.apiKey.trim() &&
    draft.baseUrl.trim() &&
    !remoteDiscoveryFetched() &&
    !remoteDiscoveryLoading()
  ) {
    void detectModelsForConfig(draft);
  }
}

export function closeDiscoveryPicker(): void {
  discoveryPickerOpen.set(false);
}

export function toggleDiscoveredModel(modelId: string): void {
  const targetKey = modelId.trim().toLowerCase();
  selectedDiscoveredIds.update(current => {
    const exists = current.some(item => item.trim().toLowerCase() === targetKey);
    return exists
      ? current.filter(item => item.trim().toLowerCase() !== targetKey)
      : [...current, modelId];
  });
}

export function applySelectedDiscoveryToDraft(option: MergedDiscoveredModel): void {
  modelDraft.update(current => ({
    ...current,
    modelName: option.id,
    name: current.name.trim() || option.label,
    contextWindow: option.context_window ? String(option.context_window) : current.contextWindow,
    maxTokens: option.max_tokens ? String(option.max_tokens) : current.maxTokens,
  }));
}

export async function addAllSelectedDiscoveredModels(draft: ModelDraft): Promise<boolean> {
  const chosenIds = selectedDiscoveredIds();
  if (chosenIds.length === 0) return false;
  const options = mergedDiscoveredOptions(draft);

  if (chosenIds.length === 1) {
    const match = options.find(opt => opt.id === chosenIds[0]);
    if (match) {
      applySelectedDiscoveryToDraft(match);
    } else {
      modelDraft.update(current => ({
        ...current,
        modelName: chosenIds[0],
        name: current.name.trim() || chosenIds[0],
      }));
    }
    closeDiscoveryPicker();
    return false;
  }

  const baseUrl = draft.baseUrl.trim();
  const provider = draft.provider.trim() || "openai";
  if (!baseUrl) {
    remoteDiscoveryError.set("Enter a base URL before adding multiple models.");
    return false;
  }

  const additions: StoredModel[] = chosenIds.map((id, idx) => {
    const match = options.find(opt => opt.id === id);
    const contextWindow = match?.context_window ?? null;
    const maxTokens = safeMaxTokens(match?.context_window, match?.max_tokens) ?? null;
    return {
      id: `model_${Date.now().toString(36)}_${idx}`,
      name: match?.label || id,
      provider,
      model_name: id,
      base_url: baseUrl,
      request_url: resolveRequestUrl(baseUrl, provider, id),
      api_key: draft.apiKey.trim(),
      context_window: contextWindow,
      max_tokens: maxTokens,
      enabled: true,
      category: "general_chat",
      capabilities: match?.capabilities?.length ? match.capabilities : ["text_chat"],
      recommended_for: [],
    };
  });

  const next = [...storedModels(), ...additions];
  await runStep(async () => {
    try {
      await setConfig("ai.models", next);
      storedModels.set(next);
      modelSettingsNotice.set(`Added ${additions.length} models`);
      closeDiscoveryPicker();
    } catch (error) {
      remoteDiscoveryError.set(
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  return true;
}

function outcomeFromResult(result: ConnectionTestResult | null | undefined): ConnectionTestOutcome {
  if (!result || typeof result !== "object") {
    return { status: "error", success: false, errorDetails: "No connection test response." };
  }
  const timeMs = result.response_time_ms ?? result.responseTimeMs;
  if (result.success) {
    return {
      status: "success",
      success: true,
      responseTimeMs: timeMs,
      message: result.message || (timeMs !== undefined ? `Connected · ${timeMs} ms` : "Connected"),
    };
  }
  return {
    status: "error",
    success: false,
    responseTimeMs: timeMs,
    errorDetails:
      result.error_details ||
      result.errorDetails ||
      result.message ||
      result.message_code ||
      "Connection failed",
  };
}

export async function testDraftConnection(draft: ModelDraft): Promise<void> {
  const config = buildTransientModelConfig(draft);
  if (!config || !draft.modelName.trim()) {
    draftTestOutcome.set({
      status: "error",
      success: false,
      errorDetails: "Enter a base URL and model name before testing.",
    });
    return;
  }
  draftTestOutcome.set({ status: "testing" });
  try {
    const result = await invokeCommand<ConnectionTestResult>("test_ai_config_connection", {
      config,
    });
    draftTestOutcome.set(outcomeFromResult(result));
  } catch (error) {
    draftTestOutcome.set({
      status: "error",
      success: false,
      errorDetails: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function testSavedModelConnection(model: StoredModel): Promise<void> {
  modelTestOutcomes.update(current => ({ ...current, [model.id]: { status: "testing" } }));
  try {
    const result = await invokeCommand<ConnectionTestResult>("test_ai_config_connection", {
      config: model,
    });
    const outcome = outcomeFromResult(result);
    modelTestOutcomes.update(current => ({ ...current, [model.id]: outcome }));
  } catch (error) {
    modelTestOutcomes.update(current => ({
      ...current,
      [model.id]: {
        status: "error",
        success: false,
        errorDetails: error instanceof Error ? error.message : String(error),
      },
    }));
  }
}

export async function loadSubscriptions(force = false): Promise<void> {
  if (subscriptionsLoadedOnce && !force) return;
  subscriptionsLoadedOnce = true;
  subscriptionsLoading.set(true);
  try {
    const raw = await invokeRawCommand<SubscriptionAccountSummary[]>(
      "list_subscription_accounts",
      {},
    ).catch(() => [] as SubscriptionAccountSummary[]);
    const list = Array.isArray(raw) ? raw : [];
    subscriptionAccounts.set(list);
    await Promise.all(
      list
        .filter(item => item && item.connected && item.provider)
        .map(async item => {
          const quota = await invokeCommand<SubscriptionQuotaSummary | null>(
            "get_subscription_account_quota",
            {
              provider: item.provider,
              accountId: item.account || item.provider,
              forceRefresh: force,
            },
          ).catch(() => null);
          if (quota && typeof quota === "object") {
            subscriptionQuotas.update(current => ({
              ...current,
              [item.provider]: quota,
            }));
          }
        }),
    );
  } finally {
    subscriptionsLoading.set(false);
  }
}

// The model editor's request-URL preview (asked of the host), remote `/models`
// discovery, transient config connection testing, and optional subscription
// account quota loading. The host derives request URLs and clamps output limits;
// nothing here keeps a copy of those rules.

import { Clipboard, openUrl, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { tr } from "./i18n";
import {
  modelCatalog,
  modelDraft,
  modelSettingsNotice,
  upsertModels,
  type ModelDraft,
  type StoredModel,
} from "./modelSettingsStore";
import { isCommandUnavailable } from "./hostCommands";
import { isMissingCommand } from "./settingsMutations";
import { errorMessageOf } from "./shared/errorUtils";
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
  vault_unavailable?: boolean;
  suggested_format?: string;
  /** Authorization methods the provider supports now (`browser`, `device`). */
  login_methods?: string[];
  /**
   * The host's account slot id (`<provider>` or `<provider>-account-<uuid>`),
   * the only id `get_subscription_account_quota` accepts. Filled from
   * `list_subscription_account_instances`; an older host without that command
   * has one slot per provider, whose id is the provider key.
   */
  account_id: string;
  is_default?: boolean;
  enabled?: boolean;
}

/** `SubscriptionQuotaWindow` / `SubscriptionQuotaMeter` (core-types `subscription.rs`). */
export interface SubscriptionQuotaMeter {
  id: string;
  display_name?: string | null;
  duration_seconds?: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: string | null;
  used_percent?: number | null;
  /** Unix seconds. */
  resets_at?: number | null;
  secondary?: boolean;
  unlimited?: boolean;
}

/** The legacy single-window view an older fixture or host may still send. */
export interface SubscriptionQuotaWindow {
  label?: string;
  used_percent?: number;
  remaining_percent?: number;
  reset_at?: string | number;
}

/** `SubscriptionQuotaSnapshot`: `windows` plus the optional `display.meters` view. */
export interface SubscriptionQuotaSummary {
  account_id: string;
  provider: string;
  state: string;
  plan?: string | null;
  allowed?: boolean | null;
  has_credits?: boolean | null;
  valid_until?: number | null;
  windows?: SubscriptionQuotaMeter[];
  details?: {
    version?: number;
    buckets?: Array<{ id: string; display_name?: string | null; windows?: SubscriptionQuotaMeter[] }>;
  } | null;
  display?: { version?: number; meters?: SubscriptionQuotaMeter[] } | null;
  error?: string | null;
  primary_window?: SubscriptionQuotaWindow | null;
  secondary_window?: SubscriptionQuotaWindow | null;
  [key: string]: unknown;
}

/** One drawn meter: a label, the percent left (when the host reported usage) and the reset. */
export interface QuotaMeterRow {
  id: string;
  /** Vendor display name, or `""` when the row is named by its period alone. */
  name: string;
  durationSeconds?: number;
  remainingPercent: number | null;
  usedPercent: number | null;
  /** Unix seconds, or a legacy string the host sent verbatim. */
  resetsAt: number | string | null;
  secondary: boolean;
  unlimited: boolean;
}

function finiteQuota(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The meters the desktop's `quotaMeters` draws for one snapshot: the `display`
 * view when the host sent version 1 of it, otherwise the `windows` plus the
 * per-bucket windows of `details` v1. A snapshot from an older surface's
 * fixture that only has `primary_window` / `secondary_window` still reads.
 */
export function quotaMeters(snapshot: SubscriptionQuotaSummary | null | undefined): QuotaMeterRow[] {
  if (!snapshot || snapshot.state === "unsupported") return [];
  const toRow = (meter: SubscriptionQuotaMeter, nameOverride?: string | null): QuotaMeterRow => {
    let used = finiteQuota(meter.used_percent);
    if (used === undefined) {
      const usedAmount = finiteQuota(meter.used);
      const limit = finiteQuota(meter.limit);
      if (usedAmount !== undefined && limit !== undefined && limit > 0) used = (usedAmount / limit) * 100;
    }
    const remaining = meter.unlimited || used === undefined ? null : Math.max(0, Math.min(100, 100 - used));
    return {
      id: meter.id,
      name: (nameOverride ?? meter.display_name ?? "").trim(),
      durationSeconds: finiteQuota(meter.duration_seconds),
      remainingPercent: remaining === null ? null : Math.round(remaining),
      usedPercent: used === undefined ? null : Math.round(used),
      resetsAt: finiteQuota(meter.resets_at) ?? null,
      secondary: Boolean(meter.secondary),
      unlimited: Boolean(meter.unlimited),
    };
  };
  if (snapshot.display && typeof snapshot.display === "object") {
    return snapshot.display.version === 1 && Array.isArray(snapshot.display.meters)
      ? snapshot.display.meters.map(meter => toRow(meter))
      : [];
  }
  const rows: QuotaMeterRow[] = Array.isArray(snapshot.windows)
    ? snapshot.windows.map(meter => toRow(meter))
    : [];
  if (snapshot.details?.version === 1) {
    for (const bucket of snapshot.details.buckets ?? []) {
      for (const window of bucket.windows ?? []) {
        rows.push(toRow({ ...window, id: `${bucket.id}:${window.id}` }, bucket.display_name ?? null));
      }
    }
  }
  if (rows.length === 0) {
    const legacy = (win: SubscriptionQuotaWindow | null | undefined, id: string): QuotaMeterRow | null => {
      if (!win) return null;
      const remaining =
        finiteQuota(win.remaining_percent) ??
        (finiteQuota(win.used_percent) !== undefined ? 100 - (win.used_percent as number) : undefined);
      return {
        id,
        name: (win.label ?? "").trim(),
        remainingPercent: remaining === undefined ? null : Math.round(Math.max(0, Math.min(100, remaining))),
        usedPercent: finiteQuota(win.used_percent) ?? null,
        resetsAt: win.reset_at ?? null,
        secondary: false,
        unlimited: false,
      };
    };
    for (const row of [legacy(snapshot.primary_window, "primary"), legacy(snapshot.secondary_window, "secondary")]) {
      if (row) rows.push(row);
    }
  }
  return rows;
}

/**
 * Previews answered by the host's `resolve_ai_model_request_url`, by input. The
 * rule that turns a base URL and format into a request URL lives with the host
 * that stores it; this cache keeps the editor from asking twice for one input.
 */
const requestUrlPreviews = signal<Record<string, string>>({});
const pendingPreviews = new Set<string>();
const PREVIEW_CACHE_LIMIT = 64;

function rememberPreview(key: string, value: string): void {
  pendingPreviews.delete(key);
  requestUrlPreviews.update(current => {
    const keys = Object.keys(current);
    const next = keys.length >= PREVIEW_CACHE_LIMIT ? {} : { ...current };
    next[key] = value;
    return next;
  });
}

/**
 * The request URL the editor shows for the form as typed. Reactive: it answers
 * from the cache and asks the host once per new input. A host without the
 * command says so instead of showing a URL this surface guessed.
 */
export function previewRequestUrl(baseUrl: string, provider: string, modelName?: string): string {
  const base = baseUrl.trim();
  if (!base) return "";
  const key = JSON.stringify([base, provider.trim(), (modelName ?? "").trim()]);
  const known = requestUrlPreviews()[key];
  if (known !== undefined) return known;
  if (!pendingPreviews.has(key)) {
    pendingPreviews.add(key);
    void invokeCommand<{ previewUrl?: string }>("resolve_ai_model_request_url", {
      baseUrl: base,
      provider,
      modelName: modelName ?? "",
    })
      .then(answer => rememberPreview(key, typeof answer?.previewUrl === "string" ? answer.previewUrl : ""))
      .catch(error =>
        rememberPreview(
          key,
          isMissingCommand(error, "resolve_ai_model_request_url") ? tr("settings.models.previewUnavailable") : "",
        ),
      );
  }
  return "";
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
  // No `request_url`: the host derives it from the base URL and format.
  return {
    id: `draft_${Date.now().toString(36)}`,
    name,
    provider,
    model_name: modelName,
    base_url: baseUrl,
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

/** A provider's advertised output limit; the host clamps it to the window on save. */
function advertisedMaxTokens(rawOutput?: number): number | undefined {
  return rawOutput && rawOutput > 0 ? rawOutput : undefined;
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
    const out = advertisedMaxTokens(remote.max_tokens ?? catalogMeta?.output);
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
      const out = advertisedMaxTokens(model.output);
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

  // One batch intent: the host mints the ids, derives each request URL and
  // clamps each output limit to its window, in one write.
  const additions = chosenIds.map(id => {
    const match = options.find(opt => opt.id === id);
    return {
      name: match?.label || id,
      provider,
      modelName: id,
      baseUrl,
      apiKey: draft.apiKey.trim(),
      contextWindow: match?.context_window ?? null,
      maxTokens: match?.max_tokens ?? null,
      category: "general_chat",
      ...(match?.capabilities?.length ? { capabilities: match.capabilities } : {}),
    };
  });

  let added = false;
  await runStep(async () => {
    const result = await upsertModels(additions, saved => `Added ${saved.ids.length} models`);
    if (result) {
      added = true;
      closeDiscoveryPicker();
    } else {
      remoteDiscoveryError.set(modelSettingsNotice());
    }
  });
  return added;
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

interface SubscriptionAccountInstance {
  account_id?: string;
  is_default?: boolean;
  enabled?: boolean;
  account?: Omit<SubscriptionAccountSummary, "account_id">;
}

/**
 * Reads the subscription providers and accounts, and each connected one's quota.
 * `list_subscription_accounts` names every provider the host supports (signed in
 * or not), which is what a sign-in starts from; `list_subscription_account_instances`
 * adds the account slots, named by the id the quota command takes. A host without
 * the instances command (older build) has one slot per provider, whose id is the
 * provider key. The quota is never asked for by the account's email.
 */
export async function loadSubscriptions(force = false): Promise<void> {
  if (subscriptionsLoadedOnce && !force) return;
  subscriptionsLoadedOnce = true;
  subscriptionsLoading.set(true);
  try {
    const providers = await invokeRawCommand<Array<Omit<SubscriptionAccountSummary, "account_id">>>(
      "list_subscription_accounts",
      {},
    ).catch(() => [] as Array<Omit<SubscriptionAccountSummary, "account_id">>);
    let instances: SubscriptionAccountInstance[] | null = null;
    try {
      const raw = await invokeRawCommand<SubscriptionAccountInstance[]>("list_subscription_account_instances", {});
      instances = Array.isArray(raw) ? raw : null;
    } catch {
      instances = null;
    }
    const list: SubscriptionAccountSummary[] = [];
    for (const item of instances ?? []) {
      if (!item || !item.account || !item.account.provider) continue;
      list.push({
        ...(item.account as Omit<SubscriptionAccountSummary, "account_id">),
        account_id: String(item.account_id || item.account.provider),
        is_default: item.is_default,
        enabled: item.enabled !== false,
      });
    }
    for (const item of Array.isArray(providers) ? providers : []) {
      if (!item || !item.provider) continue;
      // A provider with a slot is already listed; one without is offered for sign-in.
      if (list.some(entry => entry.provider === item.provider)) continue;
      list.push({ ...item, account_id: item.provider });
    }
    subscriptionAccounts.set(list);
    await Promise.all(
      list
        .filter(item => item.connected && item.account_id)
        .map(async item => {
          const quota = await invokeCommand<SubscriptionQuotaSummary | null>(
            "get_subscription_account_quota",
            {
              provider: item.provider,
              accountId: item.account_id,
              forceRefresh: force,
            },
          ).catch(() => null);
          if (quota && typeof quota === "object") {
            subscriptionQuotas.update(current => ({
              ...current,
              [item.account_id]: quota,
            }));
          }
        }),
    );
  } finally {
    subscriptionsLoading.set(false);
  }
}

/** A subscription sign-in in progress, as `get_subscription_login_status` reports it. */
export interface SubscriptionLoginState {
  provider: string;
  accountId: string;
  sessionId: string;
  status: "starting" | "pending" | "authorized" | "failed" | "cancelled";
  method?: string;
  authorizationUrl?: string;
  userCode?: string;
  instructions?: string;
  error?: string;
  /** The address could not be opened in a browser here; the panel shows it instead. */
  urlUnopened?: boolean;
}

export const subscriptionLogin = signal<SubscriptionLoginState | null>(null);
export const subscriptionSigningOut = signal<string | null>(null);
let loginPoll: ReturnType<typeof setTimeout> | null = null;
const LOGIN_POLL_MS = 1500;
const LOGIN_DEADLINE_MS = 10 * 60_000;

function stopLoginPoll(): void {
  if (loginPoll !== null) {
    clearTimeout(loginPoll);
    loginPoll = null;
  }
}

/**
 * Starts the provider's sign-in the way the desktop does: `start_subscription_login`
 * with a session id this surface mints, the authorization address opened in the
 * browser, then `get_subscription_login_status` polled until it settles. While
 * another device is driven the sign-in runs there, so only the device-code method
 * (which needs no browser on that machine) is used; a provider without it says so.
 */
export async function startSubscriptionSignIn(
  provider: string,
  remote: boolean,
  methods: string[] = [],
  accountId: string = provider,
): Promise<void> {
  stopLoginPoll();
  const slotId = accountId || provider;
  const method = remote ? "device" : methods.includes("browser") || methods.length === 0 ? undefined : methods[0];
  if (remote && methods.length > 0 && !methods.includes("device")) {
    subscriptionLogin.set({
      provider,
      accountId: slotId,
      sessionId: "",
      status: "failed",
      error: "This provider signs in through a browser on the machine being driven; sign in there.",
    });
    return;
  }
  const sessionId = `nsh-login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  subscriptionLogin.set({ provider, accountId: slotId, sessionId, status: "starting" });
  try {
    const started = await invokeCommand<{
      authorization_url?: string;
      user_code?: string | null;
      instructions?: string;
      method?: string;
    }>("start_subscription_login", { provider, sessionId, ...(method ? { method } : {}) });
    const url = started?.authorization_url ?? "";
    let urlUnopened = false;
    if (url) {
      try {
        await openUrl(url);
      } catch {
        urlUnopened = true;
      }
    }
    subscriptionLogin.set({
      provider,
      accountId: slotId,
      sessionId,
      status: "pending",
      method: started?.method,
      authorizationUrl: url,
      userCode: started?.user_code ?? undefined,
      instructions: started?.instructions,
      urlUnopened,
    });
    const deadline = Date.now() + LOGIN_DEADLINE_MS;
    const poll = async (): Promise<void> => {
      loginPoll = null;
      const current = subscriptionLogin();
      if (!current || current.sessionId !== sessionId || current.status !== "pending") return;
      try {
        const snapshot = await invokeCommand<{ status?: string; error?: string | null; session_id?: string }>(
          "get_subscription_login_status",
          { provider, sessionId },
        );
        const status = snapshot?.status;
        if (status === "authorized") {
          subscriptionLogin.set({ ...current, status: "authorized" });
          await loadSubscriptions(true);
          return;
        }
        if (status === "failed" || status === "cancelled") {
          subscriptionLogin.set({ ...current, status, error: snapshot?.error ?? undefined });
          void loadSubscriptions(true);
          return;
        }
      } catch (error) {
        subscriptionLogin.set({ ...current, status: "failed", error: errorMessageOf(error) });
        void loadSubscriptions(true);
        return;
      }
      if (Date.now() > deadline) {
        subscriptionLogin.set({ ...current, status: "failed", error: "The sign-in timed out" });
        void loadSubscriptions(true);
        return;
      }
      loginPoll = setTimeout(() => void poll(), LOGIN_POLL_MS);
    };
    loginPoll = setTimeout(() => void poll(), LOGIN_POLL_MS);
  } catch (error) {
    subscriptionLogin.set({
      provider,
      accountId: slotId,
      sessionId,
      status: "failed",
      error: errorMessageOf(error),
    });
    void loadSubscriptions(true);
  }
}

export async function cancelSubscriptionSignIn(): Promise<void> {
  const current = subscriptionLogin();
  stopLoginPoll();
  subscriptionLogin.set(null);
  if (current && current.sessionId && (current.status === "pending" || current.status === "starting")) {
    await invokeCommand("cancel_subscription_login", { provider: current.provider, sessionId: current.sessionId }).catch(
      () => null,
    );
    void loadSubscriptions(true);
  }
}

/**
 * Signs out / forgets one subscription account slot. Prefers the per-slot
 * `logout_subscription_account_instance` command and falls back to provider-wide
 * `logout_subscription_account` on older hosts.
 */
export async function signOutSubscriptionAccount(provider: string, accountId?: string): Promise<void> {
  const slotId = accountId || provider;
  if (!provider || subscriptionSigningOut() === slotId) return;
  subscriptionSigningOut.set(slotId);
  try {
    if (accountId) {
      try {
        await invokeCommand("logout_subscription_account_instance", { provider, accountId });
      } catch (error) {
        if (!isCommandUnavailable(error, "logout_subscription_account_instance")) throw error;
        await invokeCommand("logout_subscription_account", { provider });
      }
    } else {
      await invokeCommand("logout_subscription_account", { provider });
    }
    if (subscriptionLogin()?.accountId === slotId) {
      stopLoginPoll();
      subscriptionLogin.set(null);
    }
    subscriptionQuotas.update(current => {
      if (!(slotId in current)) return current;
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    await loadSubscriptions(true);
  } catch (error) {
    modelSettingsNotice.set(errorMessageOf(error));
  } finally {
    if (subscriptionSigningOut() === slotId) {
      subscriptionSigningOut.set(null);
    }
  }
}

export function copySubscriptionLoginUrl(): void {
  const url = subscriptionLogin()?.authorizationUrl;
  if (url) void Clipboard.writeText(url).catch(() => undefined);
}

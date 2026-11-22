// Reactive i18n runtime for the OpenBitFun NSH frontend.
//
// Owns canonical locale normalization (`zh-CN`, `en-US`, `zh-TW`), reactive
// `currentLocale` signal, `tr(key, params?)` catalog lookup with `{{name}}`
// interpolation, local `Storage` persistence (`openbitfun.nsh.locale.v1`),
// native NSH `setLocale(...)` synchronization, and host `app.language` merge.

import { Storage, signal, type Signal } from "nsh";
import { setLocale as setNshLocale } from "nsh/i18n";
import { getConfig } from "./api";
import { invokeCommand } from "./bridge";
import { enUSMessages, type MessageKey } from "./locales/en-US";
import { zhCNMessages } from "./locales/zh-CN";
import { zhTWMessages } from "./locales/zh-TW";

export type AppLocale = "zh-CN" | "en-US" | "zh-TW";
export type { MessageKey };

export interface LocaleDescriptor {
  readonly id: AppLocale;
  readonly label: string;
  readonly nativeName: string;
  readonly shortName: string;
}

/** Persistent NSH-local locale preference key (always stores canonical AppLocale). */
export const LOCALE_STORAGE_KEY = "openbitfun.nsh.locale.v1";

/**
 * Supported OpenBitFun locales in the desktop order defined by
 * `src/shared/i18n/contract/locales.json`.
 */
export const SUPPORTED_LOCALES: ReadonlyArray<LocaleDescriptor> = [
  { id: "zh-CN", label: "简体中文", nativeName: "简体中文", shortName: "中" },
  { id: "en-US", label: "English", nativeName: "English", shortName: "EN" },
  { id: "zh-TW", label: "繁體中文", nativeName: "繁體中文", shortName: "繁" },
];

const CATALOGS: Record<AppLocale, Readonly<Record<MessageKey, string>>> = {
  "en-US": enUSMessages,
  "zh-CN": zhCNMessages,
  "zh-TW": zhTWMessages,
};

/**
 * Fallback chains matching `src/shared/i18n/contract/locales.json`.
 */
const CONTENT_FALLBACKS: Record<AppLocale, ReadonlyArray<AppLocale>> = {
  "en-US": ["en-US"],
  "zh-CN": ["zh-CN", "en-US"],
  "zh-TW": ["zh-TW", "zh-CN", "en-US"],
};

/** Reactive active locale. Reading `tr(...)` inside JSX subscribes to this signal. */
export const currentLocale: Signal<AppLocale> = signal<AppLocale>("en-US");

export type LocalePersistedListener = (
  locale: AppLocale,
  persistedApp?: Record<string, unknown>,
) => void;

const localePersistedListeners = new Set<LocalePersistedListener>();

/**
 * Subscribes to explicit locale changes so stores such as `settingsStore` can
 * keep their in-memory `app` config cache aligned without circular imports.
 */
export function onAppLocalePersisted(listener: LocalePersistedListener): () => void {
  localePersistedListeners.add(listener);
  return () => {
    localePersistedListeners.delete(listener);
  };
}

function notifyLocalePersisted(locale: AppLocale, persistedApp?: Record<string, unknown>): void {
  for (const listener of [...localePersistedListeners]) {
    try {
      listener(locale, persistedApp);
    } catch {
      // Never let one observer block locale persistence.
    }
  }
}

/**
 * Normalizes canonical locale IDs and input-boundary aliases (`zh`, `zh-Hans`,
 * `zh-Hant`, `zh-HK`, `zh-MO`, `en`, underscore variants, and BCP 47 subtags)
 * into a canonical OpenBitFun `AppLocale`, or `null` when unrecognized.
 */
export function normalizeLocale(raw: unknown): AppLocale | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/_/g, "-");
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  if (
    lower === "zh-tw" ||
    lower === "zh-hant" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower.startsWith("zh-hant-") ||
    lower.startsWith("zh-tw-") ||
    lower.startsWith("zh-hk-") ||
    lower.startsWith("zh-mo-")
  ) {
    return "zh-TW";
  }

  if (
    lower === "zh" ||
    lower === "zh-cn" ||
    lower === "zh-hans" ||
    lower === "zh-sg" ||
    lower.startsWith("zh-hans-") ||
    lower.startsWith("zh-cn-") ||
    lower.startsWith("zh-sg-") ||
    lower.startsWith("zh-")
  ) {
    return "zh-CN";
  }

  if (lower === "en" || lower === "en-us" || lower.startsWith("en-")) {
    return "en-US";
  }

  return null;
}

/** Returns the display metadata for the given locale (or the active locale). */
export function localeMeta(locale: AppLocale = currentLocale()): LocaleDescriptor {
  return SUPPORTED_LOCALES.find(entry => entry.id === locale) ?? SUPPORTED_LOCALES[1];
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined) {
      return String(params[name]);
    }
    return match;
  });
}

/** Translates a catalog key for an explicit locale (non-reactive). */
export function trForLocale(
  locale: AppLocale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const chain = CONTENT_FALLBACKS[locale] ?? CONTENT_FALLBACKS["en-US"];
  for (const candidate of chain) {
    const value = CATALOGS[candidate][key];
    if (typeof value === "string") {
      return interpolate(value, params);
    }
  }
  return interpolate(enUSMessages[key] ?? key, params);
}

/**
 * Translates `key` in the active locale with optional `{{name}}` interpolation.
 * Reactive: reading `tr(...)` inside JSX bindings repaints automatically when
 * `currentLocale` changes.
 */
export function tr(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return trForLocale(currentLocale(), key, params);
}

function applyNativeLocale(locale: AppLocale): void {
  try {
    setNshLocale(locale);
  } catch {
    // Headless test runtimes or older hosts may not wire native setLocale.
  }
  try {
    const doc = (
      globalThis as {
        document?: { documentElement?: { lang?: string } };
      }
    ).document;
    if (doc?.documentElement) {
      doc.documentElement.lang = locale;
    }
  } catch {
    // Non-DOM realm.
  }
}

/** Reads `?lang=` or `?locale=` from `location.search` when running in a web browser realm. */
function readUrlLocaleOverride(): AppLocale | null {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    const search = typeof loc?.search === "string" ? loc.search : "";
    if (!search || (!search.includes("lang=") && !search.includes("locale="))) return null;
    const query = search.startsWith("?") ? search.slice(1) : search;
    for (const pair of query.split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const k = decodeURIComponent(pair.slice(0, eq)).trim().toLowerCase();
      if (k !== "lang" && k !== "locale") continue;
      const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
      const parsed = normalizeLocale(v);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore malformed query string or restricted realm.
  }
  return null;
}

let localeMutationVersion = 0;

/**
 * Synchronizes the active UI locale from a host-reported value without writing
 * back to the host. Ignores unrecognized or empty values.
 */
export function syncLocaleFromHost(raw: unknown): void {
  const canonical = normalizeLocale(raw);
  if (!canonical) return;
  localeMutationVersion += 1;
  if (currentLocale() !== canonical) {
    currentLocale.set(canonical);
  }
  applyNativeLocale(canonical);
}

async function readHostLocale(): Promise<AppLocale | null> {
  try {
    const appConfig = await getConfig("app", true);
    if (appConfig && typeof appConfig === "object") {
      const parsed = normalizeLocale((appConfig as Record<string, unknown>).language);
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to leaf path or controller i18n command.
  }

  try {
    const leaf = await getConfig("app.language", true);
    const parsed = normalizeLocale(leaf);
    if (parsed) return parsed;
  } catch {
    // Fall through to i18n_get_current_language if supported.
  }

  try {
    const direct = await invokeCommand<unknown>("i18n_get_current_language");
    return normalizeLocale(direct);
  } catch {
    return null;
  }
}

/**
 * Boots or reconciles the active UI locale from URL override (`?lang=`),
 * persisted `Storage` (`openbitfun.nsh.locale.v1`), and host `app.language`.
 * Safe against concurrent `setAppLocale(...)` calls: an explicit switch during
 * boot always wins.
 */
export async function loadAppLocale(opts?: { forceHost?: boolean }): Promise<AppLocale> {
  const startVersion = localeMutationVersion;

  if (!opts?.forceHost) {
    const urlLocale = readUrlLocaleOverride();
    if (urlLocale) {
      if (localeMutationVersion === startVersion) {
        currentLocale.set(urlLocale);
        applyNativeLocale(urlLocale);
      }
      return currentLocale();
    }

    try {
      const stored = await Storage.getItem(LOCALE_STORAGE_KEY);
      if (localeMutationVersion !== startVersion) return currentLocale();
      const parsedStored = normalizeLocale(stored);
      if (parsedStored) {
        currentLocale.set(parsedStored);
        applyNativeLocale(parsedStored);
        return parsedStored;
      }
    } catch {
      // Storage unavailable: proceed to host config.
    }
  }

  const hostLocale = await readHostLocale();
  if (localeMutationVersion !== startVersion) return currentLocale();
  if (hostLocale) {
    currentLocale.set(hostLocale);
    applyNativeLocale(hostLocale);
    if (opts?.forceHost) {
      void Storage.setItem(LOCALE_STORAGE_KEY, hostLocale).catch(() => undefined);
    }
    return hostLocale;
  }

  applyNativeLocale(currentLocale());
  return currentLocale();
}

/**
 * Switches the active UI locale immediately, syncs NSH native widgets,
 * persists to local `Storage`, and (unless `persistHost: false`) asks the host
 * to keep it through `i18n_set_language`. Resolves `false` when the host did not.
 */
export async function setAppLocale(
  locale: string,
  opts?: { persistHost?: boolean },
): Promise<boolean> {
  const canonical = normalizeLocale(locale);
  if (!canonical) return false;

  localeMutationVersion += 1;
  currentLocale.set(canonical);
  applyNativeLocale(canonical);

  try {
    await Storage.setItem(LOCALE_STORAGE_KEY, canonical);
  } catch {
    // Keep the chosen locale in memory even when storage cannot write.
  }

  if (opts?.persistHost === false) {
    notifyLocalePersisted(canonical);
    return true;
  }

  // `i18n_set_language` owns the language: the host validates the locale,
  // stores `app.language` as a leaf and applies its runtime effects. It is
  // controller-local, so the change stays on this machine. No whole `app` document is read or written back from here.
  let persisted = true;
  try {
    await invokeCommand("i18n_set_language", { language: canonical });
  } catch {
    // The UI already switched; the caller says the host did not keep it.
    persisted = false;
  }
  notifyLocalePersisted(canonical);
  return persisted;
}

function extractRawErrorMessage(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (raw instanceof Error) return raw.message.trim();
  if (typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = rec[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return String(raw).trim();
}

const AUTH_REQUIRED_TEXT_RE =
  /\b(?:not logged in|not signed in|unauthorized|unauthenticated|authentication required|auth required|login required|sign[- ]?in required|requires authentication|requires login|account session missing)\b/i;

const AUTH_REQUIRED_401_RE =
  /(?:^|[\s(\[])(?:http\s+|status\s*:?\s*)?401(?:$|[\s)\],.;])/i;

/**
 * Returns `true` when a raw host/backend error indicates the user is not signed
 * in or their account session requires authentication.
 */
export function isAuthRequiredError(raw: unknown): boolean {
  const text = extractRawErrorMessage(raw);
  if (!text) return false;
  return AUTH_REQUIRED_TEXT_RE.test(text) || AUTH_REQUIRED_401_RE.test(text);
}

interface HostErrorRule {
  readonly key: MessageKey;
  readonly match: RegExp;
  readonly stripGeneric: RegExp;
}

const HOST_ERROR_RULES: ReadonlyArray<HostErrorRule> = [
  {
    key: "error.peerOffline",
    match:
      /\b(?:peer(?: is)? offline|device(?: is)? offline|target(?: is)? offline|peer unreachable)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|peer(?: is)? offline|device(?: is)? offline|target(?: is)? offline|peer unreachable)(?:\b|$)/gi,
  },
  {
    key: "error.connectionRefused",
    match: /\b(?:connection refused|econnrefused)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|tcp connect error|connect error|connection refused|econnrefused|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.timedOut",
    match: /\b(?:timed out|timeout|etimedout|deadline exceeded)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|operation|request|connection|timed out|timeout|etimedout|deadline exceeded|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.permissionDenied",
    match: /\b(?:permission denied|access(?: is)? denied|eacces|eperm)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|permission denied|access(?: is)? denied|eacces|eperm|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.commandNotFound",
    match:
      /\b(?:command not found|program not found|executable file not found|is not recognized as an internal or external command)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|command not found|program not found|executable file not found|is not recognized as an internal or external command|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.networkError",
    match:
      /\b(?:network error|failed to fetch|network is unreachable|no route to host|connection reset|econnreset|enotfound|dns error|name or service not known|nodename nor servname|broken pipe)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|network error|failed to fetch|network is unreachable|no route to host|connection reset(?: by peer)?|econnreset|enotfound|dns error|name or service not known|nodename nor servname(?: provided, or not known)?|broken pipe|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.notFound",
    match: /\b(?:no such file or directory|enoent|cannot find the (?:file|path) specified)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|no such file or directory|enoent|cannot find the (?:file|path) specified|os error \d+)(?:\b|$)/gi,
  },
  {
    key: "error.rateLimited",
    match:
      /\b(?:rate limit(?:ed| exceeded)?|too many requests)\b|(?:^|[\s(\[])(?:http\s+|status\s*:?\s*)?429(?:$|[\s)\],.;])/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|http|status|429|rate limit(?:ed| exceeded)?|too many requests)(?:\b|$)/gi,
  },
  {
    key: "error.serviceUnavailable",
    match:
      /\b(?:service unavailable|bad gateway|gateway timeout)\b|(?:^|[\s(\[])(?:http\s+|status\s*:?\s*)?(?:502|503|504)(?:$|[\s)\],.;])/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|http|status|502|503|504|service unavailable|bad gateway|gateway timeout)(?:\b|$)/gi,
  },
  {
    key: "error.unsupported",
    match: /\b(?:not supported|unsupported|not implemented|unknown command)\b/i,
    stripGeneric:
      /(?:^|\b)(?:error|failed|not supported|unsupported|not implemented|unknown command)(?:\b|$)/gi,
  },
];

function hasConcreteErrorDetail(text: string, stripGeneric: RegExp): boolean {
  const remainder = text
    .replace(stripGeneric, " ")
    .replace(/[():,.;\-_\s]+/g, " ")
    .trim();
  return remainder.length >= 3;
}

const EXACT_STORE_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  "enter a telegram bot token first": "error.connectorTelegramTokenRequired",
  "telegram bot configured and connected": "error.connectorTelegramConnected",
  "enter both feishu app id and app secret": "error.connectorFeishuCredentialsRequired",
  "feishu bot configured and connected": "error.connectorFeishuConnected",
  "bot connection stopped": "error.connectorBotStopped",
  "wechat qr login ready": "error.connectorWechatQrReady",
  "wechat bot connected": "error.connectorWechatConnected",
  "no dispatch target is available from this host": "error.dispatchNoTarget",
  "a remote target needs the workspace path on that host": "error.dispatchPathRequired",
  "a job needs a prompt": "error.dispatchPromptRequired",
  "cancel requested": "error.dispatchCancelRequested",
  "the target rewrote the event log; replaying it": "error.dispatchLogReplaying",
  rejected: "error.dispatchRejected",
  approved: "error.dispatchApproved",
  "a message needs text": "error.dispatchMessageRequired",
  "sent to the running turn": "error.dispatchSentSteering",
  "next turn started": "error.dispatchNextTurnStarted",
  "result synced": "error.dispatchResultSynced",
  "saved the service auth": "error.webSearchSavedAuth",
  "saved the service endpoint": "error.webSearchSavedEndpoint",
  "saved the credential id": "error.webSearchSavedCredentialId",
  "saved the key": "error.webSearchSavedKey",
  "removed the key": "error.webSearchRemovedKey",
  "a key is needed for this provider": "error.webSearchKeyNeeded",
};

const WEB_SEARCH_PROVIDER_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  "exa (free mcp)": "settings.webSearch.providerExaFree",
  exa_mcp_free: "settings.webSearch.providerExaFree",
  "exa search api": "settings.webSearch.providerExaApi",
  exa_search_api: "settings.webSearch.providerExaApi",
  tavily: "settings.webSearch.providerTavily",
  deepseek: "settings.webSearch.providerDeepseek",
  keenable: "settings.webSearch.providerKeenable",
  "your own http service": "settings.webSearch.providerHttp",
  openbitfun_search_http: "settings.webSearch.providerHttp",
};

function localizeStoreMessage(locale: AppLocale, text: string): string | null {
  const exactKey = EXACT_STORE_MESSAGE_KEYS[text.toLowerCase()];
  if (exactKey) {
    return trForLocale(locale, exactKey);
  }

  const savedWebSearch = /^Saved\s+(.+)$/i.exec(text);
  if (savedWebSearch) {
    const rawTarget = savedWebSearch[1].trim();
    const providerKey = WEB_SEARCH_PROVIDER_LABEL_KEYS[rawTarget.toLowerCase()];
    if (providerKey) {
      return trForLocale(locale, "settings.notice.savedField", {
        label: trForLocale(locale, providerKey),
      });
    }
    if (/^(?:exa|openbitfun)$/i.test(rawTarget)) {
      return trForLocale(locale, "settings.notice.savedField", { label: rawTarget });
    }
  }

  const submittedTo = /^Submitted to\s+(.+)$/i.exec(text);
  if (submittedTo) {
    return trForLocale(locale, "error.dispatchSubmittedTo", { target: submittedTo[1].trim() });
  }

  const syncedCommit = /^Synced\s+([A-Za-z0-9._-]+)$/i.exec(text);
  if (syncedCommit) {
    return trForLocale(locale, "error.dispatchSyncedCommit", { commit: syncedCommit[1] });
  }

  return null;
}

/**
 * The fleet layer's refusals (`"<prefix>: <detail>"`), which name device ids
 * and wire reasons, never anything a person reads: a device whose network is
 * off, a verb that needs the network, a device that cannot be reached.
 */
function localizeFleetRefusal(locale: AppLocale, text: string): string | null {
  const prefix = /^\s*(fleet_unavailable|fleet_device_offline)\s*:/.exec(text)?.[1];
  if (!prefix) return null;
  if (prefix === "fleet_unavailable") return trForLocale(locale, "error.fleetUnavailable");
  if (/\(device_network_off\)/.test(text)) return trForLocale(locale, "error.fleetNetworkOff");
  return trForLocale(locale, "error.fleetDeviceOffline");
}

function localizeHostErrorForLocale(locale: AppLocale, raw: unknown): string {
  const text = extractRawErrorMessage(raw);
  if (!text) return "";

  const fleetRefusal = localizeFleetRefusal(locale, text);
  if (fleetRefusal !== null) return fleetRefusal;

  const storeTranslated = localizeStoreMessage(locale, text);
  if (storeTranslated !== null) {
    return storeTranslated;
  }

  if (isAuthRequiredError(text)) {
    return trForLocale(locale, "error.authRequired");
  }

  for (const rule of HOST_ERROR_RULES) {
    if (!rule.match.test(text)) continue;
    const summary = trForLocale(locale, rule.key);
    if (!hasConcreteErrorDetail(text, rule.stripGeneric)) {
      return summary;
    }
    if (locale === "en-US") {
      return text;
    }
    return trForLocale(locale, "error.withDetail", { summary, detail: text });
  }

  return text;
}

/**
 * Localizes common raw Rust/backend/network error strings and known English
 * store notices in the active UI locale while preserving concrete technical
 * diagnostics (hostnames, file paths, command names, or unrecognized errors).
 * Reactive inside JSX bindings.
 */
export function localizeHostError(raw: unknown): string {
  return localizeHostErrorForLocale(currentLocale(), raw);
}

const QUOTA_WINDOW_KEYS: Readonly<Record<string, MessageKey>> = {
  "5-hour window": "settings.subscriptions.window5h",
  "5-hour": "settings.subscriptions.window5h",
  "5h": "settings.subscriptions.window5h",
  "5h window": "settings.subscriptions.window5h",
  weekly: "settings.subscriptions.windowWeekly",
  "weekly window": "settings.subscriptions.windowWeekly",
  "7-day": "settings.subscriptions.windowWeekly",
  "7-day window": "settings.subscriptions.windowWeekly",
  week: "settings.subscriptions.windowWeekly",
  daily: "settings.subscriptions.windowDaily",
  "daily window": "settings.subscriptions.windowDaily",
  "24-hour": "settings.subscriptions.windowDaily",
  "24-hour window": "settings.subscriptions.windowDaily",
  day: "settings.subscriptions.windowDaily",
  monthly: "settings.subscriptions.windowMonthly",
  "monthly window": "settings.subscriptions.windowMonthly",
  "30-day": "settings.subscriptions.windowMonthly",
  "30-day window": "settings.subscriptions.windowMonthly",
  month: "settings.subscriptions.windowMonthly",
  hourly: "settings.subscriptions.windowHourly",
  "hourly window": "settings.subscriptions.windowHourly",
  "1-hour": "settings.subscriptions.windowHourly",
  "1-hour window": "settings.subscriptions.windowHourly",
  primary: "settings.subscriptions.primaryWindow",
  secondary: "settings.subscriptions.secondaryWindow",
};

/**
 * Localizes known backend subscription quota window labels (`5-hour window`,
 * `Weekly`, `Daily`, `Monthly`, `Hourly`, etc.) while keeping unknown custom
 * labels intact. Reactive inside JSX bindings.
 */
export function localizeQuotaWindowLabel(
  raw: string | null | undefined,
  fallbackKey: MessageKey,
): string {
  const cleaned = typeof raw === "string" ? raw.trim() : "";
  if (!cleaned) return tr(fallbackKey);
  const key = QUOTA_WINDOW_KEYS[cleaned.toLowerCase()];
  return key ? tr(key) : cleaned;
}

// The web-search provider the agent is allowed to use, and the credential it
// needs. `ai.web_search` is one document the desktop page reads and writes whole,
// so this store keeps the object it read and merges only the field the user
// touched: the host preserves fields this surface does not draw, and a write that
// dropped them would lose a newer provider's configuration.
//
// The secret itself never lives in the config: `save_web_search_credential` puts
// it in the device-local vault under a logical id, and `get_web_search_credential_status`
// reports whether that id is filled.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { invokeCommand } from "./bridge";
import { runStep } from "./state";

export type WebSearchProviderId =
  | "exa_mcp_free"
  | "exa_search_api"
  | "tavily"
  | "deepseek"
  | "keenable"
  | "openbitfun_search_http";

export interface WebSearchProvider {
  value: WebSearchProviderId;
  label: string;
  hint: string;
  /** A key is required to search at all. */
  needsCredential: boolean;
  /** A key is optional: it raises a limit rather than unlocking the provider. */
  credentialOptional?: boolean;
}

export const WEB_SEARCH_PROVIDERS: ReadonlyArray<WebSearchProvider> = [
  {
    value: "exa_mcp_free",
    label: "Exa (free MCP)",
    hint: "Works without a key and needs no setup",
    needsCredential: false,
  },
  {
    value: "exa_search_api",
    label: "Exa Search API",
    hint: "Exa's own API, with your key",
    needsCredential: true,
  },
  { value: "tavily", label: "Tavily", hint: "Tavily search API", needsCredential: true },
  { value: "deepseek", label: "DeepSeek", hint: "DeepSeek search", needsCredential: true },
  {
    value: "keenable",
    label: "Keenable",
    hint: "Searches without a key; a key raises its limits",
    needsCredential: false,
    credentialOptional: true,
  },
  {
    value: "openbitfun_search_http",
    label: "Your own HTTP service",
    hint: "Any endpoint that answers the OpenBitFun search protocol",
    needsCredential: false,
  },
];

export const WEB_SEARCH_AUTH_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "none", label: "No auth" },
  { value: "bearer", label: "Bearer token" },
  { value: "header", label: "Custom header" },
];

const CONFIG_PATH = "ai.web_search";
const DEFAULT_CREDENTIAL_IDS: Record<string, string> = {
  exa_search_api: "exa-search-api",
  tavily: "tavily-search-api",
  deepseek: "deepseek-search-api",
  keenable: "keenable-search-api",
  openbitfun_search_http: "openbitfun-search-http",
};

interface SearchHttpAuth {
  mode?: string;
  credentialId?: string;
  headerName?: string;
}

interface SearchHttpProvider {
  endpoint?: string;
  auth?: SearchHttpAuth;
}

type SearchDocument = Record<string, unknown> & {
  provider?: unknown;
  providers?: Record<string, unknown>;
};

/** The document as read, so a write can merge instead of replacing it. */
export const webSearchConfig = signal<SearchDocument | null>(null);
/** `null` until the host has been asked; `false` means the path is not stored. */
export const webSearchSupported = signal<boolean | null>(null);
export const webSearchNotice = signal("");
/** Whether the vault holds a secret for the provider being looked at. */
export const webSearchCredential = signal<{ provider: string; configured: boolean } | null>(null);

let loading = false;

function documentOf(): SearchDocument {
  const current = webSearchConfig();
  return current ?? { provider: "exa_mcp_free", providers: {} };
}

export function selectedProvider(): string {
  const value = documentOf().provider;
  return typeof value === "string" && value ? value : "exa_mcp_free";
}

export function providerOf(id: string): WebSearchProvider | undefined {
  return WEB_SEARCH_PROVIDERS.find(entry => entry.value === id);
}

function providersOf(document: SearchDocument): Record<string, unknown> {
  const value = document.providers;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The logical vault id a keyed provider stores its secret under. */
export function credentialIdFor(providerId: string): string {
  const providers = providersOf(documentOf());
  if (providerId === "openbitfun_search_http") {
    const http = (providers.openbitfun_search_http ?? {}) as SearchHttpProvider;
    const id = http.auth?.credentialId;
    if (typeof id === "string" && id) return id;
    return DEFAULT_CREDENTIAL_IDS.openbitfun_search_http;
  }
  const entry = (providers[providerId] ?? {}) as { credentialId?: unknown };
  if (typeof entry.credentialId === "string" && entry.credentialId) return entry.credentialId;
  return DEFAULT_CREDENTIAL_IDS[providerId] ?? "";
}

export function httpProvider(): Required<Omit<SearchHttpProvider, "auth">> & { auth: Required<SearchHttpAuth> } {
  const providers = providersOf(documentOf());
  const http = (providers.openbitfun_search_http ?? {}) as SearchHttpProvider;
  const auth = http.auth ?? {};
  return {
    endpoint: typeof http.endpoint === "string" ? http.endpoint : "",
    auth: {
      mode: typeof auth.mode === "string" && auth.mode ? auth.mode : "none",
      credentialId: typeof auth.credentialId === "string" ? auth.credentialId : DEFAULT_CREDENTIAL_IDS.openbitfun_search_http,
      headerName: typeof auth.headerName === "string" ? auth.headerName : "",
    },
  };
}

/** Reads the document once; the settings section calls this on every render. */
export function ensureWebSearch(): void {
  if (webSearchSupported() !== null || loading) return;
  loading = true;
  void loadWebSearch().finally(() => {
    loading = false;
  });
}

export async function loadWebSearch(): Promise<void> {
  await runStep(async () => {
    try {
      const config = await getConfig(CONFIG_PATH, true);
      webSearchConfig.set(config && typeof config === "object" ? (config as SearchDocument) : { providers: {} });
      webSearchSupported.set(true);
      webSearchNotice.set("");
    } catch {
      // A host that never stored the path still has a default provider; the
      // section draws that default and the first write creates the path.
      webSearchConfig.set({ provider: "exa_mcp_free", providers: {} });
      webSearchSupported.set(true);
    }
    await refreshCredentialStatus();
  });
}

/** Merges one provider's fields into the document and writes it back. */
async function writeDocument(next: SearchDocument, label: string): Promise<void> {
  await runStep(async () => {
    try {
      await setConfig(CONFIG_PATH, next);
      webSearchConfig.set(next);
      webSearchNotice.set(`Saved ${label}`);
    } catch (error) {
      webSearchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function chooseSearchProvider(providerId: WebSearchProviderId): Promise<void> {
  const current = documentOf();
  const next: SearchDocument = { ...current, provider: providerId };
  await writeDocument(next, providerOf(providerId)?.label ?? providerId);
  await refreshCredentialStatus();
}

export async function setProviderCredentialId(providerId: string, credentialId: string): Promise<void> {
  const current = documentOf();
  const providers = providersOf(current);
  const entry = (providers[providerId] ?? {}) as Record<string, unknown>;
  const next: SearchDocument = {
    ...current,
    providers: { ...providers, [providerId]: { ...entry, credentialId } },
  };
  await writeDocument(next, "the credential id");
}

export async function setHttpAuth(patch: Partial<Required<SearchHttpAuth>>): Promise<void> {
  const current = documentOf();
  const providers = providersOf(current);
  const http = (providers.openbitfun_search_http ?? {}) as SearchHttpProvider;
  const next: SearchDocument = {
    ...current,
    providers: {
      ...providers,
      openbitfun_search_http: { ...http, auth: { ...(http.auth ?? {}), ...patch } },
    },
  };
  await writeDocument(next, "the service auth");
}

export async function setHttpEndpoint(endpoint: string): Promise<void> {
  const current = documentOf();
  const providers = providersOf(current);
  const http = (providers.openbitfun_search_http ?? {}) as SearchHttpProvider;
  const next: SearchDocument = {
    ...current,
    providers: { ...providers, openbitfun_search_http: { ...http, endpoint } },
  };
  await writeDocument(next, "the service endpoint");
}

/** Asks whether the vault holds a key for a provider. */
export async function refreshCredentialStatus(): Promise<void> {
  const id = selectedProvider();
  const provider = providerOf(id);
  if (!provider || (!provider.needsCredential && !provider.credentialOptional)) {
    webSearchCredential.set(null);
    return;
  }
  try {
    const status = await invokeCommand<{ provider?: string; configured?: boolean }>(
      "get_web_search_credential_status",
      { provider: id },
    );
    webSearchCredential.set({ provider: id, configured: status?.configured === true });
  } catch {
    // A host without the vault helpers reports nothing rather than an error.
    webSearchCredential.set(null);
  }
}

export async function saveSearchCredential(secret: string): Promise<void> {
  const id = selectedProvider();
  const value = secret.trim();
  if (!value) {
    webSearchNotice.set("A key is needed for this provider");
    return;
  }
  await runStep(async () => {
    try {
      const status = await invokeCommand<{ configured?: boolean }>("save_web_search_credential", {
        provider: id,
        secret: value,
      });
      webSearchCredential.set({ provider: id, configured: status?.configured === true });
      webSearchNotice.set("Saved the key");
    } catch (error) {
      webSearchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function clearSearchCredential(): Promise<void> {
  const id = selectedProvider();
  await runStep(async () => {
    try {
      const status = await invokeCommand<{ configured?: boolean }>("clear_web_search_credential", {
        provider: id,
      });
      webSearchCredential.set({ provider: id, configured: status?.configured === true });
      webSearchNotice.set("Removed the key");
    } catch (error) {
      webSearchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

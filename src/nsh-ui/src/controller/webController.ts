// The browser's `ControllerPort`: a page the OpenBitFun domain serves signs in
// with the email code and drives the account's devices through the server
// gateway.
//
// - Account and devices: the gateway's HTTPS API (`/obp/api/v1/*`, same origin,
//   an HttpOnly session cookie). Every fact and every reason a device cannot be
//   reached comes from there.
// - Identity: this browser's own device key, made and kept by the page realm
//   (`host.js`: WebCrypto X25519, non-extractable, IndexedDB) and registered in
//   the account's device directory at sign-in.
// - Connection: `wss://<domain>/obp/<deviceId>`, a byte pipe into the account's
//   Link network; inside it the page realm runs OBP's end-to-end channel, so the
//   gateway sees only ciphertext. `webSocketConnection.ts` runs on top unchanged.
// - The device's own UI: once connected, `placeUi` asks the device for its web
//   UI manifest over that channel (`ui_bundle_manifest`). The device key
//   authenticates it. The page realm hands it to the UI loader
//   (`web/ui-loader.js`, a Service Worker), which recomputes its bundleId. When
//   that id is this page's own (`uiBundleId`), the page drives the device in
//   place. Otherwise it writes the handoff and opens
//   `/b/<bundleId>/index.html#device=<deviceId>`, where the loader serves
//   the device's files from the server's pool after verifying every byte.

import { readAccountIdentity } from "../accountIdentity";
import { createWebSocketConnection } from "../webSocketConnection";
import { callController, controllerSocketFactory } from "./controllerSocket";
import {
  ControllerError,
  type ControllerLaunchState,
  type ControllerUiPlacement,
  type ControllerUiUpdate,
  type ControllerAccount,
  type ControllerCodeChallenge,
  type ControllerConnection,
  type ControllerDevice,
  type ControllerErrorCode,
  type ControllerPort,
} from "./controllerPort";

/** Where the gateway answers, from the page's `#nsh-params` `{controller}`. */
export interface WebControllerParams {
  /** `https://<domain>/obp/api/v1` (or a path resolved against the page). */
  api: string;
  /** `wss://<domain>/obp` (or a path resolved against the page). */
  gateway: string;
  /**
   * The bundleId of the UI this page runs: the launcher's build writes it,
   * and a device UI page has it from its address. `null`: unknown, so every
   * device's UI opens as its own page.
   */
  uiBundleId?: string | null;
  /** This page is a device's UI that the loader serves (`/b/<bundleId>/`), not the launcher. */
  bundlePage?: boolean;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type Fetcher = (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

export interface WebControllerOptions extends WebControllerParams {
  /** Defaults to the realm's `fetch`. */
  fetch?: Fetcher;
  /** How long `connect` waits for the device (45 s). */
  connectTimeoutMs?: number;
}

function pageBase(): string | null {
  const scope = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
  return scope.document?.baseURI ?? scope.location?.href ?? null;
}

/** An absolute URL for `value`, switching to `ws(s)` when `socket`. */
export function resolveControllerUrl(value: string, socket: boolean, base: string | null = pageBase()): string {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return value;
  }
  if (socket) {
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
  }
  return url.href.replace(/\/$/, "");
}

const API_CODES: Record<string, ControllerErrorCode> = {
  invalid_email: "invalid_email",
  invalid_code: "invalid_code",
  rate_limited: "rate_limited",
  signed_out: "signed_out",
  not_found: "unreachable",
  unavailable: "unavailable",
  bad_origin: "unavailable",
};

/** The `ControllerError` a pipe that closed before it opened stands for. */
export function refusalError(code: number, reason: string): ControllerError {
  const message = reason.replace(/^[a-z_]+:\s*/, "") || "The device connection closed";
  switch (code) {
    case 4401:
      return new ControllerError("signed_out", message);
    case 4403:
    case 4404:
    case 4408:
      return new ControllerError("unreachable", message);
    case 4426:
      return new ControllerError("unsupported", message);
    case 4429:
    case 4503:
    case 4500:
      return new ControllerError("unavailable", message);
    default:
      return new ControllerError("network", message);
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function accountOf(value: unknown): ControllerAccount {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    accountId: asString(record.accountId) ?? "",
    identity: readAccountIdentity(record.identity),
    deviceId: asString(record.deviceId) ?? "",
  };
}

function deviceOf(value: unknown): ControllerDevice {
  const record = (value ?? {}) as Record<string, unknown>;
  const unavailable = record.unavailable as { code?: unknown; message?: unknown } | null | undefined;
  return {
    deviceId: asString(record.deviceId) ?? "",
    name: asString(record.name) ?? asString(record.deviceId) ?? "",
    kind: asString(record.kind),
    os: asString(record.os),
    model: asString(record.model),
    clientVersion: asString(record.clientVersion),
    online: record.online === true,
    lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : null,
    connectable: record.connectable === true,
    unavailable:
      unavailable && typeof unavailable === "object"
        ? { code: asString(unavailable.code) ?? "unavailable", message: asString(unavailable.message) ?? "" }
        : null,
    route: asString(record.route),
  };
}

/** The `ControllerError` a failed `ui_bundle_manifest` call stands for. */
export function uiManifestError(error: unknown): ControllerError {
  const message = error instanceof Error ? error.message : String(error);
  // No web UI on the device, or a build before the command (`forbidden_for_scope:
  // ... is unknown to this OpenBitFun backend version`, an older peer host's
  // "unsupported"): both need OpenBitFun updated there.
  if (/ui_bundle_unavailable|unknown to this OpenBitFun|unsupported|unknown (command|method)|not found/i.test(message)) {
    return new ControllerError("device_ui_unavailable", message.replace(/^[a-z_]+:\s*/, ""));
  }
  return new ControllerError("unavailable", message);
}

/** The `ControllerError` a failed page-realm bundle step stands for. */
export function uiPrepareError(error: unknown): ControllerError {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.replace(/^[a-z_]+:\s*/, "");
  if (message.startsWith("ui_bundle_schema:")) return new ControllerError("page_outdated", text);
  if (message.startsWith("controller_unsupported:")) return new ControllerError("unsupported", text);
  if (message.startsWith("ui_bundle_invalid:")) return new ControllerError("device_ui_unavailable", text);
  return new ControllerError("unavailable", text);
}

interface PageLaunchState {
  handoff?: { deviceId?: unknown } | null;
  showDevices?: unknown;
  uiError?: { reason?: unknown; file?: unknown } | null;
}

/** The launch state for what the page realm read (`openbitfun.controller.page`). */
export function launchStateOf(page: PageLaunchState | null | undefined): ControllerLaunchState {
  const deviceId = asString(page?.handoff?.deviceId);
  const reason = asString(page?.uiError?.reason);
  const file = asString(page?.uiError?.file);
  let failure: ControllerError | null = null;
  if (reason === "verification") {
    failure = new ControllerError("ui_verification_failed", `${file ?? "A file"} failed verification`, null, file);
  } else if (reason === "signed_out") {
    failure = new ControllerError("signed_out", "The session ended");
  } else if (reason) {
    failure = new ControllerError("ui_load_failed", `${file ?? "A file"} could not be loaded`, null, file);
  }
  return { deviceId, showDevices: page?.showDevices === true, failure };
}

export function createWebController(options: WebControllerOptions): ControllerPort {
  const api = resolveControllerUrl(options.api, false);
  const gateway = resolveControllerUrl(options.gateway, true);
  const connectTimeoutMs = options.connectTimeoutMs ?? 45_000;
  /** Where the gateway says the account's cloud node is reached (`GET /devices` `cloudNode`). */
  let cloudNode: { deviceId: string; path: string } | null = null;

  function rememberCloudNode(value: unknown): void {
    const node = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    const deviceId = typeof node?.deviceId === "string" ? node.deviceId : "";
    const path = typeof node?.path === "string" ? node.path : "";
    cloudNode = deviceId && path.startsWith("/") ? { deviceId, path } : null;
  }

  async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
    const fetcher = options.fetch ?? (globalThis as { fetch?: Fetcher }).fetch;
    if (typeof fetcher !== "function") throw new ControllerError("network", "This page cannot make requests");
    let response: FetchResponse;
    try {
      response = await fetcher(`${api}${path}`, {
        method: init.method ?? "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: init.body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ControllerError("network", "Could not reach OpenBitFun; check the connection");
    }
    let parsed: Record<string, unknown> = {};
    try {
      const text = await response.text();
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // A proxy page instead of JSON: the status below decides.
    }
    if (!response.ok) {
      const code = API_CODES[String(parsed.error ?? "")] ?? (response.status === 401 ? "signed_out" : "unavailable");
      const message = asString(parsed.message) ?? `The server answered HTTP ${response.status}`;
      const retry = typeof parsed.retryAfterSeconds === "number" ? parsed.retryAfterSeconds : null;
      throw new ControllerError(code, message, retry);
    }
    return parsed;
  }

  return {
    kind: "web",
    async restore() {
      const answer = await request("/session");
      return answer.signedIn === true ? accountOf(answer.account) : null;
    },
    async requestCode(email, requestOptions) {
      const answer = await request("/auth/code", {
        method: "POST",
        body: { email, locale: requestOptions?.locale ?? "en-US" },
      });
      return {
        challengeId: asString(answer.challengeId) ?? "",
        email: asString(answer.email) ?? email,
        codeLength: typeof answer.codeLength === "number" ? answer.codeLength : 8,
        retryAfterSeconds: typeof answer.retryAfterSeconds === "number" ? answer.retryAfterSeconds : 60,
        expiresAt: typeof answer.expiresAt === "number" ? answer.expiresAt : null,
      } satisfies ControllerCodeChallenge;
    },
    async verifyCode(challenge, code) {
      let key: { deviceId: string; publicKey: string };
      try {
        key = await callController<{ deviceId: string; publicKey: string }>("key");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ControllerError("unsupported", message.replace(/^controller_unsupported:\s*/, ""));
      }
      const answer = await request("/auth/verify", {
        method: "POST",
        body: { challengeId: challenge.challengeId, code, device: key },
      });
      return accountOf(answer.account);
    },
    async signOut() {
      cloudNode = null;
      try {
        await request("/auth/sign-out", { method: "POST" });
      } finally {
        // A new sign-in registers a new device key.
        await callController("forgetKey").catch(() => undefined);
      }
    },
    async listDevices() {
      const answer = await request("/devices");
      rememberCloudNode(answer.cloudNode);
      return Array.isArray(answer.devices) ? answer.devices.map(deviceOf) : [];
    },
    async entryCandidates() {
      const answer = await request("/devices");
      rememberCloudNode(answer.cloudNode);
      return Array.isArray(answer.entryCandidates)
        ? answer.entryCandidates.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    },
    async connect(deviceId, connectOptions) {
      const key = await request(`/devices/${encodeURIComponent(deviceId)}/key`);
      const devicePublicKey = asString(key.publicKey);
      if (!devicePublicKey) throw new ControllerError("unreachable", "This device has no key in your account");
      let settled = false;
      let refuse: (error: ControllerError) => void = () => undefined;
      const refused = new Promise<never>((_, reject) => {
        refuse = reject;
      });
      refused.catch(() => undefined);
      const connection = createWebSocketConnection({
        // The account's cloud node is reached at its own path (`cloudNode.path`,
        // `/agent/obp`), not through the device pipe under `/obp/<id>`.
        url:
          cloudNode && cloudNode.deviceId === deviceId
            ? resolveControllerUrl(cloudNode.path, true)
            : `${gateway}/${encodeURIComponent(deviceId)}`,
        client: "openbitfun-web-controller",
        // The fleet entry walker shares its vector cursor across entries.
        ...(connectOptions?.fleet ? { fleet: { cursor: connectOptions.fleet.cursor } } : {}),
        createSocket: controllerSocketFactory({
          deviceId,
          devicePublicKey,
          onRefused: (code, reason) => {
            if (!settled) refuse(refusalError(code, reason));
          },
        }),
      });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ControllerError("unreachable", "The device did not answer in time")),
          connectTimeoutMs,
        );
      });
      try {
        await Promise.race([connection.ready(), refused, timedOut]);
      } catch (error) {
        connection.close();
        throw error instanceof ControllerError ? error : new ControllerError("unavailable", String(error));
      } finally {
        settled = true;
        if (timer !== null) clearTimeout(timer);
      }
      const controllerConnection: ControllerConnection = { ...connection, deviceId, close: () => connection.close() };
      return controllerConnection;
    },
    async launchState() {
      try {
        return launchStateOf(await callController<PageLaunchState>("page"));
      } catch {
        return launchStateOf(null);
      }
    },
    async placeUi(connection): Promise<ControllerUiPlacement> {
      const resolved = await resolveUiBundle(connection);
      const prepared = await prepareBundleOnLoader(resolved);
      if (options.uiBundleId && prepared.bundleId === options.uiBundleId) return { kind: "here" };
      // The pool's cookie path (`/cas`) is re-issued with the session.
      const session = await request("/session");
      if (session.signedIn !== true) throw new ControllerError("signed_out", "The session ended");
      const deviceId = connection.deviceId;
      return {
        kind: "away",
        open: async () => {
          try {
            await callController("launch", { bundleId: prepared.bundleId, deviceId });
          } catch (error) {
            throw uiPrepareError(error);
          }
        },
      };
    },
    async checkUiUpdate(connection): Promise<ControllerUiUpdate | null> {
      if (!options.uiBundleId) return null;
      let resolved: ResolvedUiBundle;
      try {
        resolved = await resolveUiBundle(connection);
      } catch {
        return null;
      }
      let prepared: { bundleId: string };
      try {
        prepared = await prepareBundleOnLoader(resolved);
      } catch {
        return null;
      }
      if (prepared.bundleId === options.uiBundleId) return null;
      const version = asString((resolved.manifest as Record<string, unknown>)?.version);
      const deviceId = connection.deviceId;
      return {
        bundleId: prepared.bundleId,
        version,
        apply: async () => {
          const session = await request("/session");
          if (session.signedIn !== true) throw new ControllerError("signed_out", "The session ended");
          try {
            await callController("launch", { bundleId: prepared.bundleId, deviceId });
          } catch (error) {
            throw uiPrepareError(error);
          }
        },
      };
    },
    async leave() {
      if (!options.bundlePage) return false;
      await callController("leave");
      return true;
    },
  };

  interface ResolvedUiBundle {
    manifest: Record<string, unknown>;
    statedBundleId: string | null;
    ownerDeviceId: string;
    holders: string[];
  }

  function validHolders(raw: unknown, fallbackDeviceId: string): string[] {
    const out: string[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string" && item.length > 0 && !out.includes(item)) out.push(item);
      }
    }
    if (out.length === 0 && fallbackDeviceId) out.push(fallbackDeviceId);
    return out;
  }

  /**
   * Resolves the best web UI manifest for this connection: on a fleet entry,
   * asks `fleet_ui_bundle` so the browser picks the newest compatible bundle
   * across all online devices (e.g. an updated CLI peer alongside an older
   * desktop entry) with all its holders; falls back to `ui_bundle_manifest`
   * on non-fleet or older hosts.
   */
  async function resolveUiBundle(connection: ControllerConnection): Promise<ResolvedUiBundle> {
    if (connection.fleet?.()) {
      try {
        const fleetAnswer = (await connection.invoke("fleet_ui_bundle", { request: {} })) as {
          manifest?: unknown;
          bundleId?: unknown;
          ownerDeviceId?: unknown;
          holders?: unknown;
        } | null;
        if (fleetAnswer && typeof fleetAnswer.manifest === "object" && fleetAnswer.manifest !== null) {
          const ownerDeviceId = asString(fleetAnswer.ownerDeviceId) ?? connection.deviceId;
          const holders = validHolders(fleetAnswer.holders, ownerDeviceId);
          return {
            manifest: fleetAnswer.manifest as Record<string, unknown>,
            statedBundleId: asString(fleetAnswer.bundleId),
            ownerDeviceId,
            holders,
          };
        }
      } catch (error) {
        // Older entries without `fleet_ui_bundle`, or entries with no fleet
        // peers yet: fall back to the entry's own `ui_bundle_manifest`.
        const message = error instanceof Error ? error.message : String(error);
        if (!/unknown|unsupported|forbidden_for_scope|not found|no handler|ui_bundle_unavailable/i.test(message)) {
          // Even transient fleet errors still have a valid direct fallback on this entry.
          console.warn(`fleet_ui_bundle failed, falling back to ui_bundle_manifest: ${message}`);
        }
      }
    }

    let answer: { manifest?: unknown; bundleId?: unknown } | null;
    try {
      answer = (await connection.invoke("ui_bundle_manifest", { request: {} })) as typeof answer;
    } catch (error) {
      throw uiManifestError(error);
    }
    if (!answer || typeof answer.manifest !== "object" || answer.manifest === null) {
      throw new ControllerError("device_ui_unavailable", "The device answered no web UI manifest");
    }
    return {
      manifest: answer.manifest as Record<string, unknown>,
      statedBundleId: asString(answer.bundleId),
      ownerDeviceId: connection.deviceId,
      holders: [connection.deviceId],
    };
  }

  async function prepareBundleOnLoader(resolved: ResolvedUiBundle): Promise<{ bundleId: string }> {
    const extraHolders = resolved.holders.filter(id => id !== resolved.ownerDeviceId);
    const args: Record<string, unknown> = {
      manifest: resolved.manifest,
      deviceId: resolved.ownerDeviceId,
      ...(extraHolders.length > 0 ? { holders: resolved.holders } : {}),
    };
    let prepared: { bundleId: string };
    try {
      prepared = await callController<{ bundleId: string }>("prepareBundle", args);
    } catch (error) {
      throw uiPrepareError(error);
    }
    // The device's stated id is a hint only; the loader's own count decides.
    if (resolved.statedBundleId && resolved.statedBundleId !== prepared.bundleId) {
      console.warn("The device stated another UI bundle id than its manifest has");
    }
    return prepared;
  }
}

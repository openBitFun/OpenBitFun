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

import { createWebSocketConnection } from "../webSocketConnection";
import { callController, controllerSocketFactory } from "./controllerSocket";
import {
  ControllerError,
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
    email: asString(record.email),
    login: asString(record.login),
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

export function createWebController(options: WebControllerOptions): ControllerPort {
  const api = resolveControllerUrl(options.api, false);
  const gateway = resolveControllerUrl(options.gateway, true);
  const connectTimeoutMs = options.connectTimeoutMs ?? 45_000;

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
      try {
        await request("/auth/sign-out", { method: "POST" });
      } finally {
        // A new sign-in registers a new device key.
        await callController("forgetKey").catch(() => undefined);
      }
    },
    async listDevices() {
      const answer = await request("/devices");
      return Array.isArray(answer.devices) ? answer.devices.map(deviceOf) : [];
    },
    async connect(deviceId) {
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
        url: `${gateway}/${encodeURIComponent(deviceId)}`,
        client: "openbitfun-web-controller",
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
  };
}

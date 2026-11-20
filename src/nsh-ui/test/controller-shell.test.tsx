// The controller shell of a page the OpenBitFun domain serves (`#nsh-params`
// `{controller}`): sign in with the email code, the account's devices as the
// gateway lists them, and a connection over the page realm's end-to-end
// channel (`openbitfun.controller.*`). The studio then runs over that
// connection and never touches the page host's fixtures.

import { expect, open, test, type App } from "nsh/test";
import { refusalError, resolveControllerUrl } from "../src/controller/webController";
import { createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const API = "https://remote.openbitfun.com/obp/api/v1";
const PARAMS = { controller: { api: API, gateway: "wss://remote.openbitfun.com/obp" } };

const DEVICES = {
  devices: [
    {
      deviceId: "desk-1",
      name: "Studio Mac",
      kind: "desktop",
      os: "macOS",
      clientVersion: "1.0.12",
      online: true,
      lastSeenAt: null,
      connectable: true,
      unavailable: null,
      route: null,
    },
    {
      deviceId: "old-2",
      name: "Old laptop",
      kind: "desktop",
      os: "Windows",
      online: false,
      lastSeenAt: 1_700_000_000_000,
      connectable: false,
      unavailable: { code: "offline", message: "This device is offline. Open OpenBitFun on it and sign in to this account." },
      route: null,
    },
  ],
};

function hello() {
  return {
    jsonrpc: "2.0",
    id: 0,
    result: {
      protocol: 1,
      scope: "account-device",
      capabilities: ["obp_v1", "mesh_v1"],
      registryDigest: "fnv1a64:test",
      lastSeq: 0,
      creditBytes: 1048576,
      backend: { version: "9.9.9", platform: "macos", instanceId: "desk-instance" },
    },
  };
}

/** The gateway API, the page realm's channel, and a device backend behind it. */
function controllerHost(options: { refuse?: { code: number; reason: string } } = {}) {
  const backend = createDeviceBackend();
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const opened: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const pageHostCalls: unknown[] = [];
  let app: App | null = null;
  let session = false;
  const push = (payload: Record<string, unknown>) => {
    setTimeout(() => void app?.host.send("openbitfun.controller.socket", payload), 0);
  };
  const record = (request: { method: string; url: string; body?: string | null }) =>
    requests.push({ method: request.method, url: request.url, body: request.body ? JSON.parse(request.body) : null });
  const network = {
    [`GET ${API}/session`]: () =>
      session
        ? { body: { signedIn: true, account: { accountId: "email-1", email: "me@example.com", deviceId: "web-1" } } }
        : { body: { signedIn: false } },
    [`POST ${API}/auth/code`]: (request: { method: string; url: string; body?: string | null }) => {
      record(request);
      return { body: { challengeId: "ch-1", email: "me@example.com", codeLength: 8, retryAfterSeconds: 60, expiresAt: null } };
    },
    [`POST ${API}/auth/verify`]: (request: { method: string; url: string; body?: string | null }) => {
      record(request);
      const body = JSON.parse(request.body ?? "{}") as { code?: string };
      if (body.code !== "12345678") {
        return { status: 400, body: { error: "invalid_code", message: "The verification code is incorrect." } };
      }
      session = true;
      return { body: { account: { accountId: "email-1", email: "me@example.com", deviceId: "web-1" } } };
    },
    [`GET ${API}/devices`]: { body: DEVICES },
    [`GET ${API}/devices/desk-1/key`]: { body: { deviceId: "desk-1", publicKey: "ZGVzay1rZXk=" } },
  };
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.controller.key": () => ({ ok: true, value: { deviceId: "web-1", publicKey: "d2ViLWtleQ==" } }),
    "openbitfun.controller.forgetKey": () => ({ ok: true, value: null }),
    "openbitfun.controller.open": (data: unknown) => {
      const args = data as Record<string, unknown>;
      opened.push(args);
      if (options.refuse) push({ id: args.id, type: "close", ...options.refuse });
      else push({ id: args.id, type: "open" });
      return { ok: true, value: { deviceId: "web-1" } };
    },
    "openbitfun.controller.send": (data: unknown) => {
      const { id, text } = data as { id: string; text: string };
      const frame = JSON.parse(text) as { id?: number; method: string; params: { command: string; args: Record<string, unknown> } };
      if (frame.method === "hello") {
        push({ id, type: "message", data: JSON.stringify(hello()) });
      } else if (frame.method === "call") {
        calls.push(frame.params.command);
        const keys = Object.keys(frame.params.args);
        const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
        const reply = backend.handlers["openbitfun.invoke"](
          requestShape
            ? { action: frame.params.command, request: frame.params.args.request ?? null }
            : { action: frame.params.command, raw: frame.params.args },
        ) as { ok: boolean; value?: unknown; error?: string };
        const body = reply.ok
          ? { result: reply.value ?? null }
          : { error: { code: -32000, message: reply.error ?? "failed" } };
        push({ id, type: "message", data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...body }) });
      }
      return { ok: true, value: true };
    },
    "openbitfun.controller.close": (data: unknown) => {
      push({ id: (data as { id: string }).id, type: "close", code: 1000, reason: "closed" });
      return { ok: true, value: true };
    },
    "openbitfun.invoke": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: false, error: "the page host must not be used" };
    },
    "openbitfun.listen": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: true };
    },
  };
  return {
    network,
    handlers,
    requests,
    opened,
    calls,
    pageHostCalls,
    attach(next: App) {
      app = next;
    },
  };
}

test("sign in with the email code, pick a device and drive it over the end-to-end channel", async () => {
  const host = controllerHost();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    network: host.network,
    host: { params: PARAMS, handlers: host.handlers },
  });
  host.attach(app);

  await app.waitFor("label:controller-email");
  await app.type("controller-email-input", "Me@Example.com");
  await app.press("label:controller-send-code");
  await app.waitFor("label:controller-code");
  await app.waitFor("text:We emailed a code to me@example.com. Enter its 8 digits; it expires in 10 minutes.");
  expect(host.requests[0]).toMatchObject({ method: "POST", body: { email: "Me@Example.com", locale: "en-US" } });

  // A wrong code keeps the step and says so.
  await app.type("controller-code-input", "00000000");
  await app.press("label:controller-verify");
  await app.waitFor("text:The code is wrong or expired. Check the email, or send a new code.");
  await app.clear("controller-code-input");
  await app.type("controller-code-input", "1234 5678");
  await app.press("label:controller-verify");

  await app.waitFor("label:controller-devices");
  await app.waitFor("text:Signed in as me@example.com");
  await app.waitFor("Studio Mac");
  await app.waitFor("text:This device is offline. Open OpenBitFun on it and sign in to this account.");
  expect(app.enabled("label:controller-connect-old-2")).toBe(false);
  // The browser's own device key is registered at sign-in.
  expect(host.requests.at(-1)?.body).toEqual({
    challengeId: "ch-1",
    code: "12345678",
    device: { deviceId: "web-1", publicKey: "d2ViLWtleQ==" },
  });

  await app.press("label:controller-connect-desk-1");
  await app.waitFor("label:controller-bar");
  await app.waitFor("NSH skeleton");
  expect(host.opened[0]).toMatchObject({
    url: "wss://remote.openbitfun.com/obp/desk-1",
    target: "desk-1",
    targetPublicKey: "ZGVzay1rZXk=",
  });
  expect(host.calls.length).toBeGreaterThan(0);
  // The studio runs on the device's backend only, never on page fixtures.
  expect(host.pageHostCalls).toEqual([]);

  await app.press("label:controller-switch-device");
  await app.waitFor("label:controller-devices");
  expect(app.shows("label:controller-bar")).toBe(false);
});

test("a device that cannot be reached says why and the studio stays closed", async () => {
  const host = controllerHost({
    refuse: { code: 4426, reason: "unsupported: OpenBitFun on that device is too old for browser control; update it" },
  });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    network: host.network,
    host: { params: PARAMS, handlers: host.handlers },
  });
  host.attach(app);
  await app.waitFor("label:controller-email");
  await app.type("controller-email-input", "me@example.com");
  await app.press("label:controller-send-code");
  await app.type("controller-code-input", "12345678");
  await app.press("label:controller-verify");
  await app.waitFor("label:controller-devices");
  await app.press("label:controller-connect-desk-1");
  await app.waitFor("text:OpenBitFun on that device is too old for browser control; update it");
  expect(app.shows("label:controller-bar")).toBe(false);
  expect(host.pageHostCalls).toEqual([]);
});

test("refusal codes and gateway addresses", () => {
  expect(refusalError(4401, "signed_out: sign in").code).toBe("signed_out");
  expect(refusalError(4404, "unreachable: the device is not on the device network").message).toBe(
    "the device is not on the device network",
  );
  expect(refusalError(4426, "unsupported: update it").code).toBe("unsupported");
  expect(refusalError(4429, "busy: retry").code).toBe("unavailable");
  expect(refusalError(1006, "").code).toBe("network");
  expect(resolveControllerUrl("/obp", true, "https://remote.openbitfun.com/app/")).toBe("wss://remote.openbitfun.com/obp");
  expect(resolveControllerUrl("/obp/api/v1", false, "https://remote.openbitfun.com/app/")).toBe(
    "https://remote.openbitfun.com/obp/api/v1",
  );
});

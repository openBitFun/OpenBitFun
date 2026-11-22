// The controller shell of a page the OpenBitFun domain serves (`#nsh-params`
// `{controller}`): sign in with the email code; the device then opens by
// itself (the handoff's device, else `pickUiSourceDevice`'s choice) over the
// page realm's end-to-end channel (`openbitfun.controller.*`). The device's
// web UI manifest (`ui_bundle_manifest`, over that channel) decides whether it
// runs here (the same bundleId) or the page leaves for the device's own UI. The
// studio then runs over the connection and never touches the page host's
// fixtures. The device list shows only for the explicit failure states.

import { expect, open, test, type App } from "nsh/test";
import type { ControllerDevice } from "../src/controller/controllerPort";
import { pickUiSourceDevice } from "../src/controller/controllerStore";
import { launchStateOf, refusalError, resolveControllerUrl, uiManifestError } from "../src/controller/webController";
import { createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const API = "https://super.openbitfun.com/obp/api/v1";
const OWN_BUNDLE = "a".repeat(64);
const DEVICE_BUNDLE = "b".repeat(64);
const PARAMS = { controller: { api: API, gateway: "wss://super.openbitfun.com/obp", uiBundleId: OWN_BUNDLE } };
const MANIFEST = {
  schema: 1,
  product: "openbitfun",
  version: "1.0.12",
  nsh: "0.6.1",
  entry: "index.html",
  files: [{ path: "index.html", sha256: "c".repeat(64), size: 10 }],
};

const STUDIO_MAC = {
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
};
const OLD_LAPTOP = {
  deviceId: "old-2",
  name: "Old laptop",
  kind: "desktop",
  os: "Windows",
  online: false,
  lastSeenAt: 1_700_000_000_000,
  connectable: false,
  unavailable: { code: "offline", message: "This device is offline. Open OpenBitFun on it and sign in to this account." },
  route: null,
};
const BUILD_BOX = {
  deviceId: "cli-3",
  name: "Build box",
  kind: "cli",
  os: "Linux",
  clientVersion: "1.0.13",
  online: true,
  lastSeenAt: null,
  connectable: true,
  unavailable: null,
  route: null,
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

type Request = { method: string; url: string; body?: string | null };

interface HostOptions {
  /** Pipes that close before they open, by device. */
  refuse?: Record<string, { code: number; reason: string }>;
  /** What `ui_bundle_manifest` answers, by device: a manifest (default) or an error message. */
  manifest?: Record<string, { error: string } | { manifest: unknown }>;
  /** What the loader counts as the bundleId (default: this page's own). */
  bundleId?: string;
  /** The loader's refusal (`ui_bundle_schema: ...`). */
  prepareError?: string;
  /** What the page realm says about how the page started. */
  page?: Record<string, unknown>;
  devices?: unknown[];
  signedIn?: boolean;
}

/** The gateway API, the page realm's channel and loader, and device backends behind it. */
function controllerHost(options: HostOptions = {}) {
  const backend = createDeviceBackend();
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const sessionChecks: number[] = [];
  const opened: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  const calls: string[] = [];
  const prepared: Array<Record<string, unknown>> = [];
  const launched: Array<Record<string, unknown>> = [];
  const left: number[] = [];
  const pageHostCalls: unknown[] = [];
  const socketDevice = new Map<string, string>();
  let app: App | null = null;
  let session = options.signedIn === true;
  // The page opens a device while `open()` still runs: hold events until attached.
  let held: Array<Record<string, unknown>> = [];
  const push = (payload: Record<string, unknown>) => {
    if (!app) {
      held.push(payload);
      return;
    }
    setTimeout(() => void app?.host.send("openbitfun.controller.socket", payload), 0);
  };
  const record = (request: Request) =>
    requests.push({ method: request.method, url: request.url, body: request.body ? JSON.parse(request.body) : null });
  const account = { accountId: "email-1", email: "me@example.com", deviceId: "web-1" };
  const network = {
    [`GET ${API}/session`]: () => {
      sessionChecks.push(Date.now());
      return session ? { body: { signedIn: true, account } } : { body: { signedIn: false } };
    },
    [`POST ${API}/auth/code`]: (request: Request) => {
      record(request);
      return { body: { challengeId: "ch-1", email: "me@example.com", codeLength: 8, retryAfterSeconds: 60, expiresAt: null } };
    },
    [`POST ${API}/auth/verify`]: (request: Request) => {
      record(request);
      const body = JSON.parse(request.body ?? "{}") as { code?: string };
      if (body.code !== "12345678") {
        return { status: 400, body: { error: "invalid_code", message: "The verification code is incorrect." } };
      }
      session = true;
      return { body: { account } };
    },
    [`GET ${API}/devices`]: { body: { devices: options.devices ?? [STUDIO_MAC, OLD_LAPTOP] } },
    [`GET ${API}/devices/desk-1/key`]: { body: { deviceId: "desk-1", publicKey: "ZGVzay1rZXk=" } },
    [`GET ${API}/devices/cli-3/key`]: { body: { deviceId: "cli-3", publicKey: "Y2xpLWtleQ==" } },
  };
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.controller.key": () => ({ ok: true, value: { deviceId: "web-1", publicKey: "d2ViLWtleQ==" } }),
    "openbitfun.controller.forgetKey": () => ({ ok: true, value: null }),
    "openbitfun.controller.page": () => ({
      ok: true,
      value: { handoff: null, showDevices: false, uiError: null, ...(options.page ?? {}) },
    }),
    "openbitfun.controller.prepareBundle": (data: unknown) => {
      prepared.push(data as Record<string, unknown>);
      if (options.prepareError) return { ok: false, error: options.prepareError };
      return { ok: true, value: { bundleId: options.bundleId ?? OWN_BUNDLE } };
    },
    "openbitfun.controller.launch": (data: unknown) => {
      launched.push(data as Record<string, unknown>);
      return { ok: true, value: true };
    },
    "openbitfun.controller.leave": () => {
      left.push(Date.now());
      return { ok: true, value: true };
    },
    "openbitfun.controller.open": (data: unknown) => {
      const args = data as Record<string, unknown>;
      opened.push(args);
      socketDevice.set(String(args.id), String(args.target));
      const refusal = options.refuse?.[String(args.target)];
      if (refusal) push({ id: args.id, type: "close", ...refusal });
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
        if (frame.params.command === "ui_bundle_manifest") {
          const device = socketDevice.get(id) ?? "";
          const answer = options.manifest?.[device] ?? { manifest: MANIFEST };
          const body =
            "error" in answer
              ? { error: { code: -32000, message: answer.error } }
              : { result: { manifest: answer.manifest, bundleId: "f".repeat(64) } };
          push({ id, type: "message", data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...body }) });
          return { ok: true, value: true };
        }
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
      const id = (data as { id: string }).id;
      closed.push(socketDevice.get(id) ?? id);
      push({ id, type: "close", code: 1000, reason: "closed" });
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
    sessionChecks,
    opened,
    closed,
    calls,
    prepared,
    launched,
    left,
    pageHostCalls,
    attach(next: App) {
      app = next;
      const pending = held;
      held = [];
      for (const payload of pending) push(payload);
    },
  };
}

async function start(host: ReturnType<typeof controllerHost>, params: Record<string, unknown> = PARAMS) {
  const app = await open("../App.tsx", {
    ...DESKTOP,
    network: host.network,
    host: { params, handlers: host.handlers },
  });
  host.attach(app);
  return app;
}

/**
 * Waits for `selector` in short steps: the page realm's socket events
 * (`app.host.send`) reach the app between steps, not during one long
 * `waitFor`.
 */
async function until(app: App, selector: string) {
  for (let step = 0; step < 100 && !app.shows(selector); step += 1) await app.wait(50);
  await app.waitFor(selector);
}

async function signIn(app: App) {
  await app.waitFor("label:controller-email");
  await app.type("controller-email-input", "me@example.com");
  await app.press("label:controller-continue");
  await app.type("controller-code-input", "12345678");
  await app.press("label:controller-verify");
}

test("sign in with the email code; the device opens by itself and runs in place over the end-to-end channel", async () => {
  const host = controllerHost();
  const app = await start(host);

  await app.waitFor("label:controller-email");
  await app.type("controller-email-input", "Me@Example.com");
  await app.press("label:controller-continue");
  await app.waitFor("label:controller-code");
  await app.waitFor("text:Enter the code we sent to me@example.com.");
  expect(host.requests[0]).toMatchObject({ method: "POST", body: { email: "Me@Example.com", locale: "en-US" } });

  // A wrong code keeps the step and says so.
  await app.type("controller-code-input", "00000000");
  await app.press("label:controller-verify");
  await app.waitFor("text:That code didn't work. Check it or send a new one.");
  await app.clear("controller-code-input");
  await app.type("controller-code-input", "1234 5678");
  await app.press("label:controller-verify");

  // No device picker: the only usable device opens, and its UI is this page's.
  await until(app, "label:controller-studio");
  // No device bar and no connection time: the UI fills the page.
  expect(app.texts().some(text => text.startsWith("Using Studio Mac"))).toBe(false);
  // The browser's own device key is registered at sign-in.
  expect(host.requests.at(-1)?.body).toEqual({
    challengeId: "ch-1",
    code: "12345678",
    device: { deviceId: "web-1", publicKey: "d2ViLWtleQ==" },
  });
  expect(host.opened[0]).toMatchObject({
    url: "wss://super.openbitfun.com/obp/desk-1",
    target: "desk-1",
    targetPublicKey: "ZGVzay1rZXk=",
  });
  // The manifest came over the end-to-end channel and went to the loader as it was.
  expect(host.calls[0]).toBe("ui_bundle_manifest");
  expect(host.prepared).toEqual([{ manifest: MANIFEST, deviceId: "desk-1" }]);
  expect(host.launched).toEqual([]);
  await until(app, "All sessions");
  expect(host.calls.length).toBeGreaterThan(1);
  // The account row names the page's own account, never "Sign in".
  await app.waitFor("label:account-row >> text:me@example.com");
  expect(app.shows("label:account-row >> text:Sign in")).toBe(false);
  // The studio runs on the device's backend only, never on page fixtures.
  expect(host.pageHostCalls).toEqual([]);

  // The launcher lands in the UI: no device list and no Switch device (visual spec §4.13).
  expect(app.shows("label:controller-switch-device")).toBe(false);
  expect(app.shows("label:controller-devices")).toBe(false);
  expect(host.left).toEqual([]);
});

test("a device with another UI bundle: the page refreshes the pool cookie and leaves for the device's own UI", async () => {
  const host = controllerHost({ bundleId: DEVICE_BUNDLE });
  const app = await start(host);
  await signIn(app);
  await until(app, "text:Opening OpenBitFun…");
  for (let step = 0; step < 100 && host.launched.length === 0; step += 1) await app.wait(50);
  expect(host.launched[0]).toEqual({ bundleId: DEVICE_BUNDLE, deviceId: "desk-1" });
  // `GET /session` re-issues the cookie on `/cas` after the manifest, before leaving.
  expect(host.sessionChecks.length).toBe(2);
  // This page's connection is closed; the device's UI connects again.
  expect(host.closed).toEqual(["desk-1"]);
  expect(app.shows("label:controller-studio")).toBe(false);
  expect(host.pageHostCalls).toEqual([]);
});

test("a device without a web UI, or too old to hand one out, says to update it", async () => {
  for (const error of [
    "ui_bundle_unavailable: this build ships no web UI",
    "forbidden_for_scope: command 'ui_bundle_manifest' is unknown to this OpenBitFun backend version; update the backend or check the command name",
  ]) {
    const host = controllerHost({ manifest: { "desk-1": { error } } });
    const app = await start(host);
    await signIn(app);
    await until(app, "label:controller-devices");
    await until(app, "text:This device can't be opened in a browser; update OpenBitFun on it.");
    expect(app.shows("label:controller-studio")).toBe(false);
    expect(host.prepared).toEqual([]);
    expect(host.closed).toEqual(["desk-1"]);
    expect(host.pageHostCalls).toEqual([]);
  }
});

test("every online device too old: one sentence for all, the list stays", async () => {
  const unknown = "forbidden_for_scope: command 'ui_bundle_manifest' is unknown to this OpenBitFun backend version";
  const host = controllerHost({
    devices: [STUDIO_MAC, BUILD_BOX, OLD_LAPTOP],
    manifest: { "desk-1": { error: unknown }, "cli-3": { error: unknown } },
  });
  const app = await start(host);
  await signIn(app);
  await until(app, "text:None of your online devices can be opened in a browser yet; update OpenBitFun on them.");
  // The newer build first, then the next one.
  expect(host.opened.map(entry => entry.target)).toEqual(["cli-3", "desk-1"]);
});

test("a device that cannot be reached is skipped for the next one", async () => {
  const host = controllerHost({
    devices: [STUDIO_MAC, BUILD_BOX],
    refuse: { "cli-3": { code: 4404, reason: "unreachable: the device is not on the device network" } },
  });
  const app = await start(host);
  await signIn(app);
  await until(app, "label:controller-studio");
  expect(host.opened.map(entry => entry.target)).toEqual(["cli-3", "desk-1"]);
});

test("a device that cannot be reached says why and the studio stays closed", async () => {
  const host = controllerHost({
    refuse: { "desk-1": { code: 4426, reason: "unsupported: OpenBitFun on that device is too old for browser control; update it" } },
  });
  const app = await start(host);
  await signIn(app);
  await until(app, "label:controller-devices");
  await until(app, "text:OpenBitFun on that device is too old for browser control; update it");
  expect(app.shows("label:controller-studio")).toBe(false);
  expect(host.pageHostCalls).toEqual([]);
});

test("none of the devices can be used: the list says so", async () => {
  const host = controllerHost({ devices: [OLD_LAPTOP] });
  const app = await start(host);
  await signIn(app);
  await until(app, "label:controller-devices");
  await app.waitFor(
    "text:Open OpenBitFun on a computer signed in with this email, then try again.",
  );
  expect(host.opened).toEqual([]);
});

test("a manifest newer than this page asks for a reload", async () => {
  const host = controllerHost({ prepareError: "ui_bundle_schema: manifest schema 2 is newer than this page reads (1)" });
  const app = await start(host);
  await signIn(app);
  await until(app, "text:This page is older than your device. Reload to continue.");
  expect(host.launched).toEqual([]);
  expect(app.shows("label:controller-studio")).toBe(false);
});

test("a UI file that failed verification says so, and nothing opens by itself", async () => {
  const host = controllerHost({
    signedIn: true,
    page: { uiError: { reason: "verification", file: "app.1234567890.js", bundleId: DEVICE_BUNDLE } },
  });
  const app = await start(host);
  await until(app, "label:controller-devices");
  await app.waitFor("text:Something from your device didn't pass a safety check, so nothing ran. Try again.");
  expect(host.opened).toEqual([]);
  // Connecting again is the user's explicit choice from the list.
  await app.press("label:controller-connect-desk-1");
  await until(app, "label:controller-studio");
});

test("a device's own UI page: the handoff names the device and it runs in place", async () => {
  const host = controllerHost({
    signedIn: true,
    devices: [BUILD_BOX, STUDIO_MAC],
    bundleId: DEVICE_BUNDLE,
    page: { handoff: { v: 1, deviceId: "desk-1", at: 1_700_000_000_000 } },
  });
  const app = await start(host, {
    controller: { ...PARAMS.controller, uiBundleId: DEVICE_BUNDLE, bundlePage: true },
  });
  // No sign-in and no pick: straight to the handed-over device, not the newer one.
  await until(app, "label:controller-studio");
  expect(host.opened.map(entry => entry.target)).toEqual(["desk-1"]);
  expect(host.launched).toEqual([]);
  // A restored session is signed in on the account row too.
  await until(app, "All sessions");
  await app.waitFor("label:account-row >> text:me@example.com");
  // No device bar to leave from (visual spec §4.13).
  expect(app.shows("label:controller-switch-device")).toBe(false);
});

test("pickUiSourceDevice: usable full devices, the newest build first, then the closest route", () => {
  const device = (deviceId: string, extra: Partial<ControllerDevice>): ControllerDevice => ({
    ...(STUDIO_MAC as ControllerDevice),
    deviceId,
    ...extra,
  });
  const devices = [
    device("old", { clientVersion: "1.0.9" }),
    device("relayed", { clientVersion: "1.0.12", route: "relayed_server" }),
    device("lan", { clientVersion: "1.0.12", route: "direct_lan" }),
    device("phone", { clientVersion: "9.0.0", connectable: false, unavailable: { code: "controller", message: "" } }),
    device("unknown", { clientVersion: null }),
  ];
  expect(pickUiSourceDevice(devices)?.deviceId).toBe("lan");
  expect(pickUiSourceDevice(devices, new Set(["lan"]))?.deviceId).toBe("relayed");
  expect(pickUiSourceDevice(devices, new Set(["lan", "relayed"]))?.deviceId).toBe("old");
  expect(pickUiSourceDevice(devices, new Set(["lan", "relayed", "old"]))?.deviceId).toBe("unknown");
  expect(pickUiSourceDevice(devices, new Set(["lan", "relayed", "old", "unknown"]))).toBe(null);
  expect(pickUiSourceDevice([device("a", { clientVersion: "1.0.10" }), device("b", { clientVersion: "1.0.9" })])?.deviceId).toBe("a");
  // Backend-ranked `entryCandidates` strictly takes precedence over client-side semver/route sort.
  expect(pickUiSourceDevice(devices, new Set(), ["relayed", "old", "lan"])?.deviceId).toBe("relayed");
  expect(pickUiSourceDevice(devices, new Set(["relayed"]), ["relayed", "old", "lan"])?.deviceId).toBe("old");
});

test("manifest refusals and page launch states map to explicit states", () => {
  expect(uiManifestError(new Error("ui_bundle_unavailable: no web bundle next to this binary")).code).toBe(
    "device_ui_unavailable",
  );
  expect(
    uiManifestError(new Error("forbidden_for_scope: command 'ui_bundle_manifest' is unknown to this OpenBitFun backend version")).code,
  ).toBe("device_ui_unavailable");
  expect(uiManifestError(new Error("The backend is not connected")).code).toBe("unavailable");
  const verification = launchStateOf({ uiError: { reason: "verification", file: "index.html" } });
  expect(verification.failure?.code).toBe("ui_verification_failed");
  expect(verification.failure?.detail).toBe("index.html");
  expect(launchStateOf({ uiError: { reason: "unavailable", file: "a.js" } }).failure?.code).toBe("ui_load_failed");
  expect(launchStateOf({ handoff: { deviceId: "desk-1" }, showDevices: true })).toMatchObject({
    deviceId: "desk-1",
    showDevices: true,
    failure: null,
  });
  expect(launchStateOf(null)).toEqual({ deviceId: null, showDevices: false, failure: null });
});

test("refusal codes and gateway addresses", () => {
  expect(refusalError(4401, "signed_out: sign in").code).toBe("signed_out");
  expect(refusalError(4404, "unreachable: the device is not on the device network").message).toBe(
    "the device is not on the device network",
  );
  expect(refusalError(4426, "unsupported: update it").code).toBe("unsupported");
  expect(refusalError(4429, "busy: retry").code).toBe("unavailable");
  expect(refusalError(1006, "").code).toBe("network");
  expect(resolveControllerUrl("/obp", true, "https://super.openbitfun.com/")).toBe("wss://super.openbitfun.com/obp");
  expect(resolveControllerUrl("/obp/api/v1", false, "https://super.openbitfun.com/")).toBe(
    "https://super.openbitfun.com/obp/api/v1",
  );
});

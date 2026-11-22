// Models of every device (wave 21): on a fleet entry the session model picker
// draws `fleet_models` as the entry projects it (the device that runs the
// session first, one header per device with its state, rows that cannot be
// picked disabled), picking another device's model stores its qualified
// reference, the chip names the model and its device, a session on another
// device asks for the catalog relative to that device, and an entry without
// the command keeps the local list exactly as before.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow, openSession } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const ENTRY = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

function navigator() {
  return {
    revision: 2,
    full: true,
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
    devices: [
      fleetDeviceRow(
        "dev-a",
        "MacBook",
        [{ workspaceId: "workspace-1", name: "openbitfun", rootPath: "/repo", isHostCurrent: true, sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "Fix flaky test")] }],
        { isClientDevice: true },
      ),
      fleetDeviceRow(
        "dev-b",
        "linux-box",
        [{ workspaceId: "workspace-2", name: "infra", rootPath: "/srv/infra", sessions: [fleetSessionRow("dev-b", "workspace-2", "session-5", "Build release")] }],
        { hostKind: "cli" },
      ),
    ],
  };
}

function model(id: string, name: string, ref: string, selectable = true, primary = false) {
  return { modelId: id, displayName: name, provider: "openai", capabilities: ["text_chat"], primary, modelRef: ref, selectable };
}

/** The catalog relative to the entry (dev-a) and to dev-b. */
const CATALOG: Record<string, Record<string, unknown>> = {
  "": {
    revision: 3,
    devices: [
      { deviceId: "dev-a", name: "MacBook", hostKind: "desktop", state: "online", online: true, isThisDevice: true,
        models: [model("cfg-primary", "Primary model", "cfg-primary", true, true), model("cfg-fast", "Fast model", "cfg-fast")] },
      { deviceId: "dev-b", name: "linux-box", hostKind: "cli", state: "online", online: true, isThisDevice: false,
        models: [model("big", "Big model", "fleet:dev-b/big", true, true)] },
      { deviceId: "dev-c", name: "old-laptop", hostKind: "desktop", state: "offline", online: false, isThisDevice: false,
        unavailableReason: "device_offline", models: [model("gone", "Gone model", "fleet:dev-c/gone", false)] },
    ],
  },
  "dev-b": {
    revision: 3,
    devices: [
      { deviceId: "dev-b", name: "linux-box", hostKind: "cli", state: "online", online: true, isThisDevice: true,
        models: [model("big", "Big model", "big", true, true)] },
      { deviceId: "dev-a", name: "MacBook", hostKind: "desktop", state: "online", online: true, isThisDevice: false,
        models: [model("cfg-primary", "Primary model", "fleet:dev-a/cfg-primary", true, true)] },
    ],
  },
};

async function openFleet(fleetModels?: Record<string, Record<string, unknown>>) {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: navigator(), ...(fleetModels ? { fleetModels } : {}) });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-all-sessions");
  return { app, host, backend };
}

function fleetModelsRequests(host: ReturnType<typeof fleetObpHost>) {
  return host.calls
    .filter(call => call.command === "fleet_models")
    .map(call => (call.args.request ?? {}) as { deviceId?: string });
}

test("the picker groups every device's models in the entry's order and stores another device's reference", async () => {
  const { app, host, backend } = await openFleet(CATALOG);
  await openSession(app, "Fix flaky test");
  await app.waitFor("Message");
  await app.press("bot-capsule-trigger");
  await app.waitFor("id:model-device-dev-b");
  // One header per device: this device first, then the others, with their state.
  expect(app.shows("text:MacBook · This device")).toBe(true);
  expect(app.shows("id:model-device-dev-b >> text:linux-box")).toBe(true);
  expect(app.shows("id:model-device-dev-c >> text:Offline")).toBe(true);
  expect(app.shows("id:model-device-dev-c >> text:Gone model · openai")).toBe(true);
  const texts = app.texts();
  expect(texts.indexOf("MacBook · This device")).toBeLessThan(texts.indexOf("linux-box"));
  // The session runs on the entry: the catalog is the entry's own view.
  expect(fleetModelsRequests(host).pop()?.deviceId).toBeUndefined();

  // A model of an offline device cannot be picked.
  const refused = await app.press("label:model-option-fleet:dev-c/gone").then(
    () => "",
    (error: unknown) => String(error),
  );
  expect(refused).toContain("is disabled");
  expect(host.fleetCalls.some(call => call.command === "update_session_model")).toBe(false);

  await app.press("label:model-option-fleet:dev-b/big");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "update_session_model"));
  const update = host.fleetCalls.filter(call => call.command === "update_session_model").pop()!;
  expect(update.target).toBe("dev-a");
  expect((update.args.request as { modelName?: string }).modelName).toBe("fleet:dev-b/big");
  // The chip names the model and the device it lives on.
  await app.waitFor("label:bot-capsule-trigger >> text:Big model · linux-box");
});

test("a session on another device reads the catalog relative to that device", async () => {
  const { app, host } = await openFleet(CATALOG);
  await openSession(app, "Build release");
  await app.waitFor("Message");
  await app.press("bot-capsule-trigger");
  await app.waitFor("text:linux-box · This device");
  expect(fleetModelsRequests(host).some(request => request.deviceId === "dev-b")).toBe(true);
  expect(app.shows("id:model-device-dev-a >> text:MacBook")).toBe(true);
});

test("an entry without fleet_models keeps the local model list", async () => {
  const { app } = await openFleet();
  await openSession(app, "Fix flaky test");
  await app.waitFor("Message");
  await app.press("bot-capsule-trigger");
  await app.waitFor("Fast model · openai");
  expect(app.shows("text:Primary model · openai")).toBe(true);
  expect(app.shows("text:MacBook · This device")).toBe(false);
});

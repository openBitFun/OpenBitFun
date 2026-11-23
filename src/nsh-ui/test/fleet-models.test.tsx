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
  await app.waitFor("nav-library");
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
  // A host from before the label rule: its name, then its provider, in the secondary style.
  expect(app.shows("id:model-device-dev-c >> text:Gone model")).toBe(true);
  expect(app.shows("id:model-device-dev-c >> text:openai")).toBe(true);
  const texts = app.texts();
  // The picker draws after the sidebar, which may list the same device names.
  expect(texts.indexOf("MacBook · This device")).toBeLessThan(texts.lastIndexOf("linux-box"));
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
  await app.waitFor("Fast model");
  expect(app.shows("text:Primary model")).toBe(true);
  expect(app.shows("text:openai")).toBe(true);
  expect(app.shows("text:MacBook · This device")).toBe(false);
});

test("rows show the host's label and provider, and two models that read the same stay distinguishable", async () => {
  // Two models of one provider share a name (the 2.0 report: "OpenAI, OpenAI, ...");
  // the host labels them by model and numbers the twins.
  const labelled = (id: string, label: string, detail: string, ref: string, primary = false) => ({
    ...model(id, "OpenAI", ref, true, primary),
    modelName: label,
    label,
    detail,
  });
  const catalog = {
    "": {
      revision: 4,
      devices: [
        { deviceId: "dev-a", name: "MacBook", hostKind: "desktop", state: "online", online: true, isThisDevice: true,
          models: [
            labelled("m1", "gpt-5", "OpenAI #1", "m1", true),
            labelled("m2", "gpt-5", "OpenAI #2", "m2"),
            labelled("m3", "gemini-2.5-pro", "Google Gemini", "m3"),
          ] },
        { deviceId: "dev-b", name: "linux-box", hostKind: "cli", state: "online", online: true, isThisDevice: false,
          models: [labelled("big", "glm-4.6", "OpenBitFun", "fleet:dev-b/big", true)] },
      ],
    },
  };
  const { app, host } = await openFleet(catalog);
  await openSession(app, "Fix flaky test");
  await app.waitFor("Message");
  await app.press("bot-capsule-trigger");
  await app.waitFor("id:model-device-dev-b");
  expect(app.shows("label:model-option-m1 >> text:gpt-5")).toBe(true);
  expect(app.shows("label:model-option-m1 >> text:OpenAI #1")).toBe(true);
  expect(app.shows("label:model-option-m2 >> text:OpenAI #2")).toBe(true);
  expect(app.shows("label:model-option-m3 >> text:gemini-2.5-pro")).toBe(true);
  expect(app.shows("label:model-option-m3 >> text:Google Gemini")).toBe(true);
  // The config name the host replaced is not what the row leads with.
  expect(app.shows("label:model-option-m1 >> text:OpenAI")).toBe(false);
  await app.press("label:model-option-fleet:dev-b/big");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "update_session_model"));
  // The chip names the model and its device.
  await app.waitFor("label:bot-capsule-trigger >> text:glm-4.6 · linux-box");
});

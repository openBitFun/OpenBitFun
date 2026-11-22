// The device page (visual spec §4.7): what the device is, how it is reached,
// what it can do, and its own actions. A healthy device draws no status;
// offline, stale, unreachable and outdated replace the subtitle in words. The
// ⋯ menu renames, copies the id and removes the device (with a confirmation
// named by its verb).

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, showAllSessions, showDevices } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const ENTRY = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

function navigator() {
  return {
    revision: 2,
    full: true,
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
    devices: [
      fleetDeviceRow("dev-a", "MacBook", [
        { workspaceId: "workspace-1", name: "openbitfun", rootPath: "/repo", isHostCurrent: true, sessions: [] },
      ], { isClientDevice: true }),
      fleetDeviceRow("dev-b", "linux-box", [
        { workspaceId: "workspace-2", name: "openbitfun", rootPath: "/srv/openbitfun", sessions: [] },
        { workspaceId: "workspace-3", name: "infra", rootPath: "/srv/infra", sessions: [] },
      ], {
        hostKind: "cli",
        version: "1.3.0",
        route: { kind: "direct_ipv4", latencyMs: 18 },
        hostCapabilities: ["fleet_v1", "terminal", "git", "browser_control"],
      }),
      fleetDeviceRow("dev-c", "old-laptop", [], { state: "offline", asOfMs: Date.now() - 3 * 3600_000 }),
      fleetDeviceRow("dev-d", "win-pc", [], { state: "update_required", stateReason: "Needs OpenBitFun 1.3 or later" }),
      fleetDeviceRow("dev-e", "nas", [], { state: "unreachable" }),
    ],
  };
}

async function openDevice(deviceId: string) {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: navigator() });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  if (deviceId === "dev-c") await app.press("all-sessions-offline-group").catch(() => undefined);
  await app.press(`device-open-${deviceId}`);
  await app.waitFor("device-scene");
  return { app, host, backend };
}

test("a healthy device states what it is, its route and what it can do, and nothing else", async () => {
  const { app } = await openDevice("dev-b");
  await app.waitFor("text:linux-box");
  expect(app.shows("text:Server · OpenBitFun 1.3.0")).toBe(true);
  expect(app.shows("text:Connected directly · 18 ms")).toBe(true);
  expect(app.shows("text:openbitfun · infra")).toBe(true);
  expect(app.shows("text:Terminal · Git · Browser control")).toBe(true);
  expect(app.shows("text:Settings for linux-box")).toBe(true);
  // No raw id, no online dot, no route jargon.
  expect(app.shows("text:dev-b")).toBe(false);
  expect(app.shows("text:Online")).toBe(false);
});

test("offline, unreachable and outdated devices say so in words instead of the subtitle", async () => {
  const offline = await openDevice("dev-c");
  await offline.app.waitFor("text:old-laptop");
  expect(offline.app.texts().some(text => text.startsWith("Offline · last seen"))).toBe(true);
  expect(offline.app.shows("text:Connected directly · 18 ms")).toBe(false);

  const unreachable = await openDevice("dev-e");
  await unreachable.app.waitFor("text:Can't reach this device");

  const outdated = await openDevice("dev-d");
  await outdated.app.waitFor("text:Needs OpenBitFun 1.3 or later");
});

test("Settings for a device opens Settings on that device", async () => {
  const { app, host } = await openDevice("dev-b");
  await app.press("device-settings");
  await app.waitUntil(() => host.fleetCalls.some(call => call.target === "dev-b"));
});

test("the ⋯ menu removes a device only after a confirmation named by its verb", async () => {
  const { app, backend } = await openDevice("dev-b");
  await app.press("device-menu");
  await app.press("device-menu-remove");
  await app.waitFor("text:Remove linux-box from your account?");
  expect(app.shows("text:It stops appearing on your other devices. Its sessions and files stay on it.")).toBe(true);
  expect(backend.actions()).not.toContain("account_delete_device");
  await app.press("device-remove-confirm");
  await app.waitUntil(() => backend.actions().includes("account_delete_device"));
});

// ── P-UI (wave 17): jobs sent from this device (the direct Detached Dispatch path) ──

async function openThisDevice(options: Parameters<typeof createBackend>[0] = {}) {
  const backend = createBackend(options);
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showDevices(app);
  const header = app.shows("device-open-local") ? "device-open-local" : "device-open-device-mac";
  await app.press(header);
  await app.waitFor("device-scene");
  return { app, backend };
}

test("this computer's page sends a job: the target is checked before Send, and the job options go out", async () => {
  const { app, backend } = await openThisDevice();
  await app.waitFor("text:Jobs sent from this device");
  await app.press("device-jobs");
  await app.waitFor("dispatch-form-toggle");
  await app.press("dispatch-form-toggle");
  await app.waitFor("text:Send a job");
  await app.waitFor("text:Ready");
  const probe = backend.calls.find(c => c.action === "dispatch_probe_target");
  expect(probe?.raw).toBe(false);
  expect(probe?.request).toMatchObject({ target: { kind: "ssh", connectionId: "conn-1", workspacePath: "" } });

  // A server without the CLI keeps Send off and says why.
  await app.press("dispatch-target-select");
  await app.press("label:dispatch-target-ssh:conn-2");
  await app.waitFor("The OpenBitFun CLI is not installed on that device.");
  expect(app.enabled("dispatch-submit")).toBe(false);

  await app.press("dispatch-target-select");
  await app.press("label:dispatch-target-ssh:conn-1");
  await app.waitFor("text:Ready");
  expect(app.enabled("dispatch-submit")).toBe(true);

  await app.type("dispatch-workspace", "/srv/api");
  await app.type("dispatch-prompt", "Bump the toolchain");
  await app.type("dispatch-title", "Toolchain bump");
  await app.clear("dispatch-base-ref");
  await app.type("dispatch-base-ref", "release/1.2");
  await app.press("dispatch-model-select");
  await app.press("dispatch-model-gpt-5-mini");
  await app.press("dispatch-include-uncommitted");
  await app.press("dispatch-submit");
  await app.waitUntil(() => backend.submittedDispatch() !== null);
  expect(backend.submittedDispatch()).toMatchObject({
    target: { kind: "ssh", connectionId: "conn-1", workspacePath: "/srv/api" },
    prompt: "Bump the toolchain",
    title: "Toolchain bump",
    baseRef: "release/1.2",
    model: "gpt-5-mini",
    includeUncommitted: true,
  });
  // The copy never names the mechanism.
  expect(app.texts().some(text => /dispatch|detached/i.test(text))).toBe(false);
});

test("a running job lists with its state and stops from its row", async () => {
  const { app, backend } = await openThisDevice({
    dispatchJob: {
      jobId: "job-7",
      sessionId: "session-7",
      promptPreview: "Run the nightly suite",
      title: "Nightly suite",
      state: "running",
      workspacePath: "/srv/api",
      target: { kind: "ssh", connectionId: "conn-1", displayName: "build-box" },
    },
  });
  await app.press("device-jobs");
  await app.waitFor("text:Nightly suite");
  expect(app.shows("text:build-box · Working")).toBe(true);
  await app.press("dispatch-cancel-job-7");
  await app.waitUntil(() => backend.cancelledJobs.includes("job-7"));
});

test("another device's page has no jobs row; only the computer this UI runs on sends them", async () => {
  const { app } = await openDevice("dev-b");
  await app.waitFor("text:linux-box");
  expect(app.shows("device-jobs")).toBe(false);
});

// ── P-UI (wave 17): the served device detail (`fleet_device_detail`) ──

test("a served device detail says what runs and waits there in words, and the capabilities it lists", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: ENTRY,
    navigator: navigator(),
    deviceDetails: {
      "dev-b": {
        revision: 2,
        device: navigator().devices[1],
        runningSessions: 2,
        runningJobs: 1,
        waitingJobs: 1,
        running: { sessions: [], jobs: [] },
        waiting: { jobs: [{ deviceId: "dev-b", title: "Test release", state: "queued", stateReason: "waiting_for_device" }] },
        capabilities: ["terminal", "git"],
      },
    },
  });
  const app = await open("./fixtures/obpAppSuperAgent.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.press("device-open-dev-b");
  await app.waitFor("device-waiting");
  expect(host.calls.find(call => call.command === "fleet_device_detail")?.args).toMatchObject({ request: { deviceId: "dev-b" } });
  expect(app.shows("text:2 sessions · 1 jobs from Super Agent")).toBe(true);
  expect(app.shows("text:1 job · Starts when it's online")).toBe(true);
  // The served capability ids win over the navigator's host capabilities.
  expect(app.shows("text:Terminal · Git")).toBe(true);
  expect(app.shows("text:waiting_for_device")).toBe(false);
});

test("with Super Agent gated off, the device page counts its sessions and names no jobs from it", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: ENTRY,
    navigator: navigator(),
    deviceDetails: {
      "dev-b": {
        revision: 2,
        device: navigator().devices[1],
        runningSessions: 2,
        runningJobs: 1,
        waitingJobs: 1,
        running: { sessions: [], jobs: [] },
        waiting: { jobs: [{ deviceId: "dev-b", title: "Test release", state: "queued", stateReason: "waiting_for_device" }] },
        capabilities: ["terminal", "git"],
      },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.press("device-open-dev-b");
  await app.waitFor("text:2 sessions");
  expect(app.shows("device-waiting")).toBe(false);
  expect(app.texts().some(text => text.includes("Super Agent"))).toBe(false);
  expect(app.shows("text:Terminal · Git")).toBe(true);
});

test("an entry older than the device detail keeps the navigator's facts and draws no running counts", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: navigator(), deviceDetails: false });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.press("device-open-dev-b");
  await app.waitFor("text:Terminal · Git · Browser control");
  expect(app.shows("text:Running now")).toBe(false);
});

test("Rename sets the account alias of the device and reads the navigator again", async () => {
  const { app, backend, host } = await openDevice("dev-b");
  const reads = () => host.calls.filter(call => call.command === "fleet_navigator").length;
  const before = reads();
  await app.press("device-menu");
  await app.press("device-menu-rename");
  await app.waitFor("device-rename-field");
  await app.clear("device-rename-field");
  await app.type("device-rename-field", "gpu-box");
  await app.press("device-rename-save");
  await app.waitUntil(() => backend.calls.some(call => call.action === "account_update_device_alias"));
  expect(backend.calls.find(call => call.action === "account_update_device_alias")?.request).toMatchObject({
    device_id: "dev-b",
    device_alias: "gpu-box",
  });
  await app.waitUntil(() => reads() > before);
});

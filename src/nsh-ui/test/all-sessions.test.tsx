// All sessions (visual spec §4.6, ux-redesign §3.6): Recent is a flat list in
// the backend's order, By device is the fleet tree with the backend's folding
// and roll-up hints, offline devices the backend lists last fold into one
// group, a filter field appears above 8 devices, and "New session here" starts
// a session in the workspace it was pressed on. The shell around it: the
// sidebar holds no sessions, and the old `devices` scene id opens By device.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow, showAllSessions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const ENTRY = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

function navigator(extraDevices: Array<Record<string, unknown>> = []) {
  return {
    revision: 2,
    full: true,
    removedDeviceIds: [],
    totals: { running: 1, waiting: 1, unread: 0 },
    devices: [
      fleetDeviceRow("dev-a", "MacBook", [
        {
          workspaceId: "workspace-1",
          name: "openbitfun",
          rootPath: "/repo",
          isHostCurrent: true,
          sessions: [
            { ...fleetSessionRow("dev-a", "workspace-1", "session-1", "Fix flaky test"), status: "running" },
            fleetSessionRow("dev-a", "workspace-1", "session-2", "Docs pass"),
            fleetSessionRow("dev-a", "workspace-1", "session-3", "Port the terminal"),
            fleetSessionRow("dev-a", "workspace-1", "session-4", "Bump deps"),
          ],
        },
      ], { isClientDevice: true }),
      fleetDeviceRow("dev-b", "linux-box", [
        {
          workspaceId: "workspace-2",
          name: "infra",
          rootPath: "/srv/infra",
          sessions: [{ ...fleetSessionRow("dev-b", "workspace-2", "session-5", "Build release"), needsAttention: true, status: "waiting" }],
        },
      ], { hostKind: "cli", ui: { rollup: "needs_you" } }),
      fleetDeviceRow("dev-c", "win-pc", [], { state: "update_required" }),
      ...extraDevices,
      fleetDeviceRow("dev-d", "old-laptop", [], { state: "offline" }),
      fleetDeviceRow("dev-e", "nas", [], { state: "offline", hostKind: "cli" }),
    ],
  };
}

async function openFleet(nav = navigator()) {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: nav });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-all-sessions");
  return { app, host };
}

test("the sidebar holds conversations; sessions are one press away in All sessions › Recent, in the backend's order", async () => {
  const { app, host } = await openFleet();
  // No session rows in the shell before All sessions opens.
  expect(app.shows("text:Fix flaky test")).toBe(false);
  await showAllSessions(app, "Fix flaky test");
  const order = ["Fix flaky test", "Docs pass", "Port the terminal", "Bump deps", "Build release"];
  const texts = app.texts();
  const positions = order.map(title => texts.indexOf(title));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  // Each row names its device as a quiet badge.
  expect(app.shows("text:linux-box")).toBe(true);

  // Pressing a row of another device opens that session there.
  await app.press("Build release");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.target === "dev-b" && call.command === "get_session_transcript_view"),
  );
});

test("By device follows the backend's folding and roll-up and states exceptions in words", async () => {
  const { app } = await openFleet();
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.waitFor("device-header-dev-a");
  // This device is unfolded and says so; its workspace previews three sessions and the rest.
  expect(app.shows("text:This device")).toBe(true);
  await app.waitFor("text:Fix flaky test · Docs pass · Port the terminal · 1 more");
  // Other devices stay folded: a roll-up mark, or the exception words.
  expect(app.shows("label:Needs you")).toBe(true);
  expect(app.shows("text:Update needed")).toBe(true);
  expect(app.shows("text:Build release")).toBe(false);
  // Offline devices the backend lists last fold into one group.
  expect(app.shows("text:Offline (2)")).toBe(true);
  expect(app.shows("text:old-laptop")).toBe(false);
  await app.press("all-sessions-offline-group");
  await app.waitFor("text:old-laptop");

  // Unfolding a device and a workspace shows its sessions.
  await app.press("device-fold-dev-b");
  await app.press("workspace-row-workspace-2");
  await app.waitFor("text:Build release");
});

test("above 8 devices a filter field narrows the device list", async () => {
  const extra = Array.from({ length: 6 }, (_, index) => fleetDeviceRow(`dev-x${index}`, `builder-${index}`, []));
  const { app } = await openFleet(navigator(extra));
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.waitFor("all-sessions-device-filter");
  expect(app.shows("text:builder-3")).toBe(true);
  await app.type("all-sessions-device-filter", "linux");
  await app.waitUntil(() => !app.shows("text:builder-3"));
  expect(app.shows("text:linux-box")).toBe(true);
});

test("New session here starts the session on the workspace's own device", async () => {
  const { app, host } = await openFleet();
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.press("device-fold-dev-b");
  await app.waitFor("workspace-row-workspace-2");
  await app.hover("workspace-row-workspace-2");
  await app.press("new-session-here-workspace-2");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "create_session"));
  const created = host.fleetCalls.find(call => call.command === "create_session");
  expect(created?.target).toBe("dev-b");
  expect((created?.args.request as Record<string, unknown>).workspaceId).toBe("workspace-2");
});

test("a device header in By device opens the device page", async () => {
  const { app } = await openFleet();
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.press("device-open-dev-b");
  await app.waitFor("device-scene");
  await app.waitFor("text:linux-box");
});

test("an older entry without the fleet layer lists this device's sessions under This device", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: null });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app, "NSH skeleton");
  expect(host.fleetCalls.length).toBe(0);
  await app.press("all-sessions-tab-by-device");
  await app.waitFor("device-header-local");
  expect(app.shows("text:This device")).toBe(true);
});

// ── P-UI (wave 17): the served Recent list (`fleet_recent_sessions`) ──

test("Recent draws the entry's served list in its order with the labels it projected; an older entry falls back to the navigator", async () => {
  const backend = createBackend();
  const served = {
    revision: 2,
    truncated: false,
    sessions: [
      { ...fleetSessionRow("dev-b", "workspace-2", "session-5", "Build release"), deviceName: "linux-box", hostKind: "cli", workspaceName: "infra", isClientDevice: false, deviceState: "online" },
      { ...fleetSessionRow("dev-a", "workspace-1", "session-2", "Docs pass"), deviceName: "MacBook", hostKind: "desktop", workspaceName: "openbitfun", isClientDevice: true, deviceState: "online" },
    ],
  };
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: navigator(), recentSessions: served });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-all-sessions");
  await showAllSessions(app, "Build release");
  expect(host.calls.some(call => call.command === "fleet_recent_sessions")).toBe(true);
  const texts = app.texts();
  // Exactly the served rows, in the served order (the navigator's other sessions are not merged in).
  expect(texts.indexOf("Build release")).toBeLessThan(texts.indexOf("Docs pass"));
  expect(app.shows("text:Fix flaky test")).toBe(false);
  expect(app.shows("text:· infra")).toBe(true);

  const older = fleetObpHost(createBackend(), { fleet: ENTRY, navigator: navigator(), recentSessions: false });
  const oldApp = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: older.handlers } });
  await oldApp.waitFor("nav-all-sessions");
  await showAllSessions(oldApp, "Fix flaky test");
  expect(oldApp.shows("text:Build release")).toBe(true);
});

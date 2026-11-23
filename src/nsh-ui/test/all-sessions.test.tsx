// All sessions (visual spec §4.6, ux-redesign §3.6): Recent is a flat list in
// the backend's order, By device is the fleet tree with the backend's folding
// and roll-up hints, offline devices the backend lists last fold into one
// group, a filter field appears above 8 devices, and "New session here" starts
// a session in the workspace it was pressed on. The shell around it: the
// sidebar holds the same device → workspace → session tree (wave 23), and the
// old `devices` scene id opens By device. Assertions about the page are scoped
// to it, since the sidebar shows the same titles.

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

/** The texts of the All sessions page (after its Recent | By device tabs), in order. */
function sceneTexts(app: { texts(): string[] }): string[] {
  const texts = app.texts();
  return texts.slice(texts.lastIndexOf("By device") + 1);
}

async function openFleet(nav = navigator()) {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: nav });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-library");
  return { app, host };
}

test("the sidebar lists every device's sessions; All sessions › Recent lists them flat in the backend's order", async () => {
  const { app, host } = await openFleet();
  // The sidebar's tree: each device, its workspace, its sessions.
  await app.waitFor("id:sidebar-session-session-1");
  expect(app.shows("id:sidebar-device-row-dev-b")).toBe(true);
  expect(app.shows("id:sidebar-session-session-5")).toBe(true);
  await showAllSessions(app, "Fix flaky test");
  const order = ["Fix flaky test", "Docs pass", "Port the terminal", "Bump deps", "Build release"];
  const texts = sceneTexts(app);
  const positions = order.map(title => texts.indexOf(title));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  // Each row names its device as a quiet badge.
  expect(app.shows("text:linux-box")).toBe(true);

  // Pressing a row of another device opens that session there.
  await app.press("label:all-sessions-scene >> text:Build release");
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
  expect(app.shows("label:all-sessions-by-device >> text:Build release")).toBe(false);
  // Offline devices the backend lists last fold into one group.
  expect(app.shows("text:Offline (2)")).toBe(true);
  expect(app.shows("label:all-sessions-by-device >> text:old-laptop")).toBe(false);
  await app.press("all-sessions-offline-group");
  await app.waitFor("label:all-sessions-by-device >> text:old-laptop");

  // Unfolding a device and a workspace shows its sessions.
  await app.press("device-fold-dev-b");
  await app.press("workspace-row-workspace-2");
  await app.waitFor("label:all-sessions-by-device >> text:Build release");
});

test("above 8 devices a filter field narrows the device list", async () => {
  const extra = Array.from({ length: 6 }, (_, index) => fleetDeviceRow(`dev-x${index}`, `builder-${index}`, []));
  const { app } = await openFleet(navigator(extra));
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.waitFor("all-sessions-device-filter");
  expect(app.shows("label:all-sessions-by-device >> text:builder-3")).toBe(true);
  await app.type("all-sessions-device-filter", "linux");
  await app.waitUntil(() => !app.shows("label:all-sessions-by-device >> text:builder-3"));
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
  await app.waitFor("nav-library");
  await showAllSessions(app, "Build release");
  expect(host.calls.some(call => call.command === "fleet_recent_sessions")).toBe(true);
  const texts = sceneTexts(app);
  // Exactly the served rows, in the served order (the navigator's other sessions are not merged in).
  expect(texts.indexOf("Build release")).toBeLessThan(texts.indexOf("Docs pass"));
  expect(app.shows("label:all-sessions-scene >> text:Fix flaky test")).toBe(false);
  expect(app.shows("text:· infra")).toBe(true);

  const older = fleetObpHost(createBackend(), { fleet: ENTRY, navigator: navigator(), recentSessions: false });
  const oldApp = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: older.handlers } });
  await oldApp.waitFor("nav-library");
  await showAllSessions(oldApp, "Fix flaky test");
  expect(oldApp.shows("text:Build release")).toBe(true);
});

test("remote workspaces display their SSH host in the sidebar and By device, while local and assistant workspaces never show localhost", async () => {
  const nav = {
    revision: 3,
    full: true,
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
    devices: [
      fleetDeviceRow(
        "dev-a",
        "MacBook",
        [
          {
            workspaceId: "ws-local",
            name: "OpenBitFun",
            rootPath: "/Users/me/OpenBitFun",
            kind: "local",
            sshHost: "localhost",
            isHostCurrent: true,
            sessions: [fleetSessionRow("dev-a", "ws-local", "s-local-1", "Local thread")],
          },
          {
            workspaceId: "ws-remote",
            name: "OpenBitFun",
            rootPath: "/home/dev/OpenBitFun",
            kind: "remote_ssh",
            sshHost: "lwb",
            sessions: [fleetSessionRow("dev-a", "ws-remote", "s-remote-1", "Remote thread")],
          },
          {
            workspaceId: "ws-assistant",
            name: "Companion",
            rootPath: "/Users/me/.openbitfun/assistant",
            kind: "assistant",
            sshHost: "lwb",
            sessions: [],
          },
        ],
        { isClientDevice: true },
      ),
    ],
  };
  const { app } = await openFleet(nav);
  // Sidebar displays the remote SSH host beside the remote workspace name, and never localhost or assistant host.
  await app.waitFor("id:sidebar-workspace-host-ws-remote");
  expect(app.shows("id:sidebar-workspace-row-ws-remote >> text:· lwb")).toBe(true);
  expect(app.shows("id:sidebar-workspace-host-ws-local")).toBe(false);
  expect(app.shows("id:sidebar-workspace-host-ws-assistant")).toBe(false);
  expect(app.texts().some(text => text.includes("localhost"))).toBe(false);
  // Sessions under both local and remote workspaces render and open.
  expect(app.shows("id:sidebar-session-s-local-1")).toBe(true);
  expect(app.shows("id:sidebar-session-s-remote-1")).toBe(true);

  // All sessions › By device displays the same remote SSH host consistently.
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.waitFor("id:workspace-host-ws-remote");
  expect(app.shows("label:workspace-row-ws-remote >> text:· lwb")).toBe(true);
  expect(app.shows("id:workspace-host-ws-local")).toBe(false);
  expect(app.shows("id:workspace-host-ws-assistant")).toBe(false);
});

test("without the fleet layer, local fallback shows remote workspace SSH host and suppresses localhost", async () => {
  const backend = createBackend({
    openedWorkspaces: [
      { id: "ws-local", name: "OpenBitFun", rootPath: "/Users/me/OpenBitFun", workspaceKind: "normal", sshHost: "localhost" },
      { id: "ws-remote", name: "repos", rootPath: "/srv/repos", workspaceKind: "remote", sshHost: "lwb" },
    ],
  });
  const host = fleetObpHost(backend, { fleet: null });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("id:sidebar-workspace-host-ws-remote");
  expect(app.shows("id:sidebar-workspace-row-ws-remote >> text:· lwb")).toBe(true);
  expect(app.shows("id:sidebar-workspace-host-ws-local")).toBe(false);
  expect(app.texts().some(text => text.includes("localhost"))).toBe(false);
});

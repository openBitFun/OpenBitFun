// The session tree (the sidebar on a wide window, the Sessions tab on a phone):
// every runtime device of the account → its workspaces → their sessions, with
// the backend's folding and roll-up, exceptions in words, a "Show more" that
// pages further sessions in from the owning device, and each device's own
// actions on its ⋯ (new workspace, terminal, SSH, settings, jobs sent from this
// computer, rename, copy id, remove). The All sessions and device pages are
// retired: what they offered lives here.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow, showDevices } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "ios" as const };
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
      fleetDeviceRow("dev-c", "win-pc", [], { state: "update_required", stateReason: "Needs OpenBitFun 1.3 or later" }),
      ...extraDevices,
      fleetDeviceRow("dev-d", "old-laptop", [], { state: "offline" }),
    ],
  };
}

async function openFleet(nav = navigator(), viewport: Record<string, unknown> = DESKTOP) {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: ENTRY, navigator: nav });
  const app = await open("./fixtures/obpApp.tsx", { ...viewport, host: { handlers: host.handlers } });
  await showDevices(app);
  return { app, host, backend };
}

async function deviceMenu(app: Awaited<ReturnType<typeof open>>, deviceId: string) {
  await app.hover(`id:sidebar-device-row-${deviceId}`);
  await app.press(`sidebar-device-actions-${deviceId}`);
}

test("the sidebar lists every device with its workspaces and sessions at once", async () => {
  const { app, host } = await openFleet();
  // This device is unfolded; another healthy device is too, with its sessions.
  await app.waitFor("id:sidebar-session-session-1");
  expect(app.shows("id:sidebar-session-session-5")).toBe(true);
  expect(app.shows("text:This device")).toBe(true);
  // A device that cannot answer folds and says why in words.
  expect(app.shows("text:Update needed")).toBe(true);
  expect(app.shows("id:sidebar-device-row-dev-d")).toBe(true);

  // Pressing a row of another device opens that session there.
  await app.press("id:sidebar-session-session-5");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.target === "dev-b" && call.command === "get_session_transcript_view"),
  );
});

test("New session on a workspace starts it on the workspace's own device", async () => {
  const { app, host } = await openFleet();
  await app.waitFor("id:sidebar-workspace-row-workspace-2");
  await app.hover("id:sidebar-workspace-row-workspace-2");
  await app.press("sidebar-new-session-workspace-2");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "create_session"));
  const created = host.fleetCalls.find(call => call.command === "create_session");
  expect(created?.target).toBe("dev-b");
  expect((created?.args.request as Record<string, unknown>).workspaceId).toBe("workspace-2");
});

test("Show more reveals the sessions already listed, then pages the rest in from the owning device", async () => {
  const listed = Array.from({ length: 6 }, (_, idx) => fleetSessionRow("dev-a", "ws-many", `s-${idx + 1}`, `Thread ${idx + 1}`));
  const nav = {
    revision: 4,
    full: true,
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
    devices: [
      fleetDeviceRow("dev-a", "mac-work", [
        { workspaceId: "ws-many", name: "OpenBitFun", rootPath: "/Users/me/OpenBitFun", isHostCurrent: true, sessions: listed, sessionTotal: 12 },
      ], { isClientDevice: true }),
    ],
  };
  const { app, host } = await openFleet(nav);
  await app.waitFor("id:sidebar-session-s-3");
  expect(app.shows("id:sidebar-session-s-4")).toBe(false);
  await app.waitFor("label:sidebar-show-more-ws-many >> text:Show more");

  // The first press shows what the navigator already listed, then asks the device for a page.
  await app.press("label:sidebar-show-more-ws-many");
  await app.waitFor("id:sidebar-session-s-6");
  await app.press("label:sidebar-show-more-ws-many");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.target === "dev-a" && call.command === "list_persisted_sessions_page"),
  );

  // Folding the workspace resets it to its first three.
  await app.press("label:sidebar-workspace-toggle-ws-many");
  await app.waitUntil(() => !app.shows("id:sidebar-session-s-1"));
  await app.press("label:sidebar-workspace-toggle-ws-many");
  await app.waitFor("id:sidebar-session-s-3");
  expect(app.shows("id:sidebar-session-s-4")).toBe(false);
});

test("a session's device badge unfolds that device in the sidebar", async () => {
  const { app } = await openFleet();
  await app.press("id:sidebar-session-session-5");
  await app.waitFor("id:session-breadcrumb-device");
  // Fold linux-box, then ask for it from the session's header.
  await app.press("label:sidebar-device-toggle-dev-b");
  await app.waitUntil(() => app.accessibility("label:sidebar-device-toggle-dev-b")?.expanded === false);
  await app.press("id:session-breadcrumb-device");
  await app.waitUntil(() => app.accessibility("label:sidebar-device-toggle-dev-b")?.expanded === true);
});

test("a device's ⋯ opens Settings on that device", async () => {
  const { app, host } = await openFleet();
  await deviceMenu(app, "dev-b");
  await app.press("device-settings-dev-b");
  await app.waitUntil(() => host.fleetCalls.some(call => call.target === "dev-b"));
  await app.waitFor("text:Preferences");
});

test("a device's ⋯ removes it only after a confirmation", async () => {
  const { app, backend } = await openFleet();
  await deviceMenu(app, "dev-b");
  await app.press("device-menu-remove-dev-b");
  await app.waitFor("device-remove-confirm-dev-b");
  expect(backend.actions()).not.toContain("account_delete_device");
  await app.press("device-remove-confirm-dev-b");
  await app.waitUntil(() => backend.actions().includes("account_delete_device"));
});

test("Rename sets the account alias of the device", async () => {
  const { app, backend } = await openFleet();
  await deviceMenu(app, "dev-b");
  await app.press("device-menu-rename-dev-b");
  await app.waitFor("device-rename-field");
  await app.clear("device-rename-field");
  await app.type("device-rename-field", "gpu-box");
  await app.press("device-rename-save");
  await app.waitUntil(() => backend.calls.some(call => call.action === "account_update_device_alias"));
  expect(backend.calls.find(call => call.action === "account_update_device_alias")?.request).toMatchObject({
    device_id: "dev-b",
    device_alias: "gpu-box",
  });
});

test("an outdated device's ⋯ says what it needs", async () => {
  const { app } = await openFleet();
  await deviceMenu(app, "dev-c");
  await app.press("device-update-dev-c");
  await app.waitFor("device-update-dialog");
  await app.waitFor("text:Needs OpenBitFun 1.3 or later");
});

test("only this computer's ⋯ lists the jobs it sent; another device's does not", async () => {
  const backend = createBackend({
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
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showDevices(app);
  await app.press("sidebar-device-actions-local");
  await app.press("device-jobs-local");
  await app.waitFor("device-jobs-sheet");
  await app.waitFor("text:Nightly suite");
  expect(app.shows("text:build-box · Working")).toBe(true);
  await app.press("dispatch-cancel-job-7");
  await app.waitUntil(() => backend.cancelledJobs.includes("job-7"));
  // The copy never names the mechanism.
  expect(app.texts().some(text => /dispatch|detached/i.test(text))).toBe(false);

  const { app: fleet } = await openFleet();
  await deviceMenu(fleet, "dev-b");
  expect(fleet.shows("device-jobs-dev-b")).toBe(false);
});

test("without the fleet layer the tree lists this machine's workspaces under one header", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: null });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showDevices(app);
  await app.waitFor("label:sidebar-device-tree >> NSH skeleton");
  expect(host.fleetCalls.length).toBe(0);
  expect(app.shows("text:Workspaces")).toBe(true);
  expect(app.shows("sidebar-new-workspace")).toBe(true);
});

test("a phone's Sessions tab is the same tree with touch-sized rows and its actions shown", async () => {
  const { app } = await openFleet(navigator(), PHONE);
  await app.waitFor("label:session-list-scene");
  await app.waitFor("id:sidebar-session-session-1");
  // No hover on a phone: the row actions are drawn already.
  expect(app.shows("sidebar-device-actions-dev-b")).toBe(true);
  expect(app.shows("sidebar-new-session-workspace-1")).toBe(true);
  const row = app.layout("id:sidebar-device-row-dev-b");
  expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
});

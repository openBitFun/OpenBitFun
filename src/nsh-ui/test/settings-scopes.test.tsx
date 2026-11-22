// Settings scopes (visual spec §4.9): a left list of Preferences, Account and
// Device (with the device scope chip), pages 680 wide with a 22/600 title,
// "Synced with your account" on Preferences pages only, Account › OpenBitFun
// over the cloud agent's commands, the OpenBitFun device switches on
// Permissions, Account › Activity and the phone push layout.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "ios" as const };
const HARNESS = "./fixtures/settingsApp.tsx";

function fleetNavigator() {
  return {
    revision: 2,
    full: true,
    devices: [
      fleetDeviceRow("cloud-1", "OpenBitFun", [], { hostKind: "cloud" }),
      fleetDeviceRow(
        "dev-a",
        "MacBook",
        [
          {
            workspaceId: "workspace-1",
            name: "OpenBitFun",
            rootPath: "/repo",
            isHostCurrent: true,
            sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
          },
        ],
        { isClientDevice: true },
      ),
      fleetDeviceRow(
        "dev-b",
        "linux-box",
        [{ workspaceId: "workspace-2", name: "infra", rootPath: "/srv/infra", isHostCurrent: true, sessions: [] }],
        { hostKind: "cli" },
      ),
      fleetDeviceRow("dev-c", "win-pc", [], { state: "offline" }),
    ],
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
  };
}

interface SettingsOptions {
  /** The cloud agent's `superagent_status`; `null` makes it a node without the commands. */
  superagent?: Record<string, unknown> | null;
}

async function openSettings(options: SettingsOptions = {}, size: typeof DESKTOP | typeof PHONE = DESKTOP) {
  const backend = createBackend();
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  let status = options.superagent === undefined ? { enabled: true, deviceId: "cloud-1" } : options.superagent;
  const superagentCalls: Array<{ action: string; request: unknown }> = [];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action?: string; request?: unknown };
    if (status && action?.startsWith("superagent_")) {
      superagentCalls.push({ action, request });
      if (action === "superagent_status") return { ok: true, value: status };
      if (action === "superagent_enable" || action === "superagent_disable") {
        status = { ...status, enabled: action === "superagent_enable" };
        return { ok: true, value: { enabled: status.enabled } };
      }
      if (action === "superagent_delete_data") return { ok: true, value: { deleted: true } };
    }
    return baseInvoke(data);
  };
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: fleetNavigator(),
  });
  const app = await open(HARNESS, { ...size, host: { handlers: host.handlers } });
  return { app, host, backend, superagentCalls };
}

test("the left list draws three scopes without icons, and only Preferences pages say they sync", async () => {
  const { app } = await openSettings();
  await app.waitFor("nav-settings-page-general");
  for (const scope of ["Preferences", "Account", "Device"]) {
    expect([scope, app.shows(`text:${scope}`)]).toEqual([scope, true]);
  }
  for (const page of ["profile", "devices", "openbitfun", "activity", "models", "permissions", "archived", "mcp"]) {
    expect([page, app.shows(`nav-settings-page-${page}`)]).toEqual([page, true]);
  }
  // The pet page is listed everywhere and says "Desktop only" off the desktop
  // app (tauri-gap §1.5, wave22-p3); the old groups are gone.
  expect(app.shows("nav-settings-page-pet")).toBe(true);
  expect(app.shows("nav-settings-page-automation")).toBe(false);
  expect(app.shows("nav-settings-page-external-agents")).toBe(false);

  // A Preferences page: a 22/600 title and the synced line.
  await app.waitFor("settings-synced");
  expect(Number(app.spanStyle("Synced with your account").fontSize)).toBe(12);
  await app.waitFor("Interface language");

  // A Device page drops the synced line.
  await app.press("nav-settings-page-models");
  await app.waitFor("Default models");
  expect(app.shows("settings-synced")).toBe(false);
  expect(Number(app.spanStyle("Models >> nth=1").fontSize)).toBe(22);
  expect(String(app.spanStyle("Models >> nth=1").fontWeight)).toBe("600");
});

test("the device scope chip lists runtime devices, disables an offline one and moves the context", async () => {
  const { app, host } = await openSettings();
  await app.waitFor("settings-scope-chip");
  await app.press("settings-scope-chip");
  // Local runtime desktop (isClientDevice: true) and peer runtimes are both selectable.
  await app.waitFor("settings-scope-device-dev-a");
  await app.waitFor("settings-scope-device-dev-b");
  // The cloud agent is not a device scope; an offline device is listed with its word.
  expect(app.shows("settings-scope-device-cloud-1")).toBe(false);
  expect(app.shows("settings-scope-device-dev-c")).toBe(true);
  expect(app.shows("text:Offline")).toBe(true);

  await app.press("settings-scope-device-dev-b");
  await app.press("nav-settings-page-mcp");
  // The device pages now read linux-box.
  await app.waitUntil(() => host.fleetCalls.some(call => call.target === "dev-b" && call.command === "get_mcp_servers"));

  // Switching back to the local desktop reloads device-scoped stores for dev-a.
  await app.press("settings-scope-chip");
  await app.press("settings-scope-device-dev-a");
  await app.waitUntil(() => host.fleetCalls.some(call => call.target === "dev-a" && call.command === "get_mcp_servers"));
});

test("Account › OpenBitFun turns the agent off and deletes its data through the cloud node", async () => {
  const { app, host, superagentCalls } = await openSettings();
  await app.press("nav-settings-page-openbitfun");
  await app.waitFor("Talk to one agent that starts work on all your devices.");
  await app.waitFor("obf-toggle");
  // Every superagent command is addressed to the cloud device.
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "superagent_status"));
  expect(
    host.fleetCalls.filter(call => call.command.startsWith("superagent_")).every(call => call.target === "cloud-1"),
  ).toBe(true);

  await app.press("obf-toggle");
  // The switch was on (the node answered enabled), so a press turns it off.
  await app.waitUntil(() => superagentCalls.some(call => call.action === "superagent_disable"));
  expect(superagentCalls.some(call => call.action === "superagent_enable")).toBe(false);

  await app.press("obf-delete-data");
  await app.waitFor("obf-delete-dialog");
  await app.waitFor("Delete Super Agent data?");
  await app.press("obf-delete-confirm");
  await app.waitUntil(() => superagentCalls.some(call => call.action === "superagent_delete_data"));
  expect(superagentCalls.find(call => call.action === "superagent_delete_data")?.request).toEqual({ cancelJobs: true });
});

test("a node without the OpenBitFun commands answers with an explicit unsupported row", async () => {
  const { app } = await openSettings({ superagent: null });
  await app.press("nav-settings-page-openbitfun");
  await app.waitFor("Super Agent can't be reached from here yet.");
  expect(app.shows("obf-toggle")).toBe(false);
});

test("Permissions names the modes in plain words and writes the OpenBitFun device switches through set_superagent_settings", async () => {
  const { app, backend } = await openSettings();
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Let Super Agent answer for me");
  await app.waitFor("Accept jobs from Super Agent");
  await app.waitFor("Full access");
  await app.waitFor("Ask first");
  // Both switches are on unless the device stored exactly false, so a press writes false,
  // as the device's own typed command (it applies the rule), never a leaf config write.
  await app.press("superagent-accept-dispatch");
  await app.waitUntil(() =>
    backend.calls.some(
      call =>
        call.action === "set_superagent_settings" &&
        (call.request as Record<string, unknown> | null)?.acceptDispatch === false,
    ),
  );
  expect(backend.settingsWrites.some(write => write.path === "superagent.acceptDispatch")).toBe(false);
});

test("Account › Activity states the host's six months in one sentence above the heatmap", async () => {
  const { app } = await openSettings();
  await app.press("nav-settings-page-activity");
  await app.waitFor("settings-activity-heatmap");
  const summary = app.texts().find(text => text.includes("active days in the last 6 months")) ?? "";
  expect(summary).toMatch(/tokens across \d+ active days in the last 6 months/);
});

test("Account › Devices and chat apps lists the account's devices and one phone row", async () => {
  const { app } = await openSettings();
  await app.press("nav-settings-page-devices");
  await app.waitFor("account-device-dev-b");
  expect(app.shows("text:linux-box")).toBe(true);
  expect(app.shows("text:Offline")).toBe(true);
  await app.press("account-open-on-phone");
  await app.waitFor("account-phone-sheet");
});

test("the phone lists the scopes first, hides desktop-only Pet, and pushes one page with a pages switcher", async () => {
  const { app } = await openSettings({}, PHONE);
  await app.waitFor("settings-compact-page-general");
  expect(app.shows("settings-scope-list")).toBe(false);
  expect(app.shows("settings-compact-page-openbitfun")).toBe(true);
  expect(app.shows("settings-compact-page-pet")).toBe(false);
  await app.press("settings-compact-page-permissions");
  await app.waitFor("settings-compact-pages");
  expect(app.shows("settings-compact-back")).toBe(false);
  await app.waitFor("Let Super Agent answer for me");
  await app.press("settings-compact-pages");
  await app.waitFor("settings-compact-page-general");
});

test("switching device scope guards unsaved drafts, masks secrets, and Default models omits Not set", async () => {
  const { app, host } = await openSettings();
  await app.press("nav-settings-page-models");
  await app.waitFor("Default models");
  // Unset default model slots show the Choose a model placeholder, never raw "Not set".
  expect(app.texts()).not.toContain("Not set");

  await app.type("proxy-password", "super-secret-value");
  await app.press("settings-scope-chip");
  await app.press("settings-scope-device-dev-b");
  await app.waitFor("settings-unsaved-dialog");
  expect(app.texts()).toContain("Proxy password: Hidden");
  expect(app.texts().join("\n")).not.toContain("super-secret-value");

  await app.press("settings-unsaved-discard");
  await app.waitUntil(() => !app.shows("settings-unsaved-dialog"));
  await app.waitUntil(() => host.fleetCalls.some(call => call.target === "dev-b" && call.command === "get_config"));
});

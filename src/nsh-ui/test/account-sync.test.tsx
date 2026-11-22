// Account settings sync (wave 21): the Preferences caption shows only while the
// backend reports sync as active, Account › Profile draws the switch and the
// state the backend reports, and an applied account change repaints the theme
// without the page doing anything itself.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const HARNESS = "./fixtures/settingsApp.tsx";

async function openSettings(accountSync?: Record<string, unknown> | null) {
  const backend = createBackend({ accountSync });
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 1,
      full: true,
      devices: [fleetDeviceRow("dev-a", "MacBook", [])],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open(HARNESS, { ...DESKTOP, host: { handlers: host.handlers } });
  return { app, host, backend };
}

test("the Preferences caption follows the backend's sync state", async () => {
  const { app } = await openSettings();
  await app.waitFor("settings-synced");

  const off = await openSettings({ enabled: false, phase: "off", active: false, pending: 0 });
  await off.app.waitFor("Interface language");
  expect(off.app.shows("settings-synced")).toBe(false);

  // A host without the commands has no account sync: no caption either.
  const old = await openSettings(null);
  await old.app.waitFor("Interface language");
  expect(old.app.shows("settings-synced")).toBe(false);
});

test("Account › Profile switches sync off and on and shows the reported state", async () => {
  const { app } = await openSettings();
  await app.press("nav-settings-page-profile");
  await app.waitFor("account-sync-toggle");
  expect(app.shows("text:Synced")).toBe(true);

  await app.press("account-sync-toggle");
  await app.waitFor("text:Off on this device");
  await app.press("nav-settings-page-general");
  await app.waitFor("Interface language");
  expect(app.shows("settings-synced")).toBe(false);

  await app.press("nav-settings-page-profile");
  await app.press("account-sync-toggle");
  await app.waitFor("text:Synced");
});

test("an offline device says changes wait, the only device says so, and an old host asks for an update", async () => {
  const { app } = await openSettings({ enabled: true, phase: "offline", active: true, pending: 2, peers: 2, peersOnline: 0 });
  await app.press("nav-settings-page-profile");
  await app.waitFor("text:Waiting for your other devices. Changes sync when one is online.");
  expect(app.shows("text:Devices online: 0 of 2 · Changes waiting: 2")).toBe(true);

  // The account's only device is in sync with itself.
  const only = await openSettings({ enabled: true, phase: "synced", active: true, pending: 0, peers: 0, peersOnline: 0 });
  await only.app.press("nav-settings-page-profile");
  await only.app.waitFor("text:Synced (no other devices yet)");

  const old = await openSettings(null);
  await old.app.press("nav-settings-page-profile");
  await old.app.waitFor("text:Update OpenBitFun on this device to sync settings.");
  expect(old.app.shows("account-sync-toggle")).toBe(false);
});

test("the appearance is kept on the host, and an applied account change repaints it", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, colorScheme: "dark", host: { handlers: backend.handlers } });
  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.press("appearance-swatch-openbitfun-monochrome");
  await app.waitFor("Showing the light scheme");
  await app.waitUntil(() =>
    backend.settingsWrites.some(write => write.path === "appearance.selection" && write.value === "openbitfun-monochrome"),
  );

  // Another device chose a dark preset; the backend applied it here and says so.
  await backend.handlers["openbitfun.invoke"]({
    action: "set_config",
    request: { path: "appearance.selection", value: "openbitfun-midnight" },
  });
  await app.host.send("openbitfun.event", {
    event: "account://settings-applied",
    payload: { keys: ["appearance.selection"] },
  });
  await app.waitFor("Showing the dark scheme");
});

test("Account › Profile surfaces an inline error when saving the sync switch fails", async () => {
  const { app, backend } = await openSettings();
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action } = data as { action?: string };
    if (action === "account_settings_sync_set") {
      return { ok: false, error: "sync store read-only" };
    }
    return baseInvoke(data);
  };
  await app.press("nav-settings-page-profile");
  await app.waitFor("account-sync-toggle");
  await app.press("account-sync-toggle");
  await app.waitFor("account-sync-write-failed");
  expect(app.shows("text:sync store read-only")).toBe(true);
});

test("account://settings-applied reloads keybindings and ignores events from remote peer origins", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 1,
      full: true,
      devices: [fleetDeviceRow("dev-a", "MacBook", [])],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.press("Settings");
  await app.waitFor("settings-synced");

  // A sync-state event from a remote peer (`dev-b`) must not overwrite this entry (`dev-a`)'s state.
  await app.host.send("openbitfun.obpFrames", [
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: {
        seq: 1,
        origin: "dev-b",
        originInstance: "b-1",
        event: "account://settings-sync-state",
        payload: { enabled: false, phase: "off", active: false, pending: 0 },
      },
    }),
  ]);
  await app.wait(60);
  expect(app.shows("settings-synced")).toBe(true);

  // An applied-settings event on the entry triggers a keybindings reload.
  const countKeybindingReads = () =>
    backend.calls.filter(
      c => c.action === "get_config" && (c.request as { path?: string } | undefined)?.path === "app.keybindings",
    ).length;
  const beforeReads = countKeybindingReads();
  await app.host.send("openbitfun.obpFrames", [
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: {
        seq: 2,
        origin: "dev-a",
        originInstance: "a-1",
        event: "account://settings-applied",
        payload: { keys: ["app.keybindings"] },
      },
    }),
  ]);
  await app.waitUntil(() => countKeybindingReads() > beforeReads);
  expect(host.calls.length).toBeGreaterThan(0);
});

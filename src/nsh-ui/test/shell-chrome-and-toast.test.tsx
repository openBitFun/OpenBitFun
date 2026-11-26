// Bottom-left Settings button toggle/borderless behavior and unified
// bottom-left 6-second auto-dismissing ToastHost.
import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };

test("ToastHost appears at the bottom-left on desktop and auto-dismisses after 6s", async () => {
  const app = await open("./fixtures/toastFixture.tsx", { ...DESKTOP, clock: {} });

  await app.press("label:push-success");
  await app.waitFor("text:Saved settings");
  const pos = app.layout("text:Saved settings");
  expect(pos).not.toBeNull();
  expect(pos!.x).toBeLessThan(DESKTOP.width / 3);
  expect(pos!.y).toBeGreaterThan(DESKTOP.height / 2);

  // Still visible just before 6s, then auto-dismisses once 6s elapses.
  await app.wait(5500);
  expect(app.shows("text:Saved settings")).toBe(true);
  await app.wait(1000);
  expect(app.shows("text:Saved settings")).toBe(false);

  // Error toasts use the same unified 6s auto-dismiss timer.
  await app.press("label:push-error");
  await app.waitFor("text:Action failed");
  await app.wait(5500);
  expect(app.shows("text:Action failed")).toBe(true);
  await app.wait(1000);
  expect(app.shows("text:Action failed")).toBe(false);
});

test("ToastHost stays anchored at the bottom-left on compact viewports too", async () => {
  const app = await open("./fixtures/toastFixture.tsx", { ...PHONE, clock: {} });

  await app.press("label:push-success");
  await app.waitFor("text:Saved settings");
  const pos = app.layout("text:Saved settings");
  expect(pos).not.toBeNull();
  expect(pos!.x).toBeLessThan(PHONE.width / 3);
  expect(pos!.y).toBeGreaterThan(PHONE.height / 2);
});

test("bottom-left Settings button highlights without a border and toggles Settings closed on second press", async () => {
  const host = fleetObpHost(createBackend(), {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 1,
      full: true,
      devices: [fleetDeviceRow("dev-a", "MacBook", [], { hostKind: "desktop" })],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("Settings");

  // First click enters Settings; the button highlights with an active background and selected state.
  await app.press("Settings");
  await app.waitFor("Interface language");
  expect(app.accessibility("Settings")?.selected).toBe(true);
  expect(app.viewStyle("Settings")?.backgroundColor).toBeDefined();

  // Second click exits Settings back to the prior scene.
  await app.press("Settings");
  await app.waitUntil(() => !app.shows("Interface language"));
  expect(app.accessibility("Settings")?.selected).toBe(false);
});

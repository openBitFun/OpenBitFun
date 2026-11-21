// Wave 22 P5: Settings › Shortcuts remapping, the device's desktop-control
// permissions and the settings export/import, each over its backend command.
import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const HARNESS = "./fixtures/settingsApp.tsx";

function fleetNavigator() {
  return {
    revision: 2,
    full: true,
    devices: [
      fleetDeviceRow("dev-a", "MacBook", [
        {
          workspaceId: "workspace-1",
          name: "OpenBitFun",
          rootPath: "/repo",
          isHostCurrent: true,
          sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
        },
      ]),
      fleetDeviceRow(
        "dev-b",
        "linux-box",
        [{ workspaceId: "workspace-2", name: "infra", rootPath: "/srv/infra", isHostCurrent: true, sessions: [] }],
        { hostKind: "cli" },
      ),
    ],
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
  };
}

const MAC_PERMISSIONS = {
  computerUseEnabled: true,
  accessibilityGranted: false,
  screenCaptureGranted: true,
  platformNote: "",
  permissions: {
    platform: "macos",
    process_id: 42,
    executable: "/Applications/OpenBitFun.app",
    prompts_requested: false,
    permissions: [
      {
        kind: "accessibility",
        state: "required",
        requestable: true,
        settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        detail: "Needed to click and type for you.",
      },
      { kind: "screen_recording", state: "granted", requestable: false, settings_url: null, detail: "Screenshots." },
    ],
  },
};

/** The settings harness over a fleet entry; the CLI device refuses desktop control as a CLI host does. */
async function openFleetSettings() {
  const backend = createBackend();
  const base = backend.handlers["openbitfun.invoke"];
  const sent: Array<{ action: string; target: string | null; request: unknown }> = [];
  let imported: unknown = null;
  // eslint-disable-next-line prefer-const
  let host: ReturnType<typeof fleetObpHost>;
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action?: string; request?: unknown };
    const target = host?.fleetCalls.at(-1)?.target ?? null;
    switch (action) {
      case "computer_use_get_status":
      case "computer_use_request_permission":
      case "computer_use_open_system_settings":
        sent.push({ action, target, request });
        if (target === "dev-b") {
          return { ok: false, error: `${action} is not available on this host: no browser or OS automation` };
        }
        return { ok: true, value: action === "computer_use_get_status" ? MAC_PERMISSIONS : null };
      case "export_config":
        sent.push({ action, target, request });
        return {
          ok: true,
          value: { product_id: "openbitfun", format_version: 1, config: { app: {} }, export_timestamp: "2026-11-21T00:00:00Z", version: "2.0.0" },
        };
      case "import_config":
        sent.push({ action, target, request });
        imported = (request as { configData?: unknown })?.configData;
        return { ok: true, value: { success: true, errors: [], warnings: [] } };
      default:
        return base(data);
    }
  };
  host = fleetObpHost(backend, { fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" }, navigator: fleetNavigator() });
  const app = await open(HARNESS, { ...DESKTOP, host: { handlers: host.handlers } });
  return { app, sent, imported: () => imported };
}

test("desktop control lists the device's own permissions and asks for one there; a CLI device says it can't", async () => {
  const { app, sent } = await openFleetSettings();
  await app.waitFor("nav-settings-page-desktop-control");
  await app.press("nav-settings-page-desktop-control");
  await app.waitFor("Desktop control permissions");
  await app.waitFor("computer-use-accessibility");
  expect(app.texts()).toContain("Needs your permission");
  expect(app.texts()).toContain("Allowed");
  // A granted permission offers nothing to do.
  expect(app.shows("computer-use-request-screen_recording")).toBe(false);

  await app.press("computer-use-request-accessibility");
  await app.waitUntil(() => sent.some(call => call.action === "computer_use_request_permission"));
  expect(sent.find(call => call.action === "computer_use_request_permission")).toMatchObject({
    target: "dev-a",
    request: { kind: "accessibility" },
  });
  await app.press("computer-use-open-accessibility");
  await app.waitUntil(() => sent.some(call => call.action === "computer_use_open_system_settings"));
  expect(sent.find(call => call.action === "computer_use_open_system_settings")?.request).toEqual({ pane: "accessibility" });

  await app.press("settings-scope-chip");
  await app.press("settings-scope-device-dev-b");
  await app.waitFor("Not available on linux-box");
  expect(app.shows("computer-use-accessibility")).toBe(false);
});

test("settings export copies the device's document and import sends a picked file to it", async () => {
  const { app, sent, imported } = await openFleetSettings();
  await app.press("nav-settings-page-diagnostics");
  await app.waitFor("config-export-copy");
  await app.press("config-export-copy");
  await app.waitUntil(() => sent.some(call => call.action === "export_config"));
  await app.waitUntil(() => (app.clipboard() ?? "").includes('"format_version": 1'));

  app.onPick(() => [
    {
      name: "openbitfun-settings.json",
      type: "application/json",
      data: new TextEncoder().encode(JSON.stringify({ product_id: "openbitfun", format_version: 1, config: { app: {} } })),
    },
  ]);
  await app.press("config-import-open");
  await app.waitFor("config-import-dialog");
  // Text that is not JSON never reaches the device.
  await app.type("config-import-text", "not json");
  await app.press("config-import-confirm");
  await app.waitFor("That isn't an exported settings file.");
  expect(sent.some(call => call.action === "import_config")).toBe(false);

  await app.press("config-import-choose");
  await app.waitFor("openbitfun-settings.json");
  await app.press("config-import-confirm");
  await app.waitUntil(() => sent.some(call => call.action === "import_config"));
  expect(imported()).toMatchObject({ product_id: "openbitfun", format_version: 1 });
  expect(sent.find(call => call.action === "import_config")?.target).toBe("dev-a");
  // An accepted import closes the dialog (the harness mounts no toast host).
  await app.waitUntil(() => !app.shows("config-import-dialog"));
});

test("a stored shortcut override rebinds the shell, and Settings resets it to the default", async () => {
  const backend = createBackend();
  const base = backend.handlers["openbitfun.invoke"];
  let keybindings: unknown = { __version__: 1, overrides: { "panel.toggleLeft": { key: "b", ctrl: true, shift: true } } };
  const writes: unknown[] = [];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action?: string; request?: { path?: string; value?: unknown } };
    if (action === "get_config" && request?.path === "app.keybindings") return { ok: true, value: keybindings };
    if (action === "set_config" && request?.path === "app.keybindings") {
      keybindings = request.value;
      writes.push(request.value);
      return { ok: true, value: null };
    }
    return base(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("label:nav-split-handle");
  // The override replaced the default: Command-Shift-B toggles the sidebar.
  await app.keyboard.press("mod+shift+b");
  await app.waitUntil(() => !app.shows("label:nav-split-handle"));
  await app.keyboard.press("mod+shift+b");
  await app.waitFor("label:nav-split-handle");

  await app.keyboard.press("mod+,");
  await app.press("nav-settings-page-shortcuts");
  await app.waitFor("shortcut-keys-panel.toggleLeft");
  expect(app.texts()).toContain("Show or hide the sidebar");
  expect(app.texts()).toContain("⇧⌘B");
  expect(app.texts()).toContain("⌘K");

  await app.press("shortcut-reset-panel.toggleLeft");
  await app.waitUntil(() => writes.length === 1);
  expect(writes[0]).toEqual({ __version__: 1, overrides: {} });
  await app.waitUntil(() => !app.shows("shortcut-reset-panel.toggleLeft"));
  // The shell follows the write without a restart: Command-B is back.
  await app.keyboard.press("mod+b");
  await app.waitUntil(() => !app.shows("label:nav-split-handle"));
});

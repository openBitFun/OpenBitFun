// Library (visual spec §4.8): one page for assistants, agents, skills, spaces
// and routines. The page draws the title, the "On {device}" scope chip, the
// five tabs and one subtitle; each tab's scene draws only its toolbar and rows
// under that (no page title, KPI rows or feature-list subtitle of its own).

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "ios" as const };
const HARNESS = "./fixtures/libraryApp.tsx";

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
      ], { hostKind: "desktop", isClientDevice: true }),
      fleetDeviceRow("dev-b", "linux-box", [
        { workspaceId: "workspace-2", name: "infra", rootPath: "/srv/infra", sessions: [] },
      ], { hostKind: "cli" }),
      fleetDeviceRow("dev-c", "win-pc", [], { state: "offline" }),
      fleetDeviceRow("dev-phone", "Pixel", [], { hostKind: "mobile", isClientDevice: true }),
      fleetDeviceRow("dev-cloud", "OpenBitFun Cloud", [], { hostKind: "cloud" }),
    ],
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
  };
}

function cronJob(id: string, name: string, schedule: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    name,
    schedule,
    payload: { text: "Check open pull requests." },
    enabled: true,
    target: {
      kind: "workspace",
      workspace: { workspaceId: "workspace-1", workspacePath: "/repo" },
      launch: { agentType: "Standard", modelId: null },
    },
    createdAtMs: 1763000000000,
    updatedAtMs: 1763000000000,
    state: {},
  };
}

function openLibrary(size: typeof DESKTOP | typeof PHONE = DESKTOP, options: { fleet?: boolean; cronJobs?: Array<Record<string, unknown>> } = {}) {
  const backend = createBackend();
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const action = (data as { action?: string }).action;
    if (action === "list_cron_jobs") return { ok: true, value: options.cronJobs ?? [] };
    if (action === "notify_cron_host_ready") return { ok: true, value: null };
    if (action === "get_assistant_workspaces") return { ok: true, value: [] };
    return baseInvoke(data);
  };
  const host = fleetObpHost(backend, {
    fleet: options.fleet === false ? null : { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: fleetNavigator(),
  });
  return open(HARNESS, { ...size, host: { handlers: host.handlers } }).then(app => ({ app, host }));
}

test("the Library header draws the title, the scope chip, five tabs and the tab's one subtitle", async () => {
  const { app } = await openLibrary();
  await app.waitFor("Library");
  await app.waitFor("On MacBook");
  for (const tab of ["Assistants", "Agents", "Skills", "Spaces", "Routines"]) {
    expect([tab, app.shows(`text:${tab}`)]).toEqual([tab, true]);
  }
  expect(app.shows("text:Personal assistants with their own memory and voice.")).toBe(true);
  // The title is the page title role: 22 / 600.
  expect(Number(app.spanStyle("Library").fontSize)).toBe(22);
  expect(String(app.spanStyle("Library").fontWeight)).toBe("600");

  await app.press("library-tab-agents");
  await app.waitFor("Agents your sessions can use, and the helpers they call.");
  // The hosted scene keeps its toolbar and its one primary button, and drops its own title.
  await app.waitFor("New agent");
  expect(app.shows("label:agents-search-input")).toBe(true);
  expect(app.texts()).not.toContain("Agents & Subagents");

  await app.press("library-tab-skills");
  await app.waitFor("Instructions and tools agents load when needed.");
  expect(app.shows("label:skills-search-input")).toBe(true);

  await app.press("library-tab-spaces");
  await app.waitFor("Small apps you build and run with OpenBitFun.");

  await app.press("library-tab-routines");
  await app.waitFor("Work that runs on a schedule.");
  await app.waitFor("New routine");
});

test("the scope chip lists runtime devices, disables offline ones and moves the device context", async () => {
  const { app, host } = await openLibrary();
  await app.waitFor("On MacBook");
  await app.press("library-scope-chip");
  await app.waitFor("linux-box");
  // Frontend phones and the cloud superagent node do not host a local library.
  expect(app.texts()).not.toContain("Pixel");
  expect(app.texts()).not.toContain("OpenBitFun Cloud");
  // Local desktop runtime (isClientDevice: true) stays listed so the user can return to it.
  expect(app.shows("label:library-scope-dev-a")).toBe(true);
  // An offline device is listed but cannot be chosen.
  expect(app.shows("text:win-pc")).toBe(true);
  expect(app.shows("text:Offline")).toBe(true);
  await app.press("library-scope-dev-b");
  await app.waitFor("On linux-box");
  // The tab's reads now go to that device.
  await app.press("library-tab-agents");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.target === "dev-b" && call.command === "get_available_modes"),
  );
  // Switching back to the local desktop while on Agents reactively reloads for dev-a.
  const devACallsBefore = host.fleetCalls.filter(
    call => call.target === "dev-a" && call.command === "get_available_modes",
  ).length;
  await app.press("library-scope-chip");
  await app.waitFor("label:library-scope-dev-a");
  await app.press("library-scope-dev-a");
  await app.waitFor("On MacBook");
  await app.waitUntil(
    () =>
      host.fleetCalls.filter(call => call.target === "dev-a" && call.command === "get_available_modes")
        .length > devACallsBefore,
  );
});

test("without the fleet layer the chip names this device and opens no menu", async () => {
  const { app } = await openLibrary(DESKTOP, { fleet: false });
  await app.waitFor("Library");
  await app.waitFor("This device");
  // A label, not a control: nothing to press, no other device named.
  expect(app.shows("label:library-scope-chip")).toBe(true);
  expect(app.shows("text:linux-box")).toBe(false);
});

test("an empty tab uses the boxless empty state with the Library's words and one action", async () => {
  const { app } = await openLibrary();
  await app.waitFor("Library");
  await app.press("library-tab-routines");
  await app.waitFor("No routines yet");
  expect(app.shows("text:Run a check every morning, or a task once at a set time.")).toBe(true);
  expect(app.shows("label:routines-empty-action")).toBe(true);
});

test("schedules read as words, and a cron-only schedule shows the expression without a Cron label", async () => {
  const { app } = await openLibrary(DESKTOP, {
    cronJobs: [
      cronJob("cron-1", "Morning check", { kind: "cron", expr: "30 9 * * *" }),
      cronJob("cron-2", "Half-hourly", { kind: "every", everyMs: 30 * 60_000 }),
    ],
  });
  await app.waitFor("Library");
  await app.press("library-tab-routines");
  await app.waitFor("Morning check");
  expect(app.shows("text:30 9 * * *")).toBe(true);
  expect(app.texts().some(text => text.includes("Cron:"))).toBe(false);
  expect(app.shows("text:Every 30m")).toBe(true);
});

test("on a phone the page keeps the tabs in a horizontal scroller and leaves the chip to the top bar", async () => {
  const { app } = await openLibrary(PHONE);
  await app.waitFor("library-tab-assistants");
  // The shell's phone top bar carries the title and the chip; the page draws neither.
  expect(app.shows("text:Library")).toBe(false);
  expect(app.shows("label:library-tabs-scroll")).toBe(true);
  expect(app.shows("label:library-scope-chip")).toBe(false);
});

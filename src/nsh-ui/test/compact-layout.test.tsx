// The phone layout (visual spec §2.2, §3 PhoneTabBar, §4.2): under 720 px there
// is no sidebar; a 48 top bar and a tab bar take its place. With the Super Agent
// UI gated off (the default, `src/productGates.ts`) the tabs are Sessions (the
// account's device → workspace → session tree, the phone's first screen),
// Inbox and Library, and the avatar opens Settings; with it on they are
// OpenBitFun, Inbox, All sessions and Library, and ☰ opens the conversation
// history. A session (a pushed page) draws without the tab bar.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const APP_SUPER_AGENT = "./fixtures/obpAppSuperAgent.tsx";
const PHONE = { width: 375, height: 812, platform: "ios" as const };
const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const MEDIUM = { width: 860, height: 800, platform: "macos" as const };
const ENTRY = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

function host() {
  const backend = createBackend();
  return fleetObpHost(backend, {
    fleet: ENTRY,
    navigator: {
      revision: 2,
      full: true,
      removedDeviceIds: [],
      totals: { running: 0, waiting: 2, unread: 0 },
      devices: [
        fleetDeviceRow("dev-a", "MacBook", [
          {
            workspaceId: "workspace-1",
            name: "openbitfun",
            rootPath: "/repo",
            isHostCurrent: true,
            sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
          },
        ], { isClientDevice: true }),
      ],
    },
  });
}

test("a phone opens on Sessions, the device tree, with Inbox and Library as the other tabs", async () => {
  const entry = host();
  const app = await open("./fixtures/obpApp.tsx", { ...PHONE, host: { handlers: entry.handlers } });
  await app.waitFor("phone-tab-bar");
  for (const tab of ["all-sessions", "inbox", "library"]) {
    expect([tab, app.shows(`phone-tab-${tab}`)]).toEqual([tab, true]);
  }
  expect(app.shows("phone-tab-openbitfun")).toBe(false);
  expect(app.shows("phone-history")).toBe(false);
  // The first screen is the tree: this device, its workspace, then its sessions.
  await app.waitFor("label:session-list-scene");
  await app.waitFor("NSH skeleton");
  expect(app.texts().some(text => text.includes("Super Agent"))).toBe(false);
  await app.waitFor("inbox-count-2");
  // The avatar on the first screen opens Settings, a pushed page without the tab bar.
  await app.press("phone-account");
  await app.waitFor("text:Preferences");
  expect(app.shows("phone-tab-bar")).toBe(false);
  await app.press("phone-back");
  await app.waitFor("phone-tab-bar");
});

test("with Super Agent on, a phone gets its four tabs and the top bar instead of the sidebar", async () => {
  const entry = host();
  const app = await open(APP_SUPER_AGENT, { ...PHONE, host: { handlers: entry.handlers } });
  await app.waitFor("phone-tab-bar");
  for (const tab of ["openbitfun", "inbox", "all-sessions", "library"]) {
    expect([tab, app.shows(`phone-tab-${tab}`)]).toEqual([tab, true]);
  }
  expect(app.shows("nav-all-sessions")).toBe(false);
  expect(app.shows("phone-top-bar")).toBe(true);
  // The Inbox tab shows the count the backend projects (navigator totals here).
  await app.waitFor("inbox-count-2");

  // Tabs switch destinations and the top bar names them.
  await app.press("phone-tab-library");
  await app.waitFor("library-tab-assistants");
  await app.press("phone-tab-all-sessions");
  await app.waitFor("label:session-list-scene");
  await app.press("phone-tab-inbox");
  await app.waitUntil(() => app.texts().includes("Inbox"));
});

test("with Super Agent on, ☰ opens the conversation history as a drawer, and the avatar opens Settings", async () => {
  const entry = host();
  const app = await open(APP_SUPER_AGENT, { ...PHONE, host: { handlers: entry.handlers } });
  await app.waitFor("phone-history");
  await app.press("phone-history");
  await app.waitFor("phone-history-drawer");
  await app.press("compact-drawer-scrim");
  await app.waitUntil(() => !app.shows("phone-history-drawer"));
  await app.press("phone-account");
  await app.waitFor("text:Preferences");
  expect(app.shows("phone-tab-bar")).toBe(false);
});

test("a session opened on a phone is a pushed page without the tab bar", async () => {
  const entry = host();
  const app = await open("./fixtures/obpApp.tsx", { ...PHONE, host: { handlers: entry.handlers } });
  await app.press("phone-tab-all-sessions");
  await app.press("label:NSH skeleton");
  await app.waitUntil(() => !app.shows("phone-tab-bar"));
  expect(app.shows("phone-top-bar")).toBe(false);
});

test("between 720 and 959 the sidebar is an overlay drawer; at 1200 and above it docks", async () => {
  const medium = await open("./fixtures/obpApp.tsx", { ...MEDIUM, host: { handlers: host().handlers } });
  await medium.waitFor("toggle-drawer");
  expect(medium.shows("nav-all-sessions")).toBe(false);
  await medium.press("toggle-drawer");
  await medium.waitFor("overlay-sidebar");
  await medium.press("overlay-sidebar-scrim");
  await medium.waitUntil(() => !medium.shows("overlay-sidebar"));

  const wide = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host().handlers } });
  await wide.waitFor("nav-library");
  expect(wide.shows("phone-tab-bar")).toBe(false);
  expect(wide.shows("global-search-trigger")).toBe(true);
  expect(wide.shows("nav-library")).toBe(true);
  expect(wide.shows("nav-inbox")).toBe(false);
  expect(wide.shows("nav-all-sessions")).toBe(false);
});

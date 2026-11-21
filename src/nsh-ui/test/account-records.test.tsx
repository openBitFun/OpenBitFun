// Account records (wave24-replica): the account's routines that run on
// another device are listed with the device that runs them, and MCP servers
// and SSH profiles that came from the account but still need a secret on this
// device say so. A host without `device_records_overview` draws nothing extra.

import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

const OVERVIEW = {
  attached: true,
  routinesElsewhere: [
    {
      id: "cron_remote_1",
      name: "Nightly backup check",
      schedule: { kind: "cron", expr: "0 2 * * *" },
      enabled: true,
      targetDeviceId: "dev-b",
      targetDeviceName: "Studio Mac",
    },
  ],
  mcpNeedsSecrets: [{ id: "fs-server", missing: ["GITHUB_TOKEN"] }],
  sshNeedsSecrets: [],
  skillMarketsNeedToken: [],
};

async function openLibraryRoutines(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("Library");
  if (!app.shows("library-tab-routines")) await app.press("Library");
  await app.press("library-tab-routines");
}

test("routines of another device are listed with the device that runs them", async () => {
  const backend = createBackend({ accountRecords: OVERVIEW });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openLibraryRoutines(app);
  await app.waitFor("label:routine-elsewhere-cron_remote_1");
  expect(app.texts()).toContain("On your other devices");
  expect(app.texts()).toContain("Nightly backup check");
  expect(app.texts()).toContain("Runs on Studio Mac");
  expect(backend.actions()).toContain("device_records_overview");
  // Listed only: this device offers no toggle or menu for it.
  expect(app.shows("label:routine-toggle-cron_remote_1")).toBe(false);
});

test("an MCP server from the account asks for its secret on this device", async () => {
  const backend = createBackend({ accountRecords: OVERVIEW });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("label:mcp-needs-secret-fs-server");
  expect(app.texts()).toContain("Needs GITHUB_TOKEN on this device");
  expect(app.shows("label:mcp-needs-secret-remote-docs")).toBe(false);
});

test("a host without account records draws nothing extra", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openLibraryRoutines(app);
  await app.waitFor("library-tab-routines");
  await app.waitUntil(() => backend.actions().includes("device_records_overview"));
  expect(app.shows("label:routines-elsewhere")).toBe(false);
  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("text:MCP servers");
  expect(app.shows("label:mcp-needs-secret-fs-server")).toBe(false);
});

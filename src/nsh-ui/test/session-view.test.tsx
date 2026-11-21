// The session view (visual spec §3 Session header, §4.5): the device ›
// workspace breadcrumb, the "Started by OpenBitFun" origin line, the tool
// toggles, the phone header, and review notes sent back to the agent. The
// session runs on another device than the entry, so every action names it.
import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };
const APP = "./fixtures/sessionApp.tsx";

async function openSession(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("text:ready");
  await app.wait(200);
  await app.press("harness-open-session");
  await app.waitFor("text:Fix flaky test");
}

function sessionHost(origin: "superagent" | null = "superagent", deviceState = "online") {
  const backend = createBackend();
  const row = {
    ...fleetSessionRow("dev-b", "ws-b", "s-b1", "Fix flaky test"),
    ...(origin ? { origin, jobRef: { conversationId: "c-1", jobId: "job-1", conversationTitle: "Release 1.2" } } : {}),
  };
  return fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 2,
      full: true,
      devices: [
        fleetDeviceRow(
          "dev-a",
          "MacBook",
          [{ workspaceId: "workspace-1", name: "OpenBitFun", rootPath: "/repo", isHostCurrent: true, sessions: [] }],
          { isClientDevice: true },
        ),
        fleetDeviceRow("dev-b", "linux-box", [{ workspaceId: "ws-b", name: "openbitfun", rootPath: "/home/b/repo", sessions: [row] }], {
          hostKind: "cli",
          state: deviceState,
          asOfMs: new Date(2026, 10, 21, 10, 42).getTime(),
        }),
      ],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
}

test("the header names the session, its device and workspace, and where it started", async () => {
  const host = sessionHost();
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await openSession(app);
  expect(app.shows("id:session-breadcrumb-device >> text:linux-box")).toBe(true);
  expect(app.shows("label:session-breadcrumb-workspace")).toBe(true);
  expect(app.shows("text:openbitfun")).toBe(true);
  expect(app.shows("text:Started by Super Agent in “Release 1.2” ›")).toBe(true);
  // An idle session draws no state word.
  expect(app.shows("label:session-status-working")).toBe(false);
  expect(app.shows("label:session-status-needs_you")).toBe(false);
  // No device or run-target picker anywhere in the session.
  expect(app.texts().some(text => /where this task runs|switch device|this machine/i.test(text))).toBe(false);

  // The origin line opens the OpenBitFun conversation that started it.
  await app.press("session-origin");
  await app.waitFor("text:route:openbitfun::c-1");
});

test("the device badge opens the device page, and the tool toggles open the inspector", async () => {
  const host = sessionHost(null);
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await openSession(app);
  // Without a superagent origin there is no origin line.
  expect(app.texts().some(text => text.startsWith("Started by Super Agent"))).toBe(false);
  for (const tool of ["files", "git", "terminal", "browser"]) {
    expect([tool, app.shows(`label:session-tool-${tool}`)]).toEqual([tool, true]);
  }
  await app.press("session-tool-git");
  await app.waitFor("text:aux:git");
  // Pressing the active tool closes it again.
  await app.press("session-tool-git");
  await app.waitFor("text:aux:closed");
  await app.press("id:session-breadcrumb-device");
  await app.waitFor("text:route:device:dev-b:");
});

test("review notes are sent to the session's agent on its device as one message", async () => {
  const host = sessionHost(null);
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await openSession(app);
  expect(app.shows("review-notes-bar")).toBe(false);
  await app.press("harness-add-note");
  await app.waitFor("id:review-notes-bar >> text:1 note");
  await app.press("review-notes-send");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => JSON.stringify(call.args).includes("src/parser.rs:12 Use a match here")),
  );
  const sent = host.fleetCalls.find(call => JSON.stringify(call.args).includes("src/parser.rs:12 Use a match here"));
  expect(sent?.target).toBe("dev-b");
  await app.waitFor("review-notes-bar", { state: "gone" });
});

test("a phone shows a 48 back header with the title over the device", async () => {
  const host = sessionHost();
  const app = await open(APP, { ...PHONE, host: { handlers: host.handlers } });
  await openSession(app);
  expect(app.shows("label:session-back")).toBe(true);
  expect(app.shows("id:session-header >> text:linux-box")).toBe(true);
  // The tool toggles are for 720 and wider.
  expect(app.shows("label:session-tool-files")).toBe(false);
  expect(app.shows("label:session-breadcrumb-workspace")).toBe(false);
});

test("an offline device's session says what it shows and disables the composer with that reason", async () => {
  const host = sessionHost(null, "offline");
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await openSession(app);
  await app.waitFor("label:session-offline-notice");
  expect(app.shows("text:linux-box is offline. Showing what was saved at 10:42.")).toBe(true);
  // The badge carries the exception word.
  expect(app.shows("id:session-breadcrumb-device >> text:· Offline")).toBe(true);
  expect(app.enabled("composer")).toBe(false);
});

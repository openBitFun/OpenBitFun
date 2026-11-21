// Parity of the old UI's session, workspace and notification actions in the
// new shell (wave 17): a session row in All sessions and the session header
// share one ⋯ (rename, archive, copy ID, export, storage folder, delete with a
// confirmation); a workspace row in By device keeps the old sidebar's
// workspace menu; Settings › Archived sessions deletes after a confirmation;
// and on a backend without the fleet layer the Inbox lists what the old bell
// did (approvals waiting here, turns that finished or stopped).

import { expect, open, test } from "nsh/test";
import {
  createBackend,
  fleetDeviceRow,
  fleetObpHost,
  fleetSessionRow,
  showAllSessions,
  showDevices,
} from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const ENTRY = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

function callsOf(backend: ReturnType<typeof createBackend>, action: string) {
  return backend.calls.filter(call => call.action === action);
}

test("a session row's ⋯ renames, archives, copies its ID, shows its folder and deletes only after a confirmation", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showAllSessions(app, "Terminal migration");

  // Rename opens a dialog with the current name and saves through the session's own catalogue.
  await app.press("session-actions-session-2");
  await app.press("session-menu-rename-session-2");
  await app.waitFor("session-rename-input");
  await app.clear("session-rename-input");
  await app.type("session-rename-input", "Terminal port");
  await app.press("session-rename-save");
  await app.waitUntil(() => callsOf(backend, "save_session_metadata").length > 0);
  expect(callsOf(backend, "save_session_metadata").at(-1)?.request).toMatchObject({
    metadata: { sessionId: "session-2", sessionName: "Terminal port" },
    fields: ["sessionName"],
  });
  await app.waitFor("Terminal port");

  // Copy session ID writes the id, nothing else.
  await app.press("session-actions-session-2");
  await app.press("session-menu-copy-id-session-2");
  await app.waitUntil(() => app.clipboard() === "session-2");

  // The storage folder is on this machine, so the file manager opens it.
  await app.press("session-actions-session-2");
  await app.press("session-menu-storage-session-2");
  await app.waitUntil(() => callsOf(backend, "reveal_session_storage_directory").length === 1);
  expect(callsOf(backend, "reveal_session_storage_directory")[0]?.request).toMatchObject({
    session_id: "session-2",
    workspace_id: "workspace-1",
  });

  // Delete asks first; Cancel sends nothing.
  await app.press("session-actions-session-2");
  await app.press("session-menu-delete-session-2");
  await app.waitFor("session-delete-modal");
  await app.press("Cancel");
  await app.waitFor("session-delete-modal", { state: "gone" });
  expect(callsOf(backend, "delete_persisted_session")).toHaveLength(0);
  await app.press("session-actions-session-2");
  await app.press("session-menu-delete-session-2");
  await app.press("session-delete-confirm");
  await app.waitUntil(() => callsOf(backend, "delete_persisted_session").length === 1);
  expect(callsOf(backend, "delete_persisted_session")[0]?.request).toMatchObject({
    session_id: "session-2",
    workspace_id: "workspace-1",
  });
  await app.waitFor("Terminal port", { state: "gone" });

  // Archive leaves Recent and says so.
  await app.press("session-actions-session-1");
  await app.press("session-menu-archive-session-1");
  await app.waitUntil(() => callsOf(backend, "archive_session").length === 1);
  expect(callsOf(backend, "archive_session")[0]?.request).toMatchObject({ session_id: "session-1" });
  await app.waitFor("text:Archived “NSH skeleton”");
});

test("the session header ⋯ copies the session ID and exports the transcript as before", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showAllSessions(app, "Terminal migration");
  await app.press("Terminal migration");
  await app.press("thread-actions-trigger >> nth=0");
  await app.press("session-menu-copy-id-session-2");
  await app.waitUntil(() => app.clipboard() === "session-2");

  await app.press("thread-actions-trigger >> nth=0");
  await app.press("session-menu-export-session-2");
  await app.waitUntil(() => callsOf(backend, "export_session_transcript").length === 1);
  expect(callsOf(backend, "export_session_transcript")[0]?.request).toMatchObject({
    session_id: "session-2",
    workspace_id: "workspace-1",
    tools: true,
  });
  // The exported file is on this machine, so it is shown in the file manager.
  await app.waitUntil(() => backend.reveals.includes("/tmp/exports/session-2.md"));
});

test("a session of another device is archived and renamed there, and its folder is not offered here", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: ENTRY,
    navigator: {
      revision: 2,
      full: true,
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
      devices: [
        fleetDeviceRow("dev-a", "MacBook", [
          { workspaceId: "workspace-1", name: "openbitfun", rootPath: "/repo", isHostCurrent: true, sessions: [] },
        ], { isClientDevice: true }),
        fleetDeviceRow("dev-b", "linux-box", [
          {
            workspaceId: "workspace-9",
            name: "infra",
            rootPath: "/srv/infra",
            sessions: [fleetSessionRow("dev-b", "workspace-9", "session-9", "Build release")],
          },
        ], { hostKind: "cli" }),
      ],
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-all-sessions");
  await showAllSessions(app, "Build release");

  await app.press("session-actions-session-9");
  // The storage folder lives on linux-box: the item is there, disabled, with its reason.
  expect(app.enabled("session-menu-storage-session-9")).toBe(false);
  expect(app.shows("text:Only for sessions on this device")).toBe(true);
  await app.press("session-menu-archive-session-9");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "archive_session"));
  expect(host.fleetCalls.find(call => call.command === "archive_session")).toMatchObject({
    target: "dev-b",
    args: { request: { session_id: "session-9", workspace_id: "workspace-9" } },
  });

  await app.press("session-actions-session-9");
  await app.press("session-menu-rename-session-9");
  await app.clear("session-rename-input");
  await app.type("session-rename-input", "Build 1.2");
  await app.press("session-rename-save");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "update_session_title"));
  expect(host.fleetCalls.find(call => call.command === "update_session_title")).toMatchObject({
    target: "dev-b",
    args: { request: { sessionId: "session-9", title: "Build 1.2", workspaceId: "workspace-9" } },
  });
});

test("a workspace row's ⋯ keeps the old workspace menu: terminal, rename, path, assistant reset with a confirmation, close", async () => {
  const backend = createBackend({
    openedWorkspaces: [
      { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
      { id: "assistant-1", name: "Muse", rootPath: "/tmp/assistants/muse", workspaceKind: "assistant" },
    ],
    currentWorkspaceId: "workspace-1",
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showDevices(app);
  await app.waitFor("workspace-actions-workspace-1");

  // Copy path and rename.
  await app.press("workspace-actions-workspace-1");
  await app.press("workspace-menu-copy-path-workspace-1");
  await app.waitUntil(() => app.clipboard() === "/repo");
  await app.press("workspace-actions-workspace-1");
  await app.press("workspace-menu-rename-workspace-1");
  await app.clear("workspace-rename-input");
  await app.type("workspace-rename-input", "Main repo");
  await app.press("workspace-rename-save");
  await app.waitUntil(() => callsOf(backend, "update_workspace_info").length === 1);
  expect(callsOf(backend, "update_workspace_info")[0]?.request).toMatchObject({ workspaceId: "workspace-1", name: "Main repo" });

  // A local folder can be shown in the file manager.
  await app.press("workspace-actions-workspace-1");
  expect(app.enabled("workspace-menu-reveal-workspace-1")).toBe(true);
  await app.press("workspace-menu-reveal-workspace-1");
  await app.waitUntil(() => backend.reveals.includes("/repo"));

  // An assistant workspace adds reset and delete; reset asks first.
  await app.press("workspace-actions-assistant-1");
  await app.press("workspace-menu-reset-assistant-assistant-1");
  await app.waitFor("assistant-action-modal");
  expect(callsOf(backend, "reset_assistant_workspace")).toHaveLength(0);
  await app.press("assistant-action-confirm");
  await app.waitUntil(() => callsOf(backend, "reset_assistant_workspace").length === 1);
  expect(callsOf(backend, "reset_assistant_workspace")[0]?.request).toMatchObject({ workspaceId: "assistant-1" });

  // Close.
  await app.press("workspace-actions-workspace-1");
  await app.press("workspace-menu-close-workspace-1");
  await app.waitUntil(() => callsOf(backend, "close_workspace").length === 1);
  expect(callsOf(backend, "close_workspace")[0]?.request).toMatchObject({ workspaceId: "workspace-1" });

  // New terminal opens the Terminal tool in that workspace.
  await app.press("workspace-actions-assistant-1");
  await app.press("workspace-menu-new-terminal-assistant-1");
  await app.waitUntil(() => backend.calls.some(call => call.action === "terminal_create"));
});

test("an archived session is deleted from Settings only after a confirmation", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("nav-all-sessions");
  await app.press("Settings");
  await app.press("nav-settings-page-archived");
  await app.waitFor("settings-archived-delete-session-3");
  await app.press("settings-archived-delete-session-3");
  await app.waitFor("session-delete-modal");
  expect(callsOf(backend, "delete_persisted_session")).toHaveLength(0);
  await app.press("session-delete-confirm");
  await app.waitUntil(() => callsOf(backend, "delete_persisted_session").length === 1);
  expect(callsOf(backend, "delete_persisted_session")[0]?.request).toMatchObject({ session_id: "session-3" });
  await app.waitFor("settings-archived-delete-session-3", { state: "gone" });
});

test("without the fleet layer the Inbox lists this backend's approvals, answerable in place, and the turns that ended", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("nav-all-sessions");
  // The approval waiting in session-1 shows on the sidebar pill.
  await app.waitFor("sidebar-inbox-count");
  await app.press("nav-inbox");
  await app.waitFor("inbox-group-needs_you");
  expect(app.shows("text:NSH skeleton")).toBe(true);

  // A turn that finished elsewhere lands under Done, as the old bell listed it.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-2", turnId: "turn-9" },
  });
  await app.waitFor("inbox-group-done");
  expect(app.texts().some(text => text.startsWith("Terminal migration"))).toBe(true);
  await app.press("inbox-mark-all-read");
  await app.waitFor("inbox-mark-all-read", { state: "gone" });
  await app.press("inbox-clear");
  await app.waitFor("inbox-group-done", { state: "gone" });

  // Allow once answers the backend's own request and the item leaves.
  await app.press("Allow once");
  await app.waitUntil(() => callsOf(backend, "respond_permission").length === 1);
  expect(callsOf(backend, "respond_permission")[0]?.request).toMatchObject({ requestId: "perm-1", reply: "once" });
});

test("recently closed workspaces reopen from By device and can be removed from the list", async () => {
  const backend = createBackend({
    recentOnlyWorkspaces: [
      { id: "workspace-old", name: "legacy-app", rootPath: "/work/legacy-app", workspaceKind: "local" },
      { id: "workspace-gone", name: "scratch", rootPath: "/tmp/scratch", workspaceKind: "local" },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showDevices(app);
  await app.press("all-sessions-recently-closed");
  await app.waitFor("recent-workspace-workspace-gone");

  await app.press("recent-workspace-actions-workspace-gone");
  await app.press("recent-workspace-remove-workspace-gone");
  await app.waitUntil(() => callsOf(backend, "remove_recent_workspace").length === 1);
  expect(callsOf(backend, "remove_recent_workspace")[0]?.request).toMatchObject({ workspaceId: "workspace-gone" });
  await app.waitFor("recent-workspace-workspace-gone", { state: "gone" });

  await app.press("recent-workspace-reopen-workspace-old");
  await app.waitUntil(() => callsOf(backend, "open_workspace").length === 1);
  await app.waitFor("workspace-row-workspace-old");
});

test("Delete all in Archived sessions asks first, then deletes the workspace's archived sessions on its device", async () => {
  const backend = createBackend({
    sessions: [
      { sessionId: "session-1", sessionName: "Live", lastUpdated: 1763000000000, messageCount: 1 },
      { sessionId: "session-7", sessionName: "Old A", lastUpdated: 1762000000000, messageCount: 1, persistedStatus: "archived" },
      { sessionId: "session-8", sessionName: "Old B", lastUpdated: 1761000000000, messageCount: 1, persistedStatus: "archived" },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("nav-all-sessions");
  await app.press("Settings");
  await app.press("nav-settings-page-archived");
  await app.press("settings-archived-delete-all");
  await app.waitFor("settings-archived-delete-all-modal");
  expect(callsOf(backend, "delete_all_archived_sessions")).toHaveLength(0);
  await app.press("settings-archived-delete-all-confirm");
  await app.waitUntil(() => callsOf(backend, "delete_all_archived_sessions").length === 1);
  expect(callsOf(backend, "delete_all_archived_sessions")[0]?.request).toMatchObject({ workspace_id: "workspace-1" });
});

import { expect, open, test } from "nsh/test";
import {
  formatBucket,
  formatDate,
  formatDuration,
  formatMonthYear,
  formatPlural,
  formatRelativeTime,
  formatTimestamp,
  weekdayShortLabels,
} from "./src/format";
import {
  SUPPORTED_LOCALES,
  currentLocale,
  normalizeLocale,
  onAppLocalePersisted,
  setAppLocale,
  syncLocaleFromHost,
  tr,
  trForLocale,
} from "./src/i18n";
import { enUSMessages } from "./src/locales/en-US";
import { zhCNMessages } from "./src/locales/zh-CN";
import { zhTWMessages } from "./src/locales/zh-TW";
import { type BackendOptions, DEFAULT_USAGE, createBackend, createDeviceBackend } from "./test/support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("shell and sessions come from the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("OpenBitFun");
  const texts = app.texts();
  expect(app.shows("OpenBitFun")).toBe(true);
  expect(app.shows("Sessions")).toBe(true);
  expect(texts).toContain("NSH skeleton");

  // The catalog is requested for the workspace the host reported.
  const listCall = backend.calls.find(call => call.action === "list_persisted_sessions_page");
  expect(listCall?.request).toMatchObject({ workspace_id: "workspace-1", limit: 50 });
});

test("opened sessions become tabs on the session canvas", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Terminal migration");
  await app.press("Terminal migration >> nth=0");
  await app.waitFor("Port the terminal.");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  // Both sessions stay open: each tab inside the thread menu brings its own transcript back.
  await app.press("thread-actions-trigger");
  await app.press("open-tab-session-2");
  await app.waitFor("Port the terminal.");
  await app.press("thread-actions-trigger");
  await app.press("open-tab-session-1");
  await app.waitFor("Port the session list.");

  // Closing the other tab leaves one tab, and the transcript on screen stays.
  await app.press("thread-actions-trigger");
  await app.press("× >> nth=1");
  expect(app.texts().filter(text => text === "×").length).toBe(1);
  expect(app.texts()).toContain("Port the session list.");
});

test("archived sessions are their own list and can be restored", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  // Archived rows stay out of the active list but are still counted.
  expect(app.texts()).not.toContain("Old experiment");
  await app.press("drawer-more");
  await app.waitFor("Archived 1");

  await app.press("Archived 1");
  await app.waitFor("Old experiment");
  // The active rows leave the list (the header pill still names the selected session).
  expect(app.texts()).not.toContain("Terminal migration");

  // Restore from the thread menu of the archived session.
  await app.press("Old experiment");
  await app.press("thread-actions-trigger");
  await app.press("Restore");
  expect(backend.actions()).toContain("unarchive_session");
  await app.waitFor("Archived 0");
  await app.press("Active");
  await app.waitFor("Old experiment");
});

test("selecting a session loads its turns", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Terminal migration");
  await app.press("Terminal migration >> nth=0");
  await app.waitFor("Port the terminal.");
  expect(backend.actions()).toContain("load_session_turns");
  expect(app.texts()).toContain("Port the terminal.");
});

test("deleting a session drops its row and the catalog count with it", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  const before = app.texts();
  expect(before).toContain("3");

  await app.press("NSH skeleton >> nth=0");
  await app.press("thread-actions-trigger");
  await app.press("Delete");
  await app.waitFor("Delete NSH skeleton? This cannot be undone.");
  await app.press("Confirm delete");

  expect(backend.calls.find(call => call.action === "delete_persisted_session")?.request).toMatchObject({
    session_id: "session-1",
    workspace_id: "workspace-1",
  });
  await app.waitFor("2");
  expect(app.texts()).not.toContain("3");
});

test("session header actions archive, rename and send a turn", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");

  await app.press("thread-actions-trigger");
  await app.press("Rename");
  await app.type("session-rename", "Renamed session");
  await app.press("Save");
  expect(backend.calls.find(call => call.action === "save_session_metadata")?.request).toMatchObject({
    fields: ["sessionName"],
    workspace_id: "workspace-1",
    metadata: { sessionId: "session-1", sessionName: "Renamed session" },
  });

  await app.type("composer", "Continue the migration");
  await app.press("Send");
  // Every send is the host's `submit_user_message`, addressed to the session's
  // own workspace; the host decides whether it starts, steers or queues.
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-1",
    text: "Continue the migration",
    agentType: "Standard",
    workspaceId: "workspace-1",
  });
  expect(backend.userMessages[0]).toMatchObject({ outcome: "started" });

  await app.press("thread-actions-trigger");
  await app.press("Archive");
  expect(backend.calls.find(call => call.action === "archive_session")?.request).toMatchObject({
    session_id: "session-1",
    workspace_id: "workspace-1",
  });
});

test("each session row states what that session is doing", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  // The host reports messages for both active sessions and neither was opened
  // here, so both rows expose unread status dots; session-1 also awaits approval.
  await app.waitFor("status-Not read yet");
  await app.waitFor("status-Waiting for approval");

  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");
  // Opening a session is what marks it read.
  expect(app.count("status-Not read yet")).toBe(1);

  // A turn in another session marks that row without touching this transcript.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-2", turnId: "turn-2" },
  });
  await app.waitFor("status-Running");
  expect(app.texts()).toContain("Port the session list.");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-2", turnId: "turn-2" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-failed",
    payload: { sessionId: "session-2", turnId: "turn-3", reason: "provider refused" },
  });
  await app.waitFor("status-Last turn failed");
  expect(app.shows("status-Running")).toBe(false);
});

test("settings switches the scheme it draws and remembers the choice", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // The host's own appearance is dark; the app follows it until asked not to.
    colorScheme: "dark",
  });

  await app.waitFor("NSH skeleton");
  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor("Showing the dark scheme");

  await app.press("appearance-light");
  await app.waitFor("Showing the light scheme");
  // The choice survives a restart of the surface.
  expect(app.storage()["openbitfun.nsh.appearance.v1"]).toBe("light");
  // The light scheme's own muted text: the scene repainted, not just its state.
  expect(app.spanStyle("Showing the light scheme").color).toBe("#5c6672ff");

  await app.press("appearance-system");
  await app.waitFor("Showing the dark scheme");
});

test("a message sent while a turn runs steers that turn instead of starting another", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // The host reports the turn it started; it is the host that addresses it.
  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.type("composer", "Also check the tests");
  await app.press("Steer");

  await app.waitUntil(() => backend.userMessages.length === 1);
  // The stored policy (`immediate`) is applied by the host, not by this surface.
  expect(backend.userMessages[0]).toMatchObject({
    sessionId: "session-1",
    text: "Also check the tests",
    outcome: "steered",
    turnId: "turn-9",
  });
  // Steering lands in the turn that is already running, not in a second one,
  // and this surface no longer picks the steer command itself.
  expect(backend.actions()).not.toContain("steer_dialog_turn");
  expect(backend.actions()).not.toContain("start_dialog_turn");
});

/**
 * Waits for a command to reach the backend. Handlers that fire off a follow-up
 * command have no visible text of their own to wait for.
 */
async function waitForCalls(
  backend: ReturnType<typeof createBackend>,
  action: string,
  count = 1,
): Promise<Array<{ action: string; request: unknown }>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const calls = backend.calls.filter(call => call.action === action);
    if (calls.length >= count) return calls;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${action} never reached the host`);
}

test("a queued message waits in the host queue; this window never drains it", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.type("composer", "Then look at the docs");
  await app.press("Queue");
  await app.waitFor("Queued 1 · starts when the running turn finishes");
  // Queueing is not steering, and nothing is kept in this surface's storage.
  expect(backend.userMessages[0]).toMatchObject({ outcome: "queued", text: "Then look at the docs" });
  expect(backend.actions()).not.toContain("steer_dialog_turn");
  expect(app.storage()["openbitfun.nsh.pending-queue.v1"]).toBeUndefined();

  backend.setRunningTurn("session-1", null);
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  // The host drains its queue; this window only re-reads the rows.
  const lists = await waitForCalls(backend, "manage_dialog_queue", 2);
  expect(lists.every(call => (call.request as { action?: string })?.action === "list")).toBe(true);
  expect(backend.actions()).not.toContain("start_dialog_turn");
});

test("rows an earlier build kept locally are handed to the host queue once", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    storage: {
      "openbitfun.nsh.pending-queue.v1": JSON.stringify([
        { id: "nsh-old-1", sessionId: "session-1", content: "Left over from before" },
      ]),
    },
  });
  await app.waitFor("NSH skeleton");
  const submits = await waitForCalls(backend, "manage_dialog_queue", 2);
  const submit = submits.find(call => (call.request as { action?: string })?.action === "submit");
  expect(submit?.request).toMatchObject({
    sessionId: "session-1",
    message: { turnId: "nsh-old-1", content: "Left over from before" },
  });
  await app.waitUntil(() => app.storage()["openbitfun.nsh.pending-queue.v1"] === undefined);
});

test("a host with a dialog queue keeps the message and promotes it on request", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.type("composer", "Hold this until the turn ends");
  await app.press("Queue");
  await app.waitFor("Queued 1 · starts when the running turn finishes");

  // The host owns the row: the press asked it to queue this one message, and
  // the list above is the snapshot the host returned.
  const submit = backend.calls.find(call => call.action === "submit_user_message");
  expect(submit?.request).toMatchObject({
    sessionId: "session-1",
    text: "Hold this until the turn ends",
    agentType: "Standard",
    sendDuringTurn: "queue",
  });
  // Nothing reaches the running turn until the host promotes it.
  expect(backend.actions()).not.toContain("steer_dialog_turn");
  // A host queue is not a local list, so nothing is written to local storage.
  expect(app.storage()["openbitfun.nsh.pending-queue.v1"]).toBeUndefined();

  await app.press("Send now");
  const promote = backend.calls.find(call =>
    call.action === "manage_dialog_queue" && (call.request as { action?: string })?.action === "promote");
  expect(promote?.request).toMatchObject({ sessionId: "session-1" });
  // A promoted row has left the queue, so the panel stops listing it.
  expect(app.texts()).not.toContain("Hold this until the turn ends");
});

test("a host queue reorders its own rows against the revision it just read", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.type("composer", "First on the queue");
  await app.press("Queue");
  await app.waitFor("Queued 1 · starts when the running turn finishes");
  await app.type("composer", "Second on the queue");
  await app.press("Queue");
  await app.waitFor("Queued 2 · starts when the running turn finishes");

  // The first row moves to the end: "before nothing" is how the host spells last.
  await app.press("Down >> nth=0");

  const submits = backend.userMessages.filter(message => message.outcome === "queued").map(message => message.turnId);
  expect(submits).toHaveLength(2);
  // The host, not this surface, moved it: one reorder naming the revision the
  // fresh snapshot reported, which is the count of every mutation so far.
  expect(backend.queueReorders).toHaveLength(1);
  expect(backend.queueReorders[0]).toMatchObject({
    turnId: submits[0],
    beforeTurnId: null,
    expectedRevision: 2,
  });
  const texts = app.texts();
  expect(texts.indexOf("Second on the queue")).toBeLessThan(texts.indexOf("First on the queue"));
});

test("a queued row the host is holding back says why", async () => {
  const options: BackendOptions = { hostQueue: true, hostQueueBlocked: {} };
  const backend = createBackend(options);
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.type("composer", "Blocked by the host");
  await app.press("Queue");
  await app.waitFor("Queued 1 · starts when the running turn finishes");

  const turnId = backend.userMessages.find(message => message.outcome === "queued")?.turnId ?? "";
  expect(turnId).not.toBe("");
  // The host starts holding the row back; the next snapshot says so.
  options.hostQueueBlocked![turnId] = "the workspace folder is not readable";

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });

  await app.waitFor("Blocked");
  await app.waitFor("Waiting: the workspace folder is not readable");
});

test("a clipboard image rides into the turn as an attachment", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // A clipboard image the OS reports by path: the host opens it, not this app.
    modules: {
      nsh: {
        "Clipboard.readImage": () => ({
          url: "file:///Users/me/Shots/pasted%20image.png",
          size: { width: 640, height: 480 },
        }),
      },
    },
  });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  await app.press("Attach");
  await app.waitFor("pasted image.png");

  await app.type("composer", "What is in this image?");
  await app.press("Send");

  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "What is in this image?",
    attachments: [
      {
        mime_type: "image/png",
        image_name: "pasted image.png",
        image_path: "/Users/me/Shots/pasted image.png",
        width: 640,
        height: 480,
        source: "clipboard",
      },
    ],
  });
  // The attachment belongs to the turn that just started, not to the next one.
  expect(app.texts()).not.toContain("pasted image.png");
});

test("the session header copies a session and selects the copy", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.press("thread-actions-trigger");
  await app.press("Duplicate");
  expect(backend.calls.find(call => call.action === "copy_session")?.request).toMatchObject({
    source_session_id: "session-1",
    workspace_id: "workspace-1",
  });
  // The copy is in the catalog the scene reloads and becomes the selected session.
  await app.waitFor("NSH skeleton (copy)");
});

test("the session list asks the host for a new session", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Sessions");
  await app.press("New");
  expect(backend.calls.find(call => call.action === "create_session")?.request).toMatchObject({
    sessionName: "New session",
    agentType: "Standard",
    workspaceId: "workspace-1",
  });
});

test("the composer's agent comes from the host catalogue and the shared preference", async () => {
  // `follow_last` is the desktop's strategy when nothing is pinned: both surfaces
  // then start the composer on the agent used last, whichever one chose it. No
  // session is open, which is when that preference is what the composer shows.
  const backend = createBackend({
    sessions: [],
    configs: {
      "app.flow_chat": { default_mode_strategy: "follow_last", last_mode_id: "Creative" },
    },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Agent: Creative");
  // The catalogue is asked for by workspace: that is what the host resolves an
  // agent against, and what makes a remote workspace answer with its own agents.
  // Its order, eligibility and default are the host's (`get_session_mode_catalog`).
  expect(backend.calls.find(call => call.action === "get_session_mode_catalog")?.request).toMatchObject({
    workspaceId: "workspace-1",
    workspacePath: "/repo",
  });

  // The four profiles first, then the agents the host resolved for this workspace.
  await app.press("agent-picker");
  await app.waitFor("✓ Creative");
  expect(app.texts()).toContain("Deep research");
  expect(app.texts()).toContain("OpenCode");
  // The host also resolves an assistant-workspace agent, which a session here
  // cannot be switched to, so it is not offered.
  expect(app.texts()).not.toContain("Claw");

  // A new session starts as the agent the composer is on, and that pick is
  // remembered where the desktop keeps it, so the next launch starts there too.
  await app.press("New");
  expect(backend.calls.find(call => call.action === "create_session")?.request).toMatchObject({
    sessionName: "New session",
    agentType: "Creative",
  });
});

test("a started session keeps its agent; one with no turn takes the pick", async () => {
  const backend = createBackend({
    sessions: [
      {
        sessionId: "session-fresh",
        sessionName: "Fresh session",
        lastUpdated: 1763050000000,
        messageCount: 0,
        agentType: "Standard",
      },
      {
        sessionId: "session-1",
        sessionName: "NSH skeleton",
        lastUpdated: 1763000000000,
        messageCount: 4,
        agentType: "Standard",
      },
    ],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The first row is selected and has no turn yet, so the pick rebinds it.
  await app.waitFor("Fresh session");
  await app.press("agent-picker");
  await app.press("Ultimate");
  expect(backend.sessionModeWrites).toEqual([
    { sessionId: "session-fresh", modeId: "Ultimate", workspaceId: "workspace-1" },
  ]);
  // The host records the pick as `last_mode_id` itself; this surface no longer
  // writes the preference.
  expect(backend.settingsWrites.some(write => write.path === "app.flow_chat.last_mode_id")).toBe(false);
  await app.waitFor("Agent: Ultimate");

  // The next turn runs as the agent the session is bound to, not as a constant.
  await app.type("composer", "Run as Ultimate");
  await app.press("Send");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-fresh",
    agentType: "Ultimate",
  });

  // A session that already ran a turn keeps its agent: the press asks for a new
  // session instead of rebinding a transcript produced under another agent.
  await app.press("NSH skeleton >> nth=0");
  await app.press("agent-picker");
  await app.press("Minimal");
  expect(app.texts()).toContain(
    "This session already runs as Standard. Start a new session as Minimal?",
  );
  expect(backend.sessionModeWrites).toHaveLength(1);

  await app.press("Start session");
  const created = backend.calls.find(call => call.action === "create_session")?.request;
  expect(created).toMatchObject({ sessionName: "Minimal session", agentType: "Minimal" });
});

test("a host without an agent catalogue says so and stays on Standard", async () => {
  const backend = createBackend({ agentModes: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Agent: Standard");
  await app.press("agent-picker");
  // The panel names the command that did not answer, and offers a re-read rather
  // than pretending the catalogue is empty.
  await app.waitFor("Reload");
  expect(app.texts().some(text => text.includes("does not offer an agent catalog"))).toBe(true);
  // Nothing is invented to fill the panel, and the composer still sends.
  expect(app.texts()).not.toContain("Ultimate");
  await app.type("composer", "Send without a catalogue");
  await app.press("Send");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    agentType: "Standard",
  });
});

test("files scene walks directories lazily and previews markdown and code", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Files");
  await app.press("Files");
  await app.waitFor("Explorer");
  // The root is read through the explorer's own directory call, not the deep tree.
  await app.waitFor("README.md");
  expect(backend.actions()).toContain("explorer_get_children");
  expect(backend.actions()).not.toContain("get_file_tree");

  await app.press("README.md");
  await app.waitFor("Markdown preview from the host.");
  const readCall = backend.calls.find(
    call => call.action === "read_file_content" && (call.request as { filePath?: string }).filePath === "/repo/README.md",
  );
  expect(readCall?.request).toMatchObject({ workspaceId: "workspace-1" });

  // A source file opens in the code editor rather than as plain wrapped text.
  await app.press("main.rs");
  const codeCall = backend.calls.find(
    call => call.action === "read_file_content" && (call.request as { filePath?: string }).filePath === "/repo/main.rs",
  );
  expect(codeCall).toBeTruthy();
  expect(app.texts().join("\n")).not.toContain("simulated backend has no answer");
});

test("files scene previews an image and a video from host bytes", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("Explorer");

  await app.press("logo.png");
  const imageCall = backend.calls.find(
    call => call.action === "read_file_content" && (call.request as { filePath?: string }).filePath === "/repo/logo.png",
  );
  // Media comes back as base64 from the same command a text preview uses.
  expect(imageCall?.request).toMatchObject({ workspaceId: "workspace-1", encoding: "base64" });
  expect(app.texts().join("\n")).not.toContain("does not render workspace images");

  await app.press("demo.mp4");
  const videoCall = backend.calls.find(
    call => call.action === "read_file_content" && (call.request as { filePath?: string }).filePath === "/repo/demo.mp4",
  );
  expect(videoCall?.request).toMatchObject({ encoding: "base64" });

  // A file past the preview limit says so instead of pulling it through base64.
  await app.press("huge.mp4");
  await app.waitFor("48 MB is too large to preview here: open it in an external app.");
  expect(
    backend.calls.some(
      call => call.action === "read_file_content" && (call.request as { filePath?: string }).filePath === "/repo/huge.mp4",
    ),
  ).toBe(false);
});

test("the files scene lists changed files and reviews one as a diff", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("Explorer");
  // git_get_status for the workspace root decorates the tree and the list.
  expect(backend.actions()).toContain("git_get_status");
  await app.waitFor("Changes 3");
  await app.waitFor("main");

  await app.press("Show");
  await app.waitFor("guide.md");
  await app.press("changed-main.rs");

  const diffCall = backend.calls.find(call => call.action === "git_get_diff");
  expect(diffCall?.request).toMatchObject({
    workspaceId: "workspace-1",
    repositoryPath: "/repo",
    params: { files: ["/repo/main.rs"] },
  });
  // The patch reaches the review view instead of the file's plain text.
  expect(app.texts().join("\n")).toContain("hello, diff");
});

test("pasting copies the clipboard's files into the workspace", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // The OS clipboard's file list, as the desktop's clipboard helper reports it.
    modules: { nsh: { "Clipboard.readFiles": () => ["file:///Users/me/notes%20one.md"] } },
  });

  await app.press("Files");
  await app.waitFor("Explorer");
  await app.press("file-actions-menu");
  await app.press("Paste");

  const pasteCall = backend.calls.find(call => call.action === "paste_files");
  expect(pasteCall?.request).toMatchObject({
    workspaceId: "workspace-1",
    targetDirectory: "/repo",
    isCut: false,
    sourcePaths: ["/Users/me/notes one.md"],
  });
  // The pasted name arrives from the host's answer, so the tree shows it.
  await app.waitFor("Pasted 1 item");
  await app.waitFor("notes one.md");
});

test("files scene creates, renames and deletes through the workspace commands", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("file-actions-menu");

  await app.press("file-actions-menu");
  await app.press("New file");
  await app.type("entry-name", "notes.txt");
  await app.press("Save");
  await app.waitFor("notes.txt");
  expect(backend.calls.find(call => call.action === "create_file")?.request).toMatchObject({
    workspaceId: "workspace-1",
    path: "/repo/notes.txt",
  });

  await app.press("notes.txt");
  await app.press("file-actions-menu");
  await app.press("Rename");
  await app.type("entry-name", "renamed.txt");
  await app.press("Save");
  await app.waitFor("renamed.txt");
  expect(backend.calls.find(call => call.action === "rename_file")?.request).toMatchObject({
    workspaceId: "workspace-1",
    oldPath: "/repo/notes.txt",
    newPath: "/repo/renamed.txt",
  });

  await app.press("renamed.txt");
  await app.press("file-actions-menu");
  await app.press("Delete");
  await app.press("Confirm delete");
  expect(backend.calls.some(call => call.action === "delete_file")).toBe(true);
});

test("files scene searches file names through the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("file-search");
  await app.type("file-search", "guide");
  await app.keyboard.press("Return");
  expect(backend.calls.find(call => call.action === "search_files")?.request).toMatchObject({
    workspaceId: "workspace-1",
    pattern: "guide",
    searchContent: false,
  });
});

test("files scene greps inside files and opens the hit", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("file-search");
  await app.press("search-mode-content");
  await app.type("file-search", "hello");
  await app.keyboard.press("Return");
  // Content hits are grouped under their file; each carries its line number and
  // the matching line as its preview (workbench round 4: grouped search).
  await app.waitFor("search-hit-main.rs:2");
  expect(backend.calls.find(call => call.action === "search_files")?.request).toMatchObject({
    pattern: "hello",
    searchContent: true,
  });
  expect(app.texts().join("\n")).toContain('println!("hello");');
  await app.press("search-hit-main.rs:2");
  await app.waitFor("fn main() {");
});

test("a tool card expands into its checklist and its edit", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  // A tool call that carries a todo list shows its progress directly in the compact strip.
  await app.waitFor("checklist 1/3");
  await app.press("tool-card-todo_write");
  await app.waitFor("Move the list");
  expect(app.texts()).toContain("Delete the old table");

  // A tool call that carries an edit renders it as a diff.
  await app.press("tool-card-edit");
  expect(app.texts().join("\n")).toContain("hello, cards");
});

test("the composer picks the model the next turn runs on", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");
  // The catalog's default names the model in the composer bar before the user picks one.
  await app.waitFor("Model: Primary model");

  await app.press("Model: Primary model");
  // A model that cannot chat is not offered.
  await app.waitFor("Fast model · openai");
  expect(app.texts()).not.toContain("Image model · openai");

  await app.press("model-option-fast-small");
  const update = backend.calls.find(call => call.action === "update_session_model");
  expect(update?.request).toMatchObject({
    sessionId: "session-1",
    modelName: "fast-small",
    workspaceId: "workspace-1",
  });
  await app.waitFor("Model: Fast model");

  // Another session shows the model its own record carries, not this one's pick,
  // and a model the catalog does not list is shown by its own id.
  await app.press("Terminal migration >> nth=0");
  await app.waitFor("Model: session-only-model");
});

test("the composer offers the reasoning the chosen model supports", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  // The session reported no preset, which is the model's own default.
  await app.waitFor("Reasoning: Default");

  await app.press("Reasoning: Default");
  await app.waitFor("reasoning-option-high");

  await app.press("reasoning-option-high");
  const update = backend.calls.filter(call => call.action === "update_session_model").at(-1);
  expect(update?.request).toMatchObject({
    sessionId: "session-1",
    modelName: "gpt-4.1-mini",
    reasoningPreset: "high",
    workspaceId: "workspace-1",
  });
  // The chip follows what the host accepted, not what was pressed.
  await app.waitFor("Reasoning: High");

  // Back to the model's own default, written as a null rather than dropped: the
  // host distinguishes "clear it" from "leave it alone".
  await app.press("Reasoning: High");
  await app.press("reasoning-option-default");
  const cleared = backend.calls.filter(call => call.action === "update_session_model").at(-1);
  expect(cleared?.request).toMatchObject({ reasoningPreset: null });
  await app.waitFor("Reasoning: Default");
});

test("a host that declares no reasoning settings draws no control", async () => {
  const backend = createBackend({ reasoningCatalog: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Model: Primary model");
  expect(app.texts().some(text => text.startsWith("Reasoning:"))).toBe(false);
});

test("the transcript shows tool cards from a turn", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  // A read is titled by its verb and the file it read, not by the raw tool name.
  await app.waitFor("NavPanel.tsx");
  const texts = app.texts().join("\n");
  expect(texts).toContain("Read");
  expect(texts).toContain("NavPanel.tsx");
});

test("a reasoning model's streamed notes never become its answer", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-live" },
  });
  // The host sends reasoning on the same event, marked as thinking.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", text: "Weigh the options.", contentType: "thinking" },
  });
  await app.waitFor("Thinking");
  expect(app.texts().join("\n")).toContain("streaming");

  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", text: "Here is the answer." },
  });
  await app.waitFor("Here is the answer.");

  const texts = app.texts().join("\n");
  // The reply is the reply: the notes are their own, collapsed, block.
  expect(texts).not.toContain("Weigh the options.");
  await app.press("label:thinking-live-thinking");
  await app.waitFor("Weigh the options.");
});

test("a persisted reasoning block stays collapsed until it is opened", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Terminal migration");
  await app.press("Terminal migration");
  await app.waitFor("Thinking");

  // Collapsed, as the desktop keeps it: the header says how much there is, the
  // notes themselves are not in the transcript yet.
  const collapsed = app.texts().join("\n");
  expect(collapsed).toContain("46 characters");
  expect(collapsed).not.toContain("Weigh the two options");

  await app.press("label:thinking-turn-2|thinking|Weigh the two options before writing anything.");
  await app.waitFor("Weigh the two options before writing anything.");
  expect(app.texts().join("\n")).toContain("Weigh the two options before writing anything.");
});

test("a reply renders as Markdown rather than as its source", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Terminal migration");
  await app.press("Terminal migration");
  await app.waitFor("Plan");

  const texts = app.texts().join("\n");
  // The heading's text, the inline code and the fenced block's code arrive as
  // text; the markers that made them arrive nowhere.
  expect(texts).toContain("Run");
  expect(texts).toContain("pnpm run check");
  expect(texts).toContain("let rows = load();");
  expect(texts).not.toContain("```");
  expect(texts).not.toContain("## Plan");
});

test("a transcript block goes to the clipboard on Copy", async () => {
  const backend = createBackend();
  const copied: string[] = [];
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    modules: { nsh: { "Clipboard.writeText": (text: string) => void copied.push(text) } },
  });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  await app.press("Copy >> nth=0");
  // The user's own message, exactly as the transcript drew it.
  expect(copied).toEqual(["Port the session list."]);
  // The label says the copy happened, then goes back to offering it.
  await app.waitFor("Copied");
});

test("a running turn streams its text and can be stopped", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  const turnsBefore = backend.actions().filter(action => action === "load_session_turns").length;

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-live" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", delta: "Streamed reply" },
  });
  await app.waitFor("Streamed reply");
  expect(app.texts().join("\n")).toContain("Streamed reply");

  // Stop addresses the turn the host said it started; the host picks interrupt
  // or cancel itself.
  await app.press("Stop");
  expect(backend.calls.find(call => call.action === "stop_dialog_turn")?.request).toMatchObject({
    sessionId: "session-1",
    dialogTurnId: "turn-live",
  });

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-1" },
  });
  await app.waitFor("Rendered with a virtualized list.");
  const turnsAfter = backend.actions().filter(action => action === "load_session_turns").length;
  expect(turnsAfter).toBeGreaterThan(turnsBefore);
});

test("a pending permission request is answerable from the scene", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The prompt seeds from what is already waiting when the window attaches.
  await app.waitFor("Approval needed: run_command");
  expect(app.texts().join("\n")).toContain("cargo test -p openbitfun-desktop");

  await app.press("Always allow");
  expect(backend.calls.find(call => call.action === "respond_permission")?.request).toMatchObject({
    requestId: "perm-1",
    reply: "always",
  });

  // A live prompt arrives through `permission://event` and clears when answered.
  await app.host.send("openbitfun.event", {
    event: "permission://event",
    payload: {
      event: "asked",
      request: { requestId: "perm-2", action: "write_file", resources: ["/repo/main.rs"], sessionId: "session-1" },
    },
  });
  await app.waitFor("Approval needed: write_file");
  await app.press("Reject >> nth=0");
  expect(backend.calls.filter(call => call.action === "respond_permission").pop()?.request).toMatchObject({
    requestId: "perm-2",
    reply: "reject",
  });
});

test("a question the host is waiting on is recovered from the mailbox and answered", async () => {
  const backend = createBackend({
    pendingQuestions: [
      {
        toolId: "tool-q1",
        sessionId: "session-1",
        interactionStarted: false,
        questions: {
          questions: [
            {
              question: "Which port should the server use?",
              header: "Port",
              multiSelect: false,
              options: [
                { label: "8080", description: "the documented default" },
                { label: "3000", description: "" },
              ],
            },
          ],
          responseHostNowMs: 1,
          responseDeadlineMs: 0,
        },
      },
    ],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The question is only reachable through the mailbox when its event is gone.
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("The agent needs an answer");
  await app.waitFor("Port: Which port should the server use?");
  await app.waitFor("8080");
  await app.waitFor("the documented default");
  // Showing the question is what starts the host's own deadline.
  expect(backend.questionStarts).toEqual([{ sessionId: "session-1", toolId: "tool-q1" }]);

  await app.press("question-tool-q1-0-8080");
  await app.press("Send answer");
  expect(backend.userAnswers).toEqual([
    { toolId: "tool-q1", answers: { "0": "8080" }, sessionId: "session-1" },
  ]);
  // An answered question stops being a prompt.
  expect(app.texts()).not.toContain("The agent needs an answer");
});

test("a live question takes several options and a typed answer", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");
  await app.host.send("openbitfun.event", {
    event: "backend-event-toolawaitinguserinput",
    payload: {
      toolId: "tool-q2",
      sessionId: "session-1",
      questions: {
        questions: [
          {
            question: "Which checks should run?",
            header: "Checks",
            multiSelect: true,
            options: [
              { label: "Lint", description: "" },
              { label: "Tests", description: "" },
            ],
          },
        ],
        responseHostNowMs: 1,
        responseDeadlineMs: 0,
      },
    },
  });
  await app.waitFor("Checks: Which checks should run?");
  await app.waitFor("Choose one or more");

  // An unanswered question cannot be sent: the host would reject an empty answer.
  await app.press("Send answer");
  await app.waitFor("Answer every question first");
  expect(backend.userAnswers).toEqual([]);

  await app.press("question-tool-q2-0-Lint");
  await app.press("question-tool-q2-0-Tests");
  await app.press("question-tool-q2-0-other");
  await app.type("question-tool-q2-0-text", "smoke");
  await app.press("Send answer");
  expect(backend.userAnswers).toEqual([
    { toolId: "tool-q2", answers: { "0": ["Lint", "Tests", "smoke"] }, sessionId: "session-1" },
  ]);
});

test("settings scene reads the configured fields", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Application");
  expect(app.texts().join("\n")).toContain("Close button");
  // Settings opens one page at a time: the editor's rows are not drawn here.
  expect(app.shows("editor-font-size")).toBe(false);

  // A number field shows the stored value in its own input, read from the leaf
  // inside the document the host stores.
  await app.press("nav-settings-page-editor");
  await app.waitFor("Font size inside code and markdown previews");
  expect(app.value("editor-font-size")).toBe("14");
  await app.press("nav-settings-page-terminal");
  await app.waitFor("Maximum lines preserved in terminal scroll history");
  expect(app.value("terminal-scrollback")).toBe("1000");
  // Values are read one path at a time, so a path a host lacks cannot fail the page.
  expect(backend.actions()).toContain("get_config");
});

test("settings scene writes toggles, selects and numbers", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Application");

  await app.press("notify-permission-request");
  expect(backend.settingsWrites).toContainEqual({ path: "app.notifications.permission_request_notify", value: true });

  // Each field writes its own leaf; the `editor` document is never replaced.
  await app.press("nav-settings-page-editor");
  await app.press("editor-word-wrap-on");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.word_wrap", value: "on" });

  // Save only appears once the typed value differs from the stored one.
  expect(app.shows("editor-font-size-save")).toBe(false);
  await app.clear("editor-font-size");
  await app.type("editor-font-size", "16");
  await app.press("Save Font size >> nth=0");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.font_size", value: 16 });

  // The stepper saves at once and clamps to the field's range.
  await app.press("editor-tab-size-increase");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.tab_size", value: 5 });
  await app.clear("editor-tab-size");
  await app.type("editor-tab-size", "99");
  await app.submit("editor-tab-size");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.tab_size", value: 8 });
  expect(backend.settingsWrites.some(write => write.path === "editor")).toBe(false);
});

test("settings writes application toggles as leaves, never a stale whole object", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Interface language");
  await app.waitFor("Check for updates automatically");
  // Stored switches nothing reads are not drawn.
  expect(app.texts()).not.toContain("Restore windows at launch");
  expect(app.shows("telemetry")).toBe(false);

  // Another surface changes the app document after this page read it; a write
  // here must not put the old document back.
  await app.press("auto-update");
  expect(backend.settingsWrites).toContainEqual({ path: "app.auto_update", value: false });

  await app.press("nav-settings-page-workspace");
  await app.press("workspace-search");
  expect(backend.settingsWrites).toContainEqual({ path: "app.ai_experience.enable_workspace_search", value: true });
  await app.press("nav-settings-page-session-memory");
  await app.press("session-title-generation");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.ai_experience.enable_session_title_generation",
    value: false,
  });
  // Neither `app` nor `app.ai_experience` (which holds the quick-action list) is rewritten.
  expect(backend.settingsWrites.some(write => write.path === "app" || write.path === "app.ai_experience")).toBe(false);
});

test("settings preserves explicit zh-CN app.language override when writing sibling app toggles", async () => {
  const backend = createBackend({
    configs: {
      app: {
        language: "zh-CN",
        auto_update: true,
        telemetry: false,
        confirm_on_exit: true,
        restore_windows: true,
      },
    },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("OpenBitFun");
  // Works both before and after Wave 2 wires `initAppLocale()` into `App.tsx`.
  await app.press(app.shows("设置") ? "设置" : "Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("auto-update");

  // A sibling switch writes its own leaf, so the stored language is never touched.
  await app.press("auto-update");
  expect(backend.settingsWrites).toContainEqual({ path: "app.auto_update", value: false });
  expect(backend.settingsWrites.some(entry => entry.path === "app")).toBe(false);
});

test("settings switches interface language live across English, Simplified Chinese, and Traditional Chinese", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Interface language");
  await app.waitFor("Application");

  // Switch live to Simplified Chinese -> entire shell + settings repaint immediately.
  // The host keeps the language through `i18n_set_language`; no `app` document is
  // read and written back from here.
  await app.press("app-language-zh-CN");
  await app.waitFor("界面语言");
  await app.waitFor("常规");
  expect(app.shows("设置")).toBe(true);
  const languageCalls = () =>
    backend.calls
      .filter(call => call.action === "i18n_set_language")
      .map(call => (call.request as { language?: string })?.language);
  expect(languageCalls().pop()).toBe("zh-CN");

  // Switch live to Traditional Chinese -> repaints immediately with canonical zh-TW copy.
  await app.press("app-language-zh-TW");
  await app.waitFor("介面語言");
  expect(app.shows("設定")).toBe(true);
  expect(languageCalls().pop()).toBe("zh-TW");

  // Switch back to English -> restores cleanly and persists canonical en-US.
  await app.press("app-language-en-US");
  await app.waitFor("Interface language");
  await app.waitFor("Application");
  expect(languageCalls().pop()).toBe("en-US");
  expect(backend.settingsWrites.some(entry => entry.path === "app")).toBe(false);
});

test("i18n normalizes locales, translates reactively across en-US/zh-CN/zh-TW, and formats durations cleanly", async () => {
  try {
    // 1. Canonical IDs and input-boundary aliases.
    expect(SUPPORTED_LOCALES.map(entry => entry.id)).toEqual(["zh-CN", "en-US", "zh-TW"]);
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocale("zh_Hans_CN")).toBe("zh-CN");
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("zh-TW")).toBe("zh-TW");
    expect(normalizeLocale("zh-Hant")).toBe("zh-TW");
    expect(normalizeLocale("zh-HK")).toBe("zh-TW");
    expect(normalizeLocale("zh-MO")).toBe("zh-TW");
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("fr-FR")).toBeNull();

    // 2. 100% key and {{placeholder}} parity across all 3 catalogs.
    const enKeys = Object.keys(enUSMessages).sort();
    expect(Object.keys(zhCNMessages).sort()).toEqual(enKeys);
    expect(Object.keys(zhTWMessages).sort()).toEqual(enKeys);
    const extractVars = (text: string) =>
      [...new Set(Array.from(text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g), m => m[1]))].sort();
    for (const key of enKeys as Array<keyof typeof enUSMessages>) {
      const expected = extractVars(enUSMessages[key]);
      expect(extractVars(zhCNMessages[key])).toEqual(expected);
      expect(extractVars(zhTWMessages[key])).toEqual(expected);
    }

    // 3. Reactive tr() & shared product terminology across locales.
    syncLocaleFromHost("en");
    expect(currentLocale()).toBe("en-US");
    expect(tr("nav.settings")).toBe("Settings");
    expect(tr("nav.assistants")).toBe("Assistants");
    expect(tr("settings.notice.savedField", { label: "Tab size" })).toBe("Saved Tab size");
    expect(formatPlural(1, "format.resultOne", "format.resultOther")).toBe("1 result");
    expect(formatPlural(3, "format.resultOne", "format.resultOther")).toBe("3 results");

    syncLocaleFromHost("zh-Hans");
    expect(currentLocale()).toBe("zh-CN");
    expect(tr("nav.settings")).toBe("设置");
    expect(tr("nav.assistants")).toBe("助理");
    expect(tr("nav.files")).toBe("文件");
    expect(tr("settings.notice.savedField", { label: "缩进宽度" })).toBe("已保存「缩进宽度」");
    expect(formatPlural(3, "format.resultOne", "format.resultOther")).toBe("3 条结果");

    syncLocaleFromHost("zh-Hant");
    expect(currentLocale()).toBe("zh-TW");
    expect(tr("nav.settings")).toBe("設定");
    expect(tr("nav.assistants")).toBe("助理");
    expect(tr("nav.files")).toBe("檔案");
    expect(trForLocale("en-US", "nav.files")).toBe("Files");

    // 4. Locale-aware duration carry policy (never `1h 60m` or `60s`) & date/time helpers.
    syncLocaleFromHost("en-US");
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(59_500)).toBe("1m");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(7_199_500)).toBe("2h");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatMonthYear(2026, 10)).toBe("November 2026");
    expect(weekdayShortLabels(true)[0]).toBe("Mon");
    expect(formatRelativeTime(1_000_000 - 5 * 60_000, 1_000_000)).toBe("5m ago");
    expect(formatRelativeTime(1_000_000 + 2 * 3_600_000, 1_000_000)).toBe("in 2h");
    expect(formatTimestamp(Date.UTC(2026, 10, 19, 12, 30))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatBucket("2026-01-02T00:00:00Z", false)).toMatch(/^\d{2}-\d{2}$/);

    syncLocaleFromHost("zh-CN");
    expect(formatDuration(7_199_500)).toBe("2 小时");
    expect(formatDuration(5_400_000)).toBe("1 小时 30 分");
    expect(formatMonthYear(2026, 10)).toBe("2026年11月");
    expect(weekdayShortLabels(true)[0]).toBe("一");
    expect(formatRelativeTime(1_000_000 - 5 * 60_000, 1_000_000)).toBe("5 分钟前");
    expect(formatRelativeTime(1_000_000 + 2 * 3_600_000, 1_000_000)).toBe("2 小时后");
    expect(formatDate(Date.UTC(2026, 10, 19, 12, 0))).toContain("2026年");
    expect(formatTimestamp(Date.UTC(2026, 10, 19, 12, 30))).toContain("年");
    expect(formatBucket("2026-01-02T00:00:00Z", false)).toContain("月");

    // 5. setAppLocale normalizes aliases, repaints currentLocale, and notifies listeners.
    const notified: string[] = [];
    const unsub = onAppLocalePersisted(locale => notified.push(locale));
    try {
      await setAppLocale("zh-Hant", { persistHost: false });
      expect(currentLocale()).toBe("zh-TW");
      expect(tr("nav.settings")).toBe("設定");
      await setAppLocale("en", { persistHost: false });
      expect(currentLocale()).toBe("en-US");
      expect(tr("nav.settings")).toBe("Settings");
      expect(notified).toEqual(["zh-TW", "en-US"]);
    } finally {
      unsub();
    }
  } finally {
    syncLocaleFromHost("en-US");
  }
});

test("settings scene lists the configured models and appends one", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("AI models");
  await app.waitFor("Configured model");

  await app.press("add-model");
  await app.type("model-name", "Work model");
  await app.press("model-format-anthropic");
  await app.type("model-model-name", "claude-sonnet-4");
  await app.type("model-base-url", "https://api.anthropic.com");
  await app.type("model-api-key", "sk-ant-test");
  await app.press("save-model");

  await app.waitFor("Added Work model");
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop();
  expect(write?.value).toMatchObject([
    { id: "model-1", name: "Configured model" },
    {
      name: "Work model",
      provider: "anthropic",
      model_name: "claude-sonnet-4",
      base_url: "https://api.anthropic.com",
      request_url: "https://api.anthropic.com/v1/messages",
      api_key: "sk-ant-test",
      enabled: true,
      category: "general_chat",
      // The host's defaults for the category, not a copy kept by this surface.
      capabilities: ["text_chat"],
    },
  ]);
  // One typed intent, not a whole list this page read earlier.
  expect(backend.calls.filter(call => call.action === "ai_model_upsert")).toHaveLength(1);

  // Removing asks first, and says the default slot that names the model.
  await app.press("model-actions-model-1");
  await app.press("remove-model-model-1");
  await app.waitFor("Remove Configured model? 1 default slot(s) name it and will be cleared.");
  expect(backend.settingsWrites.filter(entry => entry.path === "ai.models")).toHaveLength(1);
  await app.press("id:model-delete-confirm-model-1 >> Delete");
  await app.waitFor("Removed Configured model");
  const removals = backend.settingsWrites.filter(entry => entry.path === "ai.models");
  expect((removals.pop()?.value as unknown[]).length).toBe(1);
  // The default slot that named it no longer resolves to a missing model.
  expect(backend.settingsWrites).toContainEqual({ path: "ai.default_models", value: { primary: null } });
});

test("a host older than the typed settings commands says so instead of writing whole documents", async () => {
  const backend = createBackend({ legacySettingsHost: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Configured model");
  await app.press("add-model");
  await app.type("model-name", "Work model");
  await app.type("model-model-name", "gpt-4.1-mini");
  await app.type("model-base-url", "https://api.openai.com/v1");
  await app.press("save-model");
  await app.waitFor("This host is older than this window and cannot apply this change. Update OpenBitFun on it.");
  // No fallback to the whole-list write the command replaced.
  expect(backend.settingsWrites.some(write => write.path === "ai.models")).toBe(false);

  await app.press("nav-settings-page-permissions");
  await app.waitFor("Edit rules");
  await app.press("permission-mode-auto");
  await app.waitFor("This host is older than this window and cannot apply this change. Update OpenBitFun on it.");
  expect(backend.settingsWrites.some(write => write.path === "tool_permissions")).toBe(false);
});

test("field limits and defaults come from the host's settings descriptor", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-editor");
  await app.waitFor("editor-font-size");
  const described = backend.calls.find(call => call.action === "get_settings_schema")?.request as {
    paths?: string[];
  };
  expect(described?.paths).toContain("editor.font_size");
  expect(described?.paths).toContain("memories.max_unused_days");
  // The catalog allows 32 px; the page no longer caps it at a literal of its own.
  await app.clear("editor-font-size");
  await app.type("editor-font-size", "30");
  await app.submit("editor-font-size");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.font_size", value: 30 });
});

test("an existing model opens in the form, prefilled, and saves in place", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Configured model");
  await app.press("model-actions-model-1");
  await app.press("model-edit-model-1");
  await app.waitFor("Edit Configured model");
  expect(app.value("model-model-name")).toBe("gpt-4.1-mini");
  await app.press("model-format-responses");
  await app.press("save-model");
  await app.waitFor("Saved Configured model");
  const written = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  // One entry, patched in place: fields the form does not draw stay.
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    id: "model-1",
    provider: "responses",
    request_url: "https://api.openai.com/v1/responses",
    category: "general_chat",
    api_key: "sk-configured",
  });
});

test("default models write one slot of the stored section", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Default models");
  await app.press("default-model-fast");
  await app.press("default-model-fast-model-1");
  // Only that slot's leaf is written, so no other slot can be put back.
  expect(backend.settingsWrites).toContainEqual({ path: "ai.default_models.fast", value: "model-1" });
  await app.press("default-model-fast");
  await app.press("default-model-fast-none");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.default_models.fast", value: null });
  expect(backend.settingsWrites.some(write => write.path === "ai.default_models")).toBe(false);
});

test("a configured model takes its enabled flag and its limits from this page", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Configured model");
  await app.waitFor("model-enabled-model-1");

  // Disabling is a write of the whole list with that one entry changed, so the
  // fields this page does not draw stay on the stored entry.
  await app.press("model-enabled-model-1");
  await app.waitFor("Configured model is disabled");
  const disabled = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  expect(disabled[0]).toMatchObject({ id: "model-1", enabled: false });
  expect(disabled[0].api_key).toBe("sk-configured");

  await app.press("model-actions-model-1");
  await app.press("model-limits-model-1");
  await app.type("model-context-model-1", "200000");
  await app.type("model-max-tokens-model-1", "90000");
  await app.press("model-limits-save-model-1");
  // The host owns the ceiling: it lowers an output limit above the share of the
  // window it accepts and says so; this page keeps no copy of the rule.
  await app.waitFor("Saved the limits of Configured model The output limit was lowered to what the context window allows.");
  const clamped = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  expect(clamped[0]).toMatchObject({ context_window: 200000, max_tokens: 80000 });

  // The form reopens on the stored limits; a value inside the ceiling is kept.
  await app.press("model-actions-model-1");
  await app.press("model-limits-model-1");
  expect(app.value("model-max-tokens-model-1")).toBe("80000");
  await app.clear("model-max-tokens-model-1");
  await app.type("model-max-tokens-model-1", "32000");
  await app.press("model-limits-save-model-1");
  await app.waitFor("Saved the limits of Configured model");  const limited = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  expect(limited[0]).toMatchObject({ context_window: 200000, max_tokens: 32000, enabled: false });
});

test("the model form fills itself from this machine's catalog", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Configured model");
  await app.press("add-model");
  await app.waitFor("Discover a model: pick a provider, then a model, and the form fills itself.");

  // The picker asks this machine for its own projection once, then narrows it.
  const read = backend.actions().filter(action => action === "get_local_models_dev_catalogs");
  expect(read).toHaveLength(1);
  await app.type("model-filter", "anthro");
  await app.press("model-catalog-provider-anthropic");
  await app.waitFor("Claude Sonnet 4");

  // A catalog pick carries the endpoint format, the model id and both limits, so
  // the form does not have to be typed twice.
  await app.press("model-catalog-model-claude-sonnet-4");
  await app.press("save-model");
  await app.waitFor("Added Anthropic");
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  expect(write[1]).toMatchObject({
    name: "Anthropic",
    provider: "anthropic",
    model_name: "claude-sonnet-4",
    base_url: "https://api.anthropic.com/v1",
    context_window: 200000,
    max_tokens: 8000,
  });
});

test("a host without a model catalog still takes a model by hand", async () => {
  // A build predating the picker has no such command; the form must stay usable.
  const backend = createBackend({ modelCatalog: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Configured model");
  await app.press("add-model");
  await app.waitFor("Base URL");
  expect(app.texts().some(text => text.startsWith("Discover a model"))).toBe(false);

  await app.type("model-name", "Hand written");
  await app.type("model-model-name", "gpt-4.1-mini");
  await app.type("model-base-url", "https://api.openai.com/v1");
  await app.press("save-model");
  await app.waitFor("Added Hand written");
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  // No limits typed means no limits stored, not zeroes the host would reject.
  expect(write[1]).toMatchObject({ name: "Hand written", context_window: null, max_tokens: null });
});

test("the search field answers with sessions, messages and files, and runs what it lists", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("global-search-trigger");
  await app.press("global-search-trigger");
  // An empty field lists the commands, which is what `>` is for.
  await app.waitFor("Go to Files");
  expect(app.texts()).toContain("Commands");

  await app.type("global-search-input", "terminal");
  await app.waitFor("Terminal migration");
  // A session-name hit, a message hit from the host and a file hit from
  // `search_files` are grouped by kind rather than merged into one list.
  await app.waitFor("Terminal is wired to terminal_create.");
  expect(app.texts()).toContain("Messages");
  // Every opened workspace is asked once, the active one first.
  const searched = backend.calls.filter(call => call.action === "search_session_content");
  expect(searched).toHaveLength(2);
  expect(searched[0].request).toMatchObject({ workspaceId: "workspace-1", query: "terminal" });
  expect(searched[1].request).toMatchObject({ workspaceId: "workspace-2", query: "terminal" });

  // Running a session hit closes the panel and opens that session.
  await app.press("label:global-search-item-session:session-2");
  await app.waitFor("Terminal migration");
  expect(app.texts().some(text => text === "Commands")).toBe(false);

  // A command query stays inside this surface and switches the scene.
  await app.press("global-search-trigger");
  await app.type("global-search-input", ">files");
  await app.waitFor("Go to Files");
  await app.press("label:global-search-item-command:files");
  await app.waitFor("Select a file to preview");
});

test("a host without message search still answers the other sources", async () => {
  const backend = createBackend({ sessionSearch: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("global-search-trigger");
  await app.type("global-search-input", "terminal");
  // The session-name hit still arrives, and the refused source is named instead
  // of the whole search failing.
  await app.waitFor("Session · 9 messages");
  expect(
    app.texts().some(text => text.startsWith("Some sources did not answer:")),
  ).toBe(true);
  expect(app.texts()).not.toContain("Messages");
});

test("stored key bindings are shown, not edited", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-input");
  await app.waitFor("Keyboard shortcuts");
  // The count is the host's document; this surface has no shortcut registry, so
  // the row states that instead of offering an editor that would change nothing.
  await app.waitFor("2 overrides stored");
  expect(
    app.texts().some(text =>
      text.includes("Managed in the desktop app shortcut registry; stored overrides are shown read-only here."),
    ),
  ).toBe(true);
  expect(backend.settingsWrites.filter(entry => entry.path.startsWith("app.keybindings"))).toHaveLength(0);
});

test("session memory takes its models and its window from this page", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("Session memory");
  await app.waitFor("Model that extracts memories");

  // A configured model is written to its own leaf, so the fields this page does
  // not draw stay where they were.
  await app.press("memory-extract-model");
  await app.press("memory-extract-model-model-1");
  await app.waitFor("Saved Model that extracts memories");
  expect(backend.settingsWrites).toContainEqual({ path: "memories.extract_model", value: "model-1" });

  // "Follow" is a null, not an empty string the host would read as a model id.
  await app.press("memory-extract-model");
  await app.press("memory-extract-model-inherit");
  expect(backend.settingsWrites).toContainEqual({ path: "memories.extract_model", value: null });
  expect(backend.settingsWrites.some(entry => entry.path === "memories")).toBe(false);

  // A rollout window that outlives the retention is refused with the reason, and
  // nothing is written: the host would reject the pair as well.
  const before = backend.settingsWrites.length;
  await app.clear("memory-max-unused-days");
  await app.type("memory-max-unused-days", "5");
  await app.press("memory-max-unused-days-save");
  await app.waitFor(
    "The extraction window cannot be longer than the retention window: raise the retention first",
  );
  expect(backend.settingsWrites).toHaveLength(before);

  // A window above the retention is the host's refusal too; one inside it saves.
  expect(app.texts().some(text => text.includes("older than"))).toBe(true);
  await app.clear("memory-max-unused-days");
  await app.clear("memory-rollout-age-days");
  await app.type("memory-rollout-age-days", "40");
  await app.press("memory-rollout-age-days-save");
  expect(backend.settingsWrites.some(entry => entry.path === "memories.max_rollout_age_days")).toBe(false);
  await app.clear("memory-rollout-age-days");
  await app.type("memory-rollout-age-days", "30");
  await app.press("memory-rollout-age-days-save");
  await app.waitFor("Saved Extract from sessions no older than (days)");
  expect(backend.settingsWrites).toContainEqual({ path: "memories.max_rollout_age_days", value: 30 });
});

test("a connected MCP server's resources are browsed and read through the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("Filesystem · fs-server");
  await app.press("mcp-resources-fs-server");
  await app.waitFor("Resources of fs-server");
  await app.waitFor("Team notes");

  // The first read is the initial list; a refresh asks the server again instead of
  // trusting what it answered before.
  const lists = backend.calls.filter(call => call.action === "list_mcp_resources");
  expect(lists).toHaveLength(1);
  expect(lists[0].request).toMatchObject({ serverId: "fs-server", refresh: false });
  await app.press("mcp-resources-refresh");
  await app.waitFor("Resources of fs-server");
  const refreshed = backend.calls.filter(call => call.action === "list_mcp_resources");
  expect(refreshed).toHaveLength(2);
  expect(refreshed[1].request).toMatchObject({ serverId: "fs-server", refresh: true });

  // One text resource: the body is drawn with its media type.
  await app.press("mcp-resource-0");
  await app.waitFor("Team notes · text/markdown");
  await app.waitFor("[text/markdown]\n\n# Notes\n\nHello from the server.");
  // Several contents name themselves, so two blocks stay distinguishable.
  await app.press("mcp-resource-1");
  await app.waitFor("Config · application/json");
  expect(app.texts().some(text => text.includes("second block"))).toBe(true);
  expect(app.texts().some(text => text.includes("#1 memo://config (application/json)"))).toBe(true);
  // A blob is reported as binary instead of being decoded into noise.
  await app.press("mcp-resource-2");
  await app.waitFor("Logo · image/png");
  expect(
    app.texts().some(text => text.includes("Binary content: this resource is not text, so it is not shown here.")),
  ).toBe(true);

  // The filter narrows the list without another read.
  await app.type("mcp-resources-filter", "config");
  await app.waitFor("text:memo://config · application/json");
  expect(app.texts()).not.toContain("memo://logo · image/png");
  expect(backend.calls.filter(call => call.action === "list_mcp_resources")).toHaveLength(2);

  await app.press("mcp-resources-close");
  expect(app.texts().some(text => text.startsWith("Resources of"))).toBe(false);
});

test("settings creates a model pool the host keeps, and deletes it", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("Model pools");
  await app.waitFor("No pool yet.");

  await app.press("add-pool");
  await app.type("model-pool-name", "Fast fallbacks");
  // The members are the configured models' own ids, as the desktop editor stores them.
  await app.press("pool-toggle-model-1");
  // The member list is the draft, so the press has to show there before the save.
  await app.waitFor("Members, in order (1)");
  await app.press("save-pool");

  await app.waitFor("Saved Fast fallbacks");
  const save = backend.calls.find(call => call.action === "save_model_pool")?.request;
  expect(save).toMatchObject({
    pool: { id: "", name: "Fast fallbacks", strategy: "ordered", member_model_ids: ["model-1"] },
  });
  // The row drawn is the host's document, not the draft this surface just typed.
  await app.waitFor("Ordered · 1 members");

  // Editing an existing pool starts from what the host holds for it.
  await app.press("pool-actions-pool-1");
  await app.press("edit-pool-pool-1");
  await app.waitFor("Members, in order (1)");
  await app.press("Cancel");

  await app.press("check-pool-pool-1");
  const statusCalls = await waitForCalls(backend, "get_model_pool_status");
  expect(statusCalls[0]?.request).toMatchObject({ poolId: "pool-1" });
  await app.waitFor("text:model-1: cooling_down (rate limited)");

  await app.press("pool-actions-pool-1");
  await app.press("delete-pool-pool-1");
  expect(backend.calls.find(call => call.action === "delete_model_pool")?.request).toMatchObject({
    poolId: "pool-1",
  });
  await app.waitFor("No pool yet.");
});

test("the devices list hides a device and keeps the arrangement in app storage", async () => {
  const backend = createDeviceBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // A preference file the React surface wrote: this app must read the same shape.
    storage: {
      "openbitfun.device-order.v1": JSON.stringify({ state: { order: ["device-linux"] }, version: 0 }),
    },
  });

  await app.press("Devices");
  await app.waitFor("Studio");
  // The stored order wins over the default (local device first). Read the device list only:
  // the navigation panel has a "Studio" group label of its own.
  const shown = app.texts();
  const names = shown
    .slice(Math.max(0, shown.indexOf("Your devices")))
    .filter(text => text === "Studio" || text === "builder");
  expect(names[0]).toBe("builder");

  await app.press("device-actions-device-linux");
  await app.press("device-hide-device-linux");
  await app.waitFor("Hidden 1");
  expect(app.texts()).not.toContain("builder");

  await app.press("toggle-hidden-devices");
  await app.waitFor("builder");
  // A listed device that is hidden says how to bring it back.
  await app.press("device-actions-device-linux");
  await app.waitFor("Show");
  await app.press("device-hide-device-linux");
  await app.press("device-actions-device-linux");
  await app.waitFor("Hide");
  await app.press("device-actions-device-linux");
  expect(app.texts()).not.toContain("Hidden 1");
});

test("devices scene reports inventory and presence", async () => {
  const backend = createDeviceBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Studio");
  const texts = app.texts().join("\n");
  expect(texts).toContain("Studio");
  expect(texts).toContain("builder");
  expect(texts).toContain("online");
  expect(texts).toContain("offline");
  // Peer Device Mode is offered on a reachable device, and the scene says what it does.
  expect(texts).toContain("Driving another device");
  expect(texts).toContain("Press Use on an online device");
});

test("answering a question while driving another device reaches that device", async () => {
  const backend = createDeviceBackend({
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");
  await app.press("Sessions");
  await app.press("peer session on device-linux >> nth=0");
  // The mailbox is the peer's, so it is read over the same Device RPC.
  expect(backend.peerInvocations.map(call => call.action)).toContain("get_session_interaction_mailbox");

  await app.host.send("openbitfun.event", {
    event: "backend-event-toolawaitinguserinput",
    payload: {
      toolId: "tool-peer-q",
      sessionId: "device-linux-session",
      questions: {
        questions: [
          {
            question: "Restart the service?",
            header: "Restart",
            multiSelect: false,
            options: [{ label: "Yes", description: "" }, { label: "No", description: "" }],
          },
        ],
        responseHostNowMs: 1,
        responseDeadlineMs: 0,
      },
    },
  });
  await app.waitFor("Restart: Restart the service?");
  await app.press("question-tool-peer-q-0-Yes");
  await app.press("Send answer");

  // The answer must reach the host that owns the waiting tool future, and it
  // travels as positional arguments rather than inside a `request` struct.
  const submitted = backend.peerInvocations.find(call => call.action === "submit_user_answers");
  expect(submitted?.args).toMatchObject({
    toolId: "tool-peer-q",
    answers: { "0": "Yes" },
    sessionId: "device-linux-session",
  });
  expect(submitted?.args.request).toBeUndefined();
  // Nothing was answered on this machine instead.
  expect(backend.userAnswers).toEqual([]);
});

test("driving another device routes product commands through the peer transport", async () => {
  const backend = createDeviceBackend({
    // device-mac is this machine; the second device answers.
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");

  // The handshake and the control link reach the target through Device RPC, and
  // the peer's own workspace replaces the one this machine listed.
  await app.waitFor("Driving builder (desktop): sessions, files, terminals and settings come from that device");
  const rpcs = backend.calls.filter(call => call.action === "account_device_rpc");
  const commands = rpcs.map(call => JSON.parse(String((call.request as Record<string, unknown>).commandJson)).command);
  expect(commands.slice(0, 2)).toEqual(["peer_mode_ping", "peer_control_attach"]);
  expect(rpcs.map(call => (call.request as Record<string, unknown>).targetDeviceId)).toContain("device-linux");
  await app.waitFor("peer workspace on device-linux");
  // Product traffic goes to the peer; account and relay calls stay here, which
  // is why none of them appear inside the Device RPC envelopes.
  expect(commands).toContain("get_opened_workspaces");
  expect(commands).toContain("list_persisted_sessions_page");
  expect(commands.some(command => String(command).startsWith("account_"))).toBe(false);

  // A relay can drop the peer without either side asking, so the banner can run
  // the handshake again rather than making the user leave and re-enter.
  await app.press("reconnect-peer");
  const afterReconnect = backend.calls
    .filter(call => call.action === "account_device_rpc")
    .map(call => JSON.parse(String((call.request as Record<string, unknown>).commandJson)).command);
  expect(afterReconnect.filter(command => command === "peer_mode_ping")).toHaveLength(2);
  expect(afterReconnect.filter(command => command === "peer_control_attach")).toHaveLength(2);

  await app.press("leave-peer");
  await app.waitFor("OpenBitFun");
  const afterDetach = backend.calls.filter(call => call.action === "account_device_rpc");
  const detach = JSON.parse(String((afterDetach[afterDetach.length - 1].request as Record<string, unknown>).commandJson));
  expect(detach.command).toBe("peer_control_detach");
  // Back on this machine, so its own workspace is listed again.
  expect(app.texts()).not.toContain("peer workspace on device-linux");
});

test("a peer without the queue or the send command is told to update; nothing waits here", async () => {
  const backend = createDeviceBackend({
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
    // A host that never states the queue capability: nothing may be submitted to it.
    peerCapabilities: { cancel_tool: true },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("Driving builder (desktop): sessions, files, terminals and settings come from that device");

  await app.press("Sessions");
  await app.waitFor("peer session on device-linux");
  await app.press("peer session on device-linux >> nth=0");
  await app.waitFor("Message");

  // The banner offers the handshake again without leaving peer mode.
  await app.waitFor("Reconnect");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "device-linux-session", turnId: "turn-1" },
  });
  await app.waitFor("Steer running turn…");
  await app.waitFor("builder has no message queue. Update OpenBitFun there to queue messages during a turn.");
  await app.type("composer", "Queue this here");
  await app.press("Queue");
  // The older peer has no `submit_user_message`: the message stays in the
  // composer with an explicit notice instead of a local list.
  await app.waitFor("send-host-update");
  expect(app.value("composer")).toBe("Queue this here");

  const peerCommands = backend.calls
    .filter(call => call.action === "account_device_rpc")
    .map(call => JSON.parse(String((call.request as Record<string, unknown>).commandJson)))
    .map((envelope: { command?: string; args?: { request?: { action?: string } } }) =>
      envelope.command === "manage_dialog_queue" ? `queue:${envelope.args?.request?.action}` : envelope.command);
  expect(peerCommands.filter(command => String(command).startsWith("queue:submit"))).toEqual([]);
  expect(peerCommands).toContain("submit_user_message");
  expect(app.storage()["openbitfun.nsh.pending-queue.v1"]).toBeUndefined();
});

test("devices scene saves an alias through the account command", async () => {
  const backend = createDeviceBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Studio");
  await app.press("device-actions-device-mac");
  await app.press("device-rename-device-mac");
  await app.type("device-alias", "Studio Mac");
  await app.press("Save");
  expect(backend.calls.find(call => call.action === "account_update_device_alias")?.request).toMatchObject({
    device_id: "device-mac",
    device_alias: "Studio Mac",
  });
});

test("terminal scene creates a host session", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Terminal");
  await app.waitFor("running");
  expect(backend.actions()).toContain("terminal_create");
  const createCall = backend.calls.find(call => call.action === "terminal_create");
  // The shell starts at the view's measured size (120 x 32 before the view reports one).
  const size = createCall?.request as { cols?: number; rows?: number };
  expect((size.cols ?? 0) > 0 && (size.rows ?? 0) > 0).toBe(true);
  // A reattached view replays what the shell already printed before live output.
  expect(backend.actions()).toContain("terminal_get_history");
  expect(backend.calls.find(call => call.action === "terminal_get_history")?.request).toMatchObject({
    sessionId: "terminal-1",
  });

  // The host streams the shell's bytes as `terminal_event` Data for this session.
  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "Data", payload: { session_id: "terminal-1", data: "ls\r\n" } },
  });
  expect(app.texts().join("\n")).not.toContain("simulated backend has no answer");
});

test("the terminal starts the shell the picker chose, and remembers it", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // The shell a previous run of this surface selected.
    storage: { "openbitfun.nsh.terminal-shell.v1": "shell-zsh" },
  });

  await app.press("Terminal");
  await app.waitFor("Shell: zsh");
  const firstShell = backend.calls.filter(call => call.action === "terminal_create").pop();
  expect(firstShell?.request).toMatchObject({ shellId: "shell-zsh", shellType: "Zsh" });

  await app.press("shell-picker");
  await app.waitFor("Shell: bash");
  // A shell the host reports as unavailable is not offered.
  expect(app.texts()).not.toContain("fish");
  expect(app.texts()).not.toContain("Shell: fish");
  await app.press("shell-option-shell-bash");

  await app.waitFor("Shell: bash");
  await app.press("New shell");
  const created = backend.calls.filter(call => call.action === "terminal_create").pop();
  expect(created?.request).toMatchObject({ shellId: "shell-bash", shellType: "Bash" });
});

test("terminal tabs keep their own shell and switch without losing output", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Terminal");
  await app.waitFor("shell 1");

  await app.press("New shell");
  await app.waitFor("shell 2");
  expect(backend.actions()).toContain("terminal_create");
  // The second shell is the one on screen, so its bytes are the ones that arrive.
  const created = backend.calls.filter(call => call.action === "terminal_create");
  expect(created.length).toBe(2);

  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "Data", payload: { session_id: "terminal-2", data: "second\r\n" } },
  });
  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "Data", payload: { session_id: "terminal-1", data: "first\r\n" } },
  });

  // A background shell does not draw into the view of the foreground one.
  expect(app.texts().join("\n")).not.toContain("first");

  await app.press("shell 1");
  await app.waitFor("shell 1");
  // Closing a running shell asks first; confirming closes its host session and
  // falls back to the other one.
  await app.press("× >> nth=0");
  await app.waitFor("Close shell");
  expect(backend.actions()).not.toContain("terminal_close");
  await app.press("Close shell");
  await app.waitUntil(() => backend.actions().includes("terminal_close"));
  await app.waitFor("shell 2");
});

test("a shell's title follows its program, while a named tab keeps its name", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    storage: {
      "openbitfun.nsh.terminal-profiles.v1": JSON.stringify({
        "/repo": [{ id: "p1", name: "Dev server", shellId: "shell-bash", shellType: "Bash", startupCommand: "" }],
      }),
    },
  });

  await app.press("Terminal");
  await app.waitFor("shell 1");

  // The host reports the title the program in the shell set for itself.
  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "TitleChanged", payload: { session_id: "terminal-1", title: "vim notes.md" } },
  });
  await app.waitFor("vim notes.md");

  // A tab the user named is not renamed by whatever runs in it.
  await app.press("profiles-toggle");
  await app.press("Open Dev server");
  await app.waitFor("Dev server");
  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "TitleChanged", payload: { session_id: "terminal-2", title: "pnpm" } },
  });
  await app.waitFor("Dev server");
  expect(app.texts()).not.toContain("pnpm");
});

test("a saved terminal profile reopens its shell with its startup command", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Terminal");
  await app.waitFor("shell 1");

  // A profile names the shell the picker has selected, not the host's default.
  await app.press("shell-picker");
  await app.press("shell-option-shell-bash");
  await app.waitFor("Shell: bash");

  await app.press("profiles-toggle");
  await app.waitFor("No saved profile yet; the form below saves the first one.");
  await app.type("profile-command", "pnpm run dev");
  await app.press("profile-save");
  await app.waitFor("Saved Terminal 1");
  // Saving a profile is this surface's own record: nothing reached the host.
  expect(backend.actions()).not.toContain("terminal_write");

  // The saved profile is listed, and opening it starts its shell.
  await app.waitFor("Open Terminal 1");
  await app.press("Open Terminal 1");
  const created = backend.calls.filter(call => call.action === "terminal_create").pop();
  expect(created?.request).toMatchObject({ shellId: "shell-bash", shellType: "Bash" });
  // The startup command is typed into the new shell, newline included.
  const written = backend.calls.filter(call => call.action === "terminal_write").pop();
  expect(written?.request).toMatchObject({ sessionId: "terminal-2", data: "pnpm run dev\r" });

  await app.press("profiles-toggle");
  await app.press("profile-delete-Terminal 1");
  await app.waitFor("Profile deleted");
  // The list is this workspace's own record, not the host's.
  expect(app.storage()["openbitfun.nsh.terminal-profiles.v1"]).not.toContain("Terminal 1");
});

test("a profile a previous run saved is offered again", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    storage: {
      "openbitfun.nsh.terminal-profiles.v1": JSON.stringify({
        "/repo": [
          { id: "p1", name: "Dev server", shellId: "shell-zsh", shellType: "Zsh", startupCommand: "pnpm run dev" },
          // A malformed record from a hand-edited file is skipped, not fatal.
          { id: "p2", name: "" },
        ],
      }),
    },
  });

  await app.press("Terminal");
  await app.waitFor("shell 1");
  await app.press("profiles-toggle");
  await app.waitFor("Open Dev server");
  expect(app.texts()).toContain("Profiles 1");

  await app.press("Open Dev server");
  await app.waitFor("Dev server");
  const written = backend.calls.filter(call => call.action === "terminal_write").pop();
  expect(written?.request).toMatchObject({ data: "pnpm run dev\r" });
});

test("settings assigns a model to a product task, in the shape the host reads", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("Task models");
  // The seeded section is in the shape an earlier build of this surface wrote
  // (`{"Fixed":…}` / `"Inherit"`); it still reads, and the model is shown by
  // name, not by id.
  await app.waitFor("Configured model · gpt-4.1-mini");
  await app.waitFor("inherits the session's model");

  await app.press("task-model-git_commit");
  await app.press("task-model-choice-git_commit-model-1");
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.task_models").pop();
  // `TaskModelSelection` is `serde(tag = "kind", rename_all = "snake_case")`.
  expect(write?.value).toEqual({
    session_title: { kind: "fixed", model_id: "model-1" },
    git_commit: { kind: "fixed", model_id: "model-1" },
  });

  await app.press("task-model-session_title");
  await app.press("task-model-inherit-session_title");
  const cleared = backend.settingsWrites.filter(entry => entry.path === "ai.task_models").pop();
  expect(cleared?.value).toEqual({
    session_title: { kind: "inherit" },
    git_commit: { kind: "fixed", model_id: "model-1" },
  });
});

test("settings exposes the AI execution scalars the host reconciles", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-execution");
  await app.waitFor("AI execution");
  await app.press("deferred-tool-loading");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.enable_deferred_tool_loading", value: false });

  // A select writes the value the host's enum deserializes.
  await app.press("tool-presentation-mode");
  await app.press("tool-presentation-mode-ptc_python");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.tool_presentation_mode", value: "ptc_python" });

  await app.clear("subagent-concurrency");
  await app.type("subagent-concurrency", "8");
  await app.press("Save Parallel subagents >> nth=0");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.subagent_max_concurrency", value: 8 });

  // A timeout the host keeps as `Option` clears to null ("no limit").
  await app.press("user-question-timeout-clear");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.user_question_timeout_secs", value: null });
});

test("settings reads the permission policy and writes the mode back as the desktop does", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Permissions");
  await app.waitFor(
    "1 rule in force. Global rules apply to every workspace; project and agent rules can still override them.",
  );
  await app.waitFor("Composer switch on");

  // Auto approves through a model: the strategy is what selects it.
  await app.press("permission-mode-auto");
  const auto = backend.settingsWrites.filter(entry => entry.path === "tool_permissions").pop();
  expect(auto?.value).toMatchObject({
    policy: { preset: "ask", rules: [{ action: "run_command", resource: "git status", effect: "allow" }] },
    interaction: { auto_approve_ask: true },
    approval: { strategy: "model", chat_model_id: "fast" },
  });

  // Full access asks once more before it is applied, and keeps the rules.
  await app.press("permission-mode-full_access");
  expect(backend.settingsWrites.filter(entry => entry.path === "tool_permissions").length).toBe(1);
  await app.waitFor(
    "Full access runs every tool call without asking, including commands that change this machine.",
  );
  await app.press("confirm-full-access");
  const full = backend.settingsWrites.filter(entry => entry.path === "tool_permissions").pop();
  expect(full?.value).toMatchObject({
    policy: { preset: "full_access", rules: [{ resource: "git status" }] },
    interaction: { auto_approve_ask: false },
    // The approval model chosen for `auto` stays on the record, as the desktop keeps it.
    approval: { strategy: "interactive", chat_model_id: "fast" },
  });

  await app.press("permission-mode-control");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.flow_chat.show_permission_mode_control",
    value: false,
  });
});

test("the rule editor and automatic approval write the policy document the desktop owns", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Edit rules");

  // A draft is a copy: adding and reordering changes nothing until it is saved.
  await app.press("edit-permission-rules");
  await app.waitFor("Global tool permission rules");
  await app.press("add-permission-rule");
  await app.type("permission-rule-rule-2-resource", "workspace/*");
  await app.press("permission-rule-rule-2-effect-deny");
  await app.press("permission-rule-rule-2-up");
  expect(backend.settingsWrites.some(write => write.path === "tool_permissions")).toBe(false);
  await app.press("discard-permission-rules");
  await app.waitFor("Edit rules");
  expect(backend.settingsWrites.some(write => write.path === "tool_permissions")).toBe(false);

  // Saving writes the list in the drawn order, with the rest of the document kept.
  await app.press("edit-permission-rules");
  await app.press("add-permission-rule");
  await app.type("permission-rule-rule-2-resource", "workspace/*");
  await app.press("permission-rule-rule-2-effect-deny");
  await app.press("permission-rule-rule-2-up");
  await app.press("save-permission-rules");
  const saved = backend.settingsWrites.filter(write => write.path === "tool_permissions").pop();
  expect(saved?.value).toMatchObject({
    policy: {
      preset: "ask",
      rules: [
        { action: "*", resource: "workspace/*", effect: "deny" },
        { action: "run_command", resource: "git status", effect: "allow" },
      ],
    },
    interaction: { auto_approve_ask: false },
    approval: { strategy: "interactive" },
  });

  // The save is rule intents (an append, then a move into the drawn order), each
  // naming the rule it expects at its index.
  const ruleCalls = backend.calls.filter(call => call.action === "upsert_permission_rule");
  expect(ruleCalls.map(call => call.request)).toEqual([
    { rule: { action: "*", resource: "workspace/*", effect: "deny" } },
    { index: 1, expected: { action: "*", resource: "workspace/*", effect: "deny" }, moveTo: 0 },
  ]);

  // An empty resource is refused by the host and nothing is written.
  const writesBefore = backend.settingsWrites.filter(write => write.path === "tool_permissions").length;
  await app.press("edit-permission-rules");
  await app.press("add-permission-rule");
  await app.press("save-permission-rules");
  await app.waitFor("Every rule needs a resource, for example workspace/*");
  expect(backend.settingsWrites.filter(write => write.path === "tool_permissions").length).toBe(writesBefore);
});

test("automatic approval picks a model, its fallbacks, and the decision model key", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Automatic approval");
  // The settings only matter in Auto, and the section says so where they are absent.
  await app.waitFor(
    "Choose Auto above to let a model assess tool calls; these settings decide how it does that.",
  );
  await app.press("permission-mode-auto");

  // The workspace's primary role and the configured model are both offered.
  await app.press("approval-model-model-1");
  const byModel = backend.settingsWrites.filter(write => write.path === "tool_permissions").pop();
  expect(byModel?.value).toMatchObject({
    approval: { strategy: "model", model_kind: "chat", chat_model_id: "model-1" },
  });
  await app.press("approval-model-primary");
  const byRole = backend.settingsWrites.filter(write => write.path === "tool_permissions").pop();
  expect(byRole?.value).toMatchObject({ approval: { chat_model_id: "primary" } });

  // Timeouts clamp to what the host accepts, and the fallbacks are stored as enums.
  await app.type("approval-timeout", "600");
  await app.press("save-approval-timeout");
  const timeout = backend.settingsWrites.filter(write => write.path === "tool_permissions").pop();
  expect(timeout?.value).toMatchObject({ approval: { timeout_ms: 300000 } });
  await app.press("approval-on-ask-reject");
  await app.press("approval-on-error-reject");
  const fallbacks = backend.settingsWrites.filter(write => write.path === "tool_permissions").pop();
  expect(fallbacks?.value).toMatchObject({ approval: { on_ask: "reject", on_error: "reject" } });

  // The hosted decision model keeps its name and endpoint as their own config leaves.
  await app.press("approval-kind-decision");
  await app.waitFor("approval-decision-name");
  await app.type("approval-decision-name", "systemone-v2");
  await app.type("approval-decision-endpoint", "https://api.example/v1/systemone");
  await app.press("save-approval-decision");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.decision_model.model_name", value: "systemone-v2" });
  expect(backend.settingsWrites).toContainEqual({
    path: "ai.decision_model.endpoint",
    value: "https://api.example/v1/systemone",
  });

  // Its key goes to the vault, never to the config file.
  await app.type("approval-decision-secret", "sk-decision");
  await app.press("save-approval-decision-key");
  expect(backend.decisionKeyWrites).toEqual(["sk-decision"]);
  expect(
    backend.settingsWrites.some(write => JSON.stringify(write.value ?? "").includes("sk-decision")),
  ).toBe(false);
  await app.press("clear-approval-decision-key");
  expect(backend.decisionKeyClears()).toBe(1);
});

test("devices scene dispatches a job to another host and lists the controller index", async () => {
  const backend = createBackend({
    dispatchJob: {
      jobId: "job-old",
      sessionId: "session-old",
      target: { kind: "ssh", connectionId: "conn-1", displayName: "build-box" },
      workspacePath: "/srv/api",
      promptPreview: "Upgrade the lockfile",
      lastState: "running",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:01:00Z",
    },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Detached dispatch");
  await app.waitFor("running");
  await app.waitFor("Upgrade the lockfile · build-box");

  await app.press("dispatch-form-toggle");
  // The first remote target is preselected, so a job never defaults to this machine.
  await app.waitFor("build-box (ssh)");
  await app.waitFor("/path/on/that/host");
  await app.type("dispatch-workspace", "/srv/api");
  await app.type("dispatch-prompt", "Fix the flaky test");
  await app.press("dispatch-approval-reject-and-report");
  await app.press("dispatch-submit");

  const submitted = backend.submittedDispatch() as Record<string, unknown>;
  expect(submitted).toMatchObject({
    target: { kind: "ssh", connectionId: "conn-1", workspacePath: "/srv/api" },
    agentType: "Standard",
    prompt: "Fix the flaky test",
    // A detached job may wait for nobody, so the policy has to be explicit.
    approvalPolicy: "reject-and-report",
  });
  expect(String(submitted.jobId)).toMatch(/^job-/);
  expect(String(submitted.sessionId)).toMatch(/^session-/);

  await app.press("dispatch-cancel-job-old");
  expect(backend.cancelledJobs).toEqual(["job-old"]);
});

test("an observed job replays the target log, answers a permission and steers the turn", async () => {
  const backend = createBackend({
    dispatchJob: {
      jobId: "job-live",
      sessionId: "session-live",
      target: { kind: "ssh", connectionId: "conn-1", displayName: "build-box" },
      workspacePath: "/srv/api",
      promptPreview: "Upgrade the lockfile",
      title: "Lockfile upgrade",
      lastState: "running",
    },
    // The target's whole log for this turn: text arrives in chunks and one tool
    // call sits between them. Nothing here ends the turn.
    dispatchEvents: [
      { type: "jobState", timestamp: "2026-01-01T00:00:00Z", state: "running" },
      { type: "agentEvent", timestamp: "2026-01-01T00:00:01Z", event: { type: "TextChunk", text: "Reading " } },
      { type: "agentEvent", timestamp: "2026-01-01T00:00:02Z", event: { type: "TextChunk", text: "the lockfile." } },
      {
        type: "agentEvent",
        timestamp: "2026-01-01T00:00:03Z",
        event: {
          type: "ToolEvent",
          tool_event: { event_type: "Started", tool_id: "call-1", tool_name: "read_file" },
        },
      },
    ],
    dispatchPermissions: [
      {
        requestId: "perm-9",
        sessionId: "session-live",
        agentId: "standard",
        action: "run_command",
        resources: ["cargo update"],
        source: "agent",
      },
    ],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Lockfile upgrade · build-box");
  await app.press("dispatch-observe-job-live");

  // One page of the target's log: the state, the text chunks folded into one
  // line, and the tool call as its own row.
  await app.waitFor("Observed job");
  await app.waitFor("Reading the lockfile.");
  await app.waitFor("read_file · Started");
  await app.waitFor("Permission: run_command");
  await app.waitFor("cargo update");

  await app.press("dispatch-permission-once-perm-9");
  expect(backend.dispatchAnswers).toEqual([
    { jobId: "job-live", requestId: "perm-9", reply: "once" },
  ]);

  // The turn is still running, so the composer steers it and never starts a turn.
  await app.type("dispatch-observe-message", "also bump the toolchain");
  await app.press("dispatch-observe-send");
  expect(backend.dispatchAppends).toEqual([
    { jobId: "job-live", content: "also bump the toolchain" },
  ]);
  expect(backend.dispatchContinues).toEqual([]);
  await app.waitFor("also bump the toolchain");
});

test("a finished job takes the next turn and hands its work back", async () => {
  const backend = createBackend({
    dispatchJob: {
      jobId: "job-done",
      sessionId: "session-done",
      target: { kind: "ssh", connectionId: "conn-1", displayName: "build-box" },
      workspacePath: "/srv/api",
      promptPreview: "Upgrade the lockfile",
      title: "Lockfile upgrade",
      lastState: "succeeded",
    },
    dispatchEvents: [{ type: "jobState", timestamp: "2026-01-01T00:00:00Z", state: "succeeded" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Lockfile upgrade · build-box");
  await app.press("dispatch-observe-job-done");
  await app.waitFor("Sync result");

  // A finished turn cannot be steered: the same composer starts the next one.
  await app.type("dispatch-observe-message", "now run the tests");
  await app.press("dispatch-observe-send");
  expect(backend.dispatchAppends).toEqual([]);
  expect(backend.dispatchContinues.length).toBe(1);
  expect(backend.dispatchContinues[0]).toMatchObject({ jobId: "job-done", prompt: "now run the tests" });
  expect(backend.dispatchContinues[0].turnId).toMatch(/^turn-/);

  await app.press("dispatch-observe-sync");
  expect(backend.dispatchSyncs).toEqual(["job-done"]);
});

test("external agents report why a client cannot run, and the document is written whole", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-external-agents");
  await app.waitFor("External agents");
  // A running client and one whose adapter is missing, each with its own state.
  await app.waitFor("OpenCode · opencode");
  await app.waitFor("opencode acp · running");
  await app.waitFor("Codex CLI · codex");
  await app.waitFor("npx --yes @agentclientprotocol/codex-acp@latest · missing codex-acp");
  await app.waitFor("The codex-acp adapter is not installed");

  // The install action goes through the raw path's command, and the probe is
  // re-read afterwards so the row can change.
  await app.press("acp-install-codex");
  expect(backend.acpInstalls).toEqual(["codex"]);

  // The stored document is written whole, and the write takes the text as a
  // positional argument (the fixture refuses anything else).
  await app.press("acp-json-toggle");
  await app.waitFor("Save JSON");
  await app.press("acp-json-save");
  await waitForCalls(backend, "save_acp_json_config");
  expect(backend.acpSaves[0]).toContain("acpClients");

  await app.type("acp-json", '{"acpClients":{"codex":{"enabled":true}}}');
  await app.press("acp-json-save");
  await waitForCalls(backend, "save_acp_json_config", 2);
  expect(backend.acpSaves[1]).toContain("codex");
});

test("a host without ACP commands hides the external-agents section", async () => {
  const backend = createBackend({ acpClients: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-external-agents");
  // The page says why it is empty instead of drawing an empty list.
  await app.waitFor("This host does not offer external agents.");
  expect(app.shows("acp-json-toggle")).toBe(false);
});

test("usage draws the host's totals for the chosen range", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("Usage");
  await app.waitFor("42 requests · 120K tokens");
  await app.waitFor("90.0K in · 30.0K out · 40.0K cached · 5.0K cache writes");
  await app.waitFor("Cache hit rate 50.0%");
  await app.waitFor("2 failed · 1 without usage data");
  await app.waitFor("primary-large · openai");
  await app.waitFor("30 req · 100K tokens");
  await app.waitFor("cache 50%");

  // The range decides the bucketing the host is asked for; the fixed activity
  // window below it asks for days whatever the range is.
  expect(backend.usageRequests[0]).toMatchObject({ timeRange: "thisMonth", granularity: "day", includeSubagent: true });
  await app.press("usage-range-today");
  expect(backend.usageRequests.find(call => call.timeRange === "today")).toMatchObject({
    granularity: "hour",
  });
  await app.press("usage-range-all");
  expect(backend.usageRequests.find(call => call.timeRange === "all")).toMatchObject({
    granularity: "day",
  });
});

test("usage draws the fixed six-month activity grid beside the range", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("Usage");
  // Only the two days inside the window are counted, not the bucket from 2020.
  await app.waitFor("Each cell is one day; the busiest day is darkest. 4.0K tokens over the window.");
  expect(app.texts().join("\n")).not.toContain("104K tokens over the window.");

  const window = backend.usageRequests.find(call => call.timeRange === "custom");
  expect(window).toMatchObject({ timeRange: "custom", granularity: "day", includeSubagent: true });
  expect(typeof window?.start).toBe("string");
  expect(typeof window?.end).toBe("string");
  // The window is the desktop's: six calendar months, ending now.
  expect(Date.parse(String(window?.start))).toBeLessThan(Date.parse(String(window?.end)));

  // Switching the range reads the range again; the grid's window does not move.
  await app.press("usage-range-today");
  await app.waitFor("Each cell is one day; the busiest day is darkest. 4.0K tokens over the window.");
  expect(backend.usageRequests.filter(call => call.timeRange === "custom").length).toBe(2);
});

test("a host that refuses the activity window keeps the range and says why", async () => {
  const backend = createBackend({ usageActivity: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("42 requests · 120K tokens");
  await app.waitFor("This host would not answer the six-month activity window.");
  expect(app.texts().join("\n")).not.toContain("tokens over the window.");
});

test("a host that offers no usage statistics says so instead of showing zeros", async () => {
  const backend = createBackend({ usage: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("This host reports no usage statistics, so nothing is invented here.");
  expect(app.texts()).not.toContain("0 requests · 0 tokens");
});

/** Six models, two groups and one endpoint, so a cut at five rows is visible. */
const DISTRIBUTED_USAGE = {
  ...DEFAULT_USAGE,
  byModel: Array.from({ length: 6 }, (_, index) => ({
    key: `m-${index}`,
    name: `model-${index}`,
    providerName: index === 0 ? "openai" : null,
    requests: 10 - index,
    tokens: 10_000 - index * 1_000,
    cacheHitRate: null,
  })),
  byGroup: [
    { key: "g-work", name: "Work", providerName: null, requests: 4, tokens: 3_000, cacheHitRate: null },
    { key: "g-chat", name: "Chat", providerName: null, requests: 2, tokens: 1_000, cacheHitRate: null },
  ],
  byEndpoint: [
    { key: "e-responses", name: "responses", providerName: "openai", requests: 9, tokens: 7_000, cacheHitRate: null },
  ],
};

test("usage lists the busiest five rows and offers the rest", async () => {
  const backend = createBackend({ usage: DISTRIBUTED_USAGE });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("model-0 · openai");
  await app.waitFor("model-4");
  // The sixth model is behind the cut, and the row count says so.
  expect(app.texts()).not.toContain("model-5");
  await app.waitFor("Show all 6");

  await app.press("usage-distribution-expand");
  await app.waitFor("model-5");
  await app.waitFor("Show less");
  await app.press("usage-distribution-expand");
  await app.waitFor("Show all 6");
  expect(app.texts()).not.toContain("model-5");

  // The endpoint totals the desktop lists under its detail rows.
  await app.waitFor("By endpoint");
  await app.waitFor("responses · openai");
});

test("usage filters the rows it draws, and switching to groups starts clean", async () => {
  const backend = createBackend({ usage: DISTRIBUTED_USAGE });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("model-0 · openai");

  await app.type("usage-entry-filter", "model-3");
  await app.waitFor("model-3");
  expect(app.texts()).not.toContain("model-0 · openai");
  expect(app.texts()).not.toContain("model-1");
  // A filter that matches nothing says so instead of drawing an empty list.
  await app.type("usage-entry-filter", "nothing-matches");
  await app.waitFor("No row matches that filter.");

  // Groups are the same answer regrouped; the filter and the cut both reset.
  await app.press("usage-distribution-group");
  await app.waitFor("Work");
  await app.waitFor("Chat");
  expect(app.texts()).not.toContain("model-0 · openai");
  expect(app.texts()).not.toContain("No row matches that filter.");

  await app.press("usage-distribution-model");
  await app.waitFor("model-0 · openai");
  await app.waitFor("Show all 6");
});

test("content width is a stepper over the preference both frontends keep", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // A width the desktop saved is the width this surface opens with.
    storage: { "openbitfun:appearance:flowChatWidth": "1100" },
  });

  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor("1100px · the transcript column, shared with the desktop surface");
  await app.waitFor("Narrowest 600px");

  await app.press("content-width-increase");
  await app.waitFor("1110px · the transcript column, shared with the desktop surface");
  expect(app.storage()["openbitfun:appearance:flowChatWidth"]).toBe("1110");

  await app.press("content-width-reset");
  await app.waitFor("900px · the transcript column, shared with the desktop surface");
  expect(app.storage()["openbitfun:appearance:flowChatWidth"]).toBe("900");
});

test("a stored content width below the floor falls back to the default", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // The desktop's own stepper cannot reach this, so it reads as unset.
    storage: { "openbitfun:appearance:flowChatWidth": "120" },
  });

  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor("900px · the transcript column, shared with the desktop surface");
});

test("log files show the run's folder, the crash hint, and pack a bundle on request", async () => {  const backend = createBackend({
    runtimeLogging: {
      effectiveLevel: "debug",
      sessionLogDir: "/tmp/openbitfun/logs/session-7",
      appLogPath: "/tmp/openbitfun/logs/session-7/app.log",
      flowChatLogPath: "/tmp/openbitfun/logs/session-7/flow-chat.log",
      previousUnexpectedExit: {
        detected: true,
        category: "panic",
        sessionLogDir: "/tmp/openbitfun/logs/session-6",
      },
    },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-diagnostics");
  await app.waitFor("Log files");
  await app.waitFor("Effective level debug");
  await app.waitFor("/tmp/openbitfun/logs/session-7");
  // A bad previous ending is stated with the folder that still holds its log.
  await app.waitFor(
    "The previous run ended without shutting down (panic). Its last log is in /tmp/openbitfun/logs/session-6.",
  );

  // Opening the folder asks the host to show the path it reported.
  await app.press("logging-open-folder");
  await waitForCalls(backend, "reveal_in_explorer");
  expect(backend.reveals).toEqual(["/tmp/openbitfun/logs/session-7"]);

  // Exporting asks first what the bundle may contain, then packs it and
  // reveals where it landed.
  await app.press("logging-export");
  await app.waitFor("Export diagnostics bundle?");
  expect(backend.actions()).not.toContain("export_diagnostics_bundle");
  await app.press("id:logging-export-confirm >> Export");
  await waitForCalls(backend, "reveal_in_explorer", 2);
  await app.waitFor("Exported /tmp/openbitfun/logs/diagnostics/openbitfun-diagnostics.zip");
  expect(backend.reveals[1]).toBe("/tmp/openbitfun/logs/diagnostics/openbitfun-diagnostics.zip");
});

test("a host that reports no log folder says so and offers no actions", async () => {
  const backend = createBackend({ runtimeLogging: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-diagnostics");
  await app.waitFor("Log files");
  await app.waitFor("This host reports no log location.");
  expect(app.texts()).not.toContain("Effective level");
});

test("a host without dispatch commands keeps the panel out of the way", async () => {
  const backend = createBackend();
  // A build from before these commands: the panel must not claim an error.
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string };
    if (args.action === "dispatch_list_targets" || args.action === "dispatch_list_jobs") {
      throw new Error("Command not found");
    }
    return null;
  };
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("Driving another device");
  expect(app.texts()).not.toContain("Detached dispatch");
});

test("settings writes tool and hook switches as leaf paths, not whole objects", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-automation");
  await app.waitFor("Agent hooks");
  await app.waitFor("Honor project hook files");

  await app.press("hooks-project");
  // A leaf write: `app.hooks` itself is never replaced.
  expect(backend.settingsWrites).toContainEqual({ path: "app.hooks.project_hooks_enabled", value: true });
  expect(backend.settingsWrites.some(write => write.path === "app.hooks" || write.path === "app")).toBe(false);

  await app.press("nav-settings-page-desktop-control");
  await app.press("computer-use");
  expect(backend.settingsWrites).toContainEqual({ path: "ai.computer_use_enabled", value: false });
  // `ai` holds the model list and API keys, so it is never rewritten here.
  expect(backend.settingsWrites.some(write => write.path === "ai")).toBe(false);

  // The browsers are the ones the host lists, not free text.
  await app.press("preferred-browser");
  await app.press("preferred-browser-chrome");
  expect(backend.settingsWrites).toContainEqual({
    path: "ai.browser_control_preferred_browser",
    value: "chrome",
  });

  await app.press("nav-settings-page-general");
  await app.press("prevent-sleep");
  expect(backend.settingsWrites).toContainEqual({ path: "app.prevent_sleep", value: true });

  await app.press("nav-settings-page-diagnostics");
  await app.press("logging-sensitive");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.logging.include_sensitive_diagnostics",
    value: true,
  });
});

test("settings reaches the session-memory switches", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("Session memory");
  await app.waitFor("Days before unused memories expire");
  expect(app.value("memory-max-unused-days")).toBe("30");

  await app.press("generate-memories");
  expect(backend.settingsWrites).toContainEqual({ path: "memories.generate_memories", value: false });

  // An enum the host deserializes: skip extraction for polluted sessions.
  await app.press("memory-external-context");
  await app.press("memory-external-context-skip_session");
  expect(backend.settingsWrites).toContainEqual({
    path: "memories.external_context_policy",
    value: "skip_session",
  });

  await app.clear("memory-max-unused-days");
  await app.type("memory-max-unused-days", "90");
  await app.press("Save Forget after (days) >> nth=0");
  expect(backend.settingsWrites).toContainEqual({ path: "memories.max_unused_days", value: 90 });
});

test("a host that stores no task models shows the defaults and can create the section", async () => {
  // A config file written before `ai.task_models` existed: the read fails, and
  // the host still applies its own default.
  const backend = createBackend({ absentConfigs: ["ai.task_models"] });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("The host stores no value yet; these are its defaults.");
  await app.waitFor("Names a session from its first message · Default");
  await app.press("task-model-git_commit");
  await app.press("task-model-inherit-git_commit");
  // The first write creates the section the host never had.
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.task_models").pop();
  expect(write?.value).toEqual({
    session_title: { kind: "fixed", model_id: "fast" },
    git_commit: { kind: "inherit" },
  });
});

test("a field the host stores nothing for shows its default and stays writable", async () => {
  // A config file that only holds what the shell needs: every optional path is
  // absent, and each row still shows the default the host would apply.
  const backend = createBackend({ configs: { app: { language: "en" } } });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Keep the computer awake");
  await app.waitFor("Keep your computer awake during active runs · Default");
  await app.press("prevent-sleep");
  expect(backend.settingsWrites).toContainEqual({ path: "app.prevent_sleep", value: true });
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("Extract useful facts and preferences from conversations · Default");
  expect(backend.settingsWrites).toContainEqual({ path: "app.prevent_sleep", value: true });
});
test("settings carries the input and workspace groups as leaf writes", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-input");
  await app.waitFor("Input");
  await app.waitFor("Show excerpt actions after selecting text");

  await app.press("selection-toolbar");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.flow_chat.auto_show_selection_toolbar",
    value: false,
  });

  await app.press("voice-input");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.ai_experience.voice_input.enabled",
    value: false,
  });

  await app.clear("voice-max-seconds");
  await app.type("voice-max-seconds", "120");
  await app.press("Save Longest recording (s) >> nth=0");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.ai_experience.voice_input.max_recording_seconds",
    value: 120,
  });

  await app.press("nav-settings-page-workspace");
  await app.waitFor("Worktree folder");
  await app.press("worktree-auto-delete");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.worktrees.autoDeleteEnabled",
    value: false,
  });

  // Both objects hold values this surface does not draw, so neither is rewritten.
  const wholeObjects = ["app", "app.flow_chat", "app.ai_experience", "app.worktrees"];
  expect(backend.settingsWrites.some(write => wholeObjects.includes(write.path))).toBe(false);
});

test("commit attribution writes its own leaf, and external import states where it lives", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-workspace");
  await app.waitFor("Attribute commits to OpenBitFun");
  // The fixture stores no value, so the drawn default is on and a press turns it off.
  await app.press("commit-coauthor");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.ai_experience.enable_git_commit_coauthor",
    value: false,
  });

  // A host without the external-source commands is told apart from an empty
  // one, and the page still points at the section that does work here.
  await app.press("nav-settings-page-external-import");
  await app.waitFor("External imports");
  await app.waitFor("This host does not support external import. Update the serving host to use it.");
  await app.waitFor("This host does not support restoring removed source sessions. Update the serving host and retry.");
  await app.press("external-import-open-agents");
  await app.waitFor("Coding agents this app can run through ACP.");
});

test("the stored mid-turn policy decides whether a composer message steers or queues", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The default is steering, which is what the composer has always done.
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");
  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer running turn…");

  await app.press("Settings");
  await app.press("nav-settings-page-input");
  await app.waitFor("Message sending");
  await app.press("mid-turn-policy-queue");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.flow_chat.send_during_turn",
    value: "queue",
  });

  // Settings swaps the nav panel for its page list; Back returns to Sessions.
  await app.press("settings-nav-back");
  await app.waitFor("Queue follow-up…");
  await app.type("composer", "Wait for the turn");
  await app.press("Queue");
  await app.waitFor("Queued 1 · starts when the running turn finishes");
  // The primary press carries no choice of its own: the host read the stored
  // policy and queued the message, so nothing was steered into the turn.
  const submit = backend.calls.filter(call => call.action === "submit_user_message").at(-1)?.request as Record<string, unknown>;
  expect(submit.sendDuringTurn).toBeUndefined();
  expect(backend.userMessages.at(-1)).toMatchObject({ outcome: "queued", text: "Wait for the turn" });
  expect(backend.actions()).not.toContain("steer_dialog_turn");
});
test("web search picks a provider, keeps the document, and the key goes to the vault", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-web-search");
  await app.waitFor("Web search");
  await app.waitFor("No key is stored for this provider");

  await app.press("search-provider-select");
  await app.press("search-provider-tavily");
  const providerWrite = backend.settingsWrites.filter(write => write.path === "ai.web_search").pop();
  // The document is written whole, as the desktop page writes it, and the
  // providers this surface does not draw survive the write.
  const document = providerWrite?.value as { provider?: string; providers?: Record<string, unknown> };
  expect(document.provider).toBe("tavily");
  expect(Object.keys(document.providers ?? {}).sort()).toEqual([
    "deepseek",
    "exa_search_api",
    "keenable",
    "openbitfun_search_http",
    "tavily",
  ]);

  // A key never enters that document: it travels in its own command.
  await app.type("search-secret", "sk-search");
  await app.press("search-save-key");
  expect(backend.credentialWrites).toContainEqual({ provider: "tavily", secret: "sk-search" });
  const afterKey = backend.settingsWrites.filter(write => write.path === "ai.web_search").pop();
  expect(JSON.stringify(afterKey?.value)).not.toContain("sk-search");

  await app.press("search-clear-key");
  expect(backend.clearedCredentials).toContain("tavily");
});

test("quick actions edit the stored list and the composer menu runs one", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-automation");
  await app.waitFor("Quick actions");
  await app.waitFor("Commit all current code changes");

  // Hidden actions stay in the stored list; the menu is what filters them.
  await app.press("quick-action-toggle-create_pr");
  // The list is its own leaf, so the rest of `app.ai_experience` is never rewritten.
  const hidden = backend.settingsWrites.filter(write => write.path === "app.ai_experience.quick_actions").pop();
  const rows = (hidden?.value as Array<{ id: string; enabled: boolean }>) ?? [];
  expect(rows.find(row => row.id === "create_pr")?.enabled).toBe(true);
  expect(backend.settingsWrites.some(write => write.path === "app.ai_experience")).toBe(false);

  await app.press("quick-action-add");
  await app.type("quick-action-label", "Release notes");
  await app.type("quick-action-prompt", "Draft the release notes");
  await app.press("quick-action-save");
  const added = backend.settingsWrites.filter(write => write.path === "app.ai_experience.quick_actions").pop();
  const addedRows = (added?.value as Array<{ label: string; prompt: string }>) ?? [];
  expect(addedRows.some(row => row.label === "Release notes" && row.prompt === "Draft the release notes")).toBe(true);

  // The composer's menu lists the shown actions and sends the prompt as a turn.
  await app.press("settings-nav-back");
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");
  await app.press("composer-plus");
  await app.press("Actions");
  await app.waitFor("Release notes");
  await app.press("Commit");
  await waitForCalls(backend, "submit_user_message");
  const turn = backend.calls.find(call => call.action === "submit_user_message")?.request;
  expect(turn).toMatchObject({ text: "Commit all current code changes", sessionId: "session-1" });
});
test("a file reference picked in the composer travels in the message", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // The picker searches the workspace the session runs in, with the same read the
  // Files scene searches with, so a remote workspace answers from its own files.
  // The picker is in the composer's "+" menu.
  await app.press("composer-plus");
  await app.press("Reference");
  await app.type("mention-query", "readme");
  await app.waitFor("README.md");
  expect(backend.calls.find(call => call.action === "search_files")?.request).toMatchObject({
    workspaceId: "workspace-1",
    pattern: "readme",
    searchContent: false,
  });

  // The tag is what the desktop composer writes into the message: `#file:<name>`.
  // The runtime does not expand it, so it travels as text the agent resolves.
  await app.type("composer", "Explain the setup ");
  await app.press("mention-option-README.md");
  await app.press("Send");
  // The message itself is trimmed on the way out, so the tag lands without the
  // trailing space the token carries for the next word.
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-1",
    text: "Explain the setup #file:README.md",
  });
});

test("Return takes the offered reference first, then sends the message", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  await app.type("composer", "Explain @readme");
  await app.waitFor("README.md");

  // Return with a row on offer takes the tag, as the desktop's picker does, and
  // nothing is sent yet.
  await app.submit("composer");
  expect(backend.actions()).not.toContain("submit_user_message");
  expect(app.value("composer")).toBe("Explain #file:README.md ");

  // The next Return sends what the composer holds.
  await app.submit("composer");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "Explain #file:README.md",
  });
});

test("typing @ in the message opens the picker and is replaced by the tag", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // The token is typed where the message is, so the panel has no field of its own
  // and the search follows what is being written.
  await app.type("composer", "Explain @readme");
  await app.waitFor("README.md");
  expect(app.texts()).toContain("A press replaces the @ you typed with the tag");
  expect(app.texts()).not.toContain("Search workspace file names");
  expect(backend.calls.find(call => call.action === "search_files")?.request).toMatchObject({
    workspaceId: "workspace-1",
    pattern: "readme",
  });

  // The typed token goes away and the tag takes its place, in one message.
  await app.press("mention-option-README.md");
  await app.press("Send");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "Explain #file:README.md",
  });
});

test("the reference picker says when nothing matches and when the host cannot search", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");

  await app.press("composer-plus");
  await app.press("Reference");
  await app.type("mention-query", "zzz");
  await app.waitFor("No file names match “zzz”");
  // Nothing is invented to fill the list, and no tag can be pressed.
  expect(app.texts()).not.toContain("README.md");

  const refusing = createBackend({ fileSearch: false });
  const other = await open("./App.tsx", { ...DESKTOP, host: { handlers: refusing.handlers } });
  await other.waitFor("NSH skeleton");
  await other.press("NSH skeleton >> nth=0");
  await other.press("composer-plus");
  await other.press("Reference");
  await other.type("mention-query", "main");
  await other.waitFor("This host cannot search its files: Command not found: search_files");
  // The composer keeps working: the reference is an addition, not a requirement.
  await other.type("composer", "No reference this time");
  await other.press("Send");
  expect(refusing.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "No reference this time",
  });
});

test("the font baseline the host stores sets the size the whole surface draws", async () => {
  // The desktop keeps this in the `font` config and derives its type ramp from
  // it, so this surface reads the same document and writes the same shape.
  const backend = createBackend({
    fontPreference: { uiSize: { level: "custom", customPx: 18 } },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  const baseline = (px: number) => `${px}px · the host's font baseline, shared with the desktop surface`;
  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor(baseline(18));

  // A preset writes the level alone: the desktop drops the custom px with it.
  await app.press("font-level-large");
  await waitForCalls(backend, "set_config");
  expect(backend.settingsWrites.at(-1)).toMatchObject({
    path: "font",
    value: { uiSize: { level: "large" } },
  });
  await app.waitFor(baseline(16));

  // One step off a preset is a custom size, which is how the desktop's own
  // stepper leaves the presets.
  await app.press("font-size-increase");
  await app.waitFor(baseline(17));
  expect(backend.settingsWrites.at(-1)).toMatchObject({
    path: "font",
    value: { uiSize: { level: "custom", customPx: 17 } },
  });

  // The stored size is clamped to the range the desktop allows: the last step
  // lands on 20 and the next one is refused before it reaches the host.
  const writes = backend.settingsWrites.length;
  await app.press("font-size-increase");
  await app.waitFor(baseline(18));
  await app.press("font-size-increase");
  await app.waitFor(baseline(19));
  await app.press("font-size-increase");
  await app.waitFor(baseline(20));
  expect(app.texts()).toContain(baseline(20));
  expect(backend.settingsWrites.length).toBe(writes + 3);

  await app.press("font-size-reset");
  await app.waitFor(baseline(14));
  expect(backend.settingsWrites.at(-1)).toMatchObject({
    path: "font",
    value: { uiSize: { level: "default" } },
  });
});

test("a host that stores no font baseline keeps the default size", async () => {
  const backend = createBackend({ fontPreference: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor("14px · the host's font baseline, shared with the desktop surface");
  // Nothing is written until the user asks for another size.
  expect(backend.settingsWrites.filter(write => write.path === "font")).toHaveLength(0);

  await app.press("font-level-compact");
  await waitForCalls(backend, "set_config");
  expect(backend.settingsWrites.at(-1)).toMatchObject({
    path: "font",
    value: { uiSize: { level: "compact" } },
  });
  await app.waitFor("12px · the host's font baseline, shared with the desktop surface");
});

test("MCP servers start, add through the document, and refuse a stale write", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("MCP servers");
  await app.waitFor("Filesystem · fs-server");
  await app.waitFor("Docs · remote-docs");

  // A stopped, disabled server is enabled in the stored document first (the
  // host refuses to start a disabled one), then started through the host, and
  // the row then reports the status the host says it has.
  await app.press("mcp-start-remote-docs");
  await waitForCalls(backend, "start_mcp_server");
  const enabled = JSON.parse(backend.mcpSaves[0].jsonConfig) as {
    mcpServers: Record<string, { enabled?: boolean; keepMe?: string }>;
  };
  expect(enabled.mcpServers["remote-docs"].enabled).toBe(true);
  expect(enabled.mcpServers["fs-server"].keepMe).toBe("unknown field");
  const actions = backend.actions();
  expect(actions.lastIndexOf("save_mcp_json_config")).toBeLessThan(actions.indexOf("start_mcp_server"));
  expect(backend.calls.find(call => call.action === "start_mcp_server")?.request).toMatchObject({
    serverId: "remote-docs",
  });
  await app.waitFor("Connected");

  // A new server is written into the user-level document, never as a replacement
  // for it: the fields another editor stored on the other entries survive.
  await app.press("mcp-add");
  await app.type("mcp-draft-name", "Weather");
  await app.press("mcp-draft-transport-stdio");
  await app.type("mcp-draft-command", "npx");
  await app.press("mcp-draft-save");
  await waitForCalls(backend, "save_mcp_json_config", 2);
  const added = JSON.parse(backend.mcpSaves[1].jsonConfig) as {
    mcpServers: Record<string, { command?: string; enabled?: boolean; keepMe?: string }>;
  };
  expect(added.mcpServers.weather.command).toBe("npx");
  // Writing a configuration is not permission to launch what it names.
  expect(added.mcpServers.weather.enabled).toBe(false);
  expect(added.mcpServers["fs-server"].keepMe).toBe("unknown field");

  // The JSON view edits the very document that is stored.
  await app.press("mcp-json-toggle");
  await app.waitFor("Save JSON");
  await app.press("mcp-json-save");
  await waitForCalls(backend, "save_mcp_json_config", 3);
  expect(backend.mcpSaves[2].jsonConfig).toBe(backend.mcpSaves[1].jsonConfig);

  // A document that moved after it was read is not overwritten: the save is
  // refused, the reason is shown, and nothing is written.
  backend.changeMcpDocumentElsewhere();
  await app.press("mcp-json-save");
  await app.waitFor("The MCP configuration changed elsewhere; reloaded it");
  await app.waitFor("Not saved");
  expect(backend.mcpSaves).toHaveLength(3);
});

test("a remote MCP server authorizes through the host's browser flow", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("Docs · remote-docs");
  // Only a server with an address has an authorization entry.
  expect(app.shows("mcp-auth-fs-server")).toBe(false);

  await app.press("mcp-auth-remote-docs");
  await app.waitFor("Authorize remote-docs");
  await app.waitFor("OAuth status: not started");

  await app.press("mcp-auth-start");
  await app.waitFor("OAuth status: waiting for the browser");
  // The address the host answered with is opened outside the app.
  expect(app.openedUrls()).toContain("https://auth.example/authorize?state=abc123");
  await app.waitFor("The provider redirects to http://127.0.0.1:45871/oauth/callback");
  expect(backend.calls.some(call => call.action === "start_mcp_remote_oauth")).toBe(true);

  // The host finishes the flow, and the poll this surface runs reports it.
  backend.setMcpOAuthSession({
    serverId: "remote-docs",
    status: "authorized",
    message: "Docs is authorized",
  });
  await app.waitFor("OAuth status: authorized");
  await app.waitFor("Docs is authorized");
});

test("an OAuth flow can be cancelled, and a typed authorization value reaches the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("Docs · remote-docs");
  await app.press("mcp-auth-remote-docs");
  await app.press("mcp-auth-start");
  await app.waitFor("OAuth status: waiting for the browser");

  await app.press("mcp-auth-cancel");
  await app.waitFor("Cancelled authorization for remote-docs");
  await app.waitFor("OAuth status: cancelled");

  // A server without a browser flow still takes the value its operator pastes.
  await app.type("mcp-auth-value", "secret-token");
  await app.press("mcp-auth-save-value");
  await app.waitFor("Saved the authorization value for remote-docs");
  expect(backend.mcpAuthWrites).toEqual([
    { serverId: "remote-docs", authorizationValue: "secret-token" },
  ]);
  // The row reports the authorization the host now holds.
  await app.waitFor("Reauthorize");

  await app.press("mcp-auth-clear");
  await app.waitFor("Cleared the authorization for remote-docs");
  expect(backend.mcpAuthClears).toEqual(["remote-docs"]);
});

test("a pasted MCP configuration imports only the entries this form can express", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("Docs · remote-docs");
  await app.press("mcp-import");
  await app.waitFor("Import servers");

  // Three entries: one this form draws, one whose arguments are not strings, and
  // one whose id the document already holds. The middle entry is refused at
  // preview time instead of being stored as a server nobody could edit.
  const pasted = {
    mcpServers: {
      weather: { command: "npx", args: ["-y", "weather-mcp"] },
      "weird-one": { command: "npx", args: [42] },
      "fs-server": { command: "npx" },
    },
  };
  await app.type("mcp-import-text", JSON.stringify(pasted, null, 2));
  await app.press("mcp-import-preview");
  await app.waitFor("3 servers read; 1 cannot be imported by this form");
  await app.waitFor("weird-one");

  // Only the fresh, expressible entry is selected; the import writes it disabled.
  await app.press("mcp-import-save");
  await waitForCalls(backend, "save_mcp_json_config");
  const saved = JSON.parse(backend.mcpSaves[0].jsonConfig) as {
    mcpServers: Record<string, { command?: string; enabled?: boolean; keepMe?: string }>;
  };
  expect(saved.mcpServers.weather.command).toBe("npx");
  expect(saved.mcpServers.weather.enabled).toBe(false);
  expect(saved.mcpServers["weird-one"]).toBeUndefined();
  // The entry the id collided with keeps the document's own shape.
  expect(saved.mcpServers["fs-server"].keepMe).toBe("unknown field");
  expect(saved.mcpServers["fs-server"].command).toBe("npx");
  await app.waitFor("Imported 1 server; each is stored disabled");
});

// ── App shell & navigation (round 4) ─────────────────────────────────────────

/** A native desktop window on `platform`, as host.js reports it, recording every window call. */
function nativeWindowHandlers(
  backend: ReturnType<typeof createBackend>,
  platform: "windows" | "linux" | "macos",
  options: { focused?: boolean } = {},
) {
  const windowCalls: string[] = [];
  const record = (name: string, value: unknown = true) => () => {
    windowCalls.push(name);
    return { ok: true, value };
  };
  return {
    windowCalls,
    handlers: {
      ...backend.handlers,
      "openbitfun.windowChrome": () => ({
        ok: true,
        value: { native: true, platform, overlayTrafficLights: platform === "macos", isFullscreen: false },
      }),
      "openbitfun.windowIsMaximized": record("isMaximized", false),
      "openbitfun.windowWatchResize": record("watchResize"),
      "openbitfun.windowMinimize": record("minimize"),
      "openbitfun.windowToggleMaximize": record("toggleMaximize"),
      "openbitfun.windowClose": record("close"),
      "openbitfun.windowFocused": () => ({ ok: true, value: options.focused ?? true }),
      "openbitfun.appVersion": () => ({ ok: true, value: "1.4.2" }),
    },
  };
}

test("the sidebar lists opened workspaces and keeps recent ones apart", async () => {
  const backend = createBackend({
    recentOnlyWorkspaces: [{ id: "workspace-old", name: "legacy-app", rootPath: "/old/legacy", workspaceKind: "local" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:workspace-row-workspace-1");
  await app.waitFor("Recent");
  expect(app.shows("label:workspace-row-workspace-old")).toBe(false);
  expect(app.shows("label:recent-workspace-workspace-old")).toBe(true);

  // Reopening a recent workspace goes through open_workspace by id, never
  // set_active_workspace on a workspace the host has not opened.
  const before = backend.calls.filter(call => call.action === "set_active_workspace").length;
  await app.press("label:recent-workspace-workspace-old");
  await app.waitFor("label:workspace-row-workspace-old");
  expect(backend.calls.find(call => call.action === "open_workspace")?.request).toMatchObject({
    workspaceId: "workspace-old",
  });
  const switches = backend.calls.filter(call => call.action === "set_active_workspace");
  expect(switches.slice(before).some(call => (call.request as { workspaceId?: string }).workspaceId === "workspace-old")).toBe(false);
  expect(app.shows("label:recent-workspace-workspace-old")).toBe(false);
});

test("removing a recent workspace asks the host to forget it", async () => {
  const backend = createBackend({
    recentOnlyWorkspaces: [{ id: "workspace-old", name: "legacy-app", rootPath: "/old/legacy", workspaceKind: "local" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:recent-workspace-remove-workspace-old");
  await app.press("label:recent-workspace-remove-workspace-old");
  await app.waitUntil(() => backend.actions().includes("remove_recent_workspace"));
  expect(backend.calls.find(call => call.action === "remove_recent_workspace")?.request).toMatchObject({
    workspaceId: "workspace-old",
  });
  await app.waitUntil(() => !app.shows("label:recent-workspace-workspace-old"));
});

test("startup follows the host's current workspace instead of the first row", async () => {
  const backend = createBackend({ currentWorkspaceId: "workspace-2" });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "list_persisted_sessions_page" &&
        (call.request as { workspace_id?: string }).workspace_id === "workspace-2",
    ),
  );
  // The host already has it active, so the surface does not switch it again.
  expect(backend.actions()).not.toContain("set_active_workspace");
  await app.waitFor("topbar-workspace-chip");
});

test("with nothing opened, startup reopens the most recent workspace", async () => {
  const backend = createBackend({
    openedWorkspaces: [],
    currentWorkspaceId: null,
    recentOnlyWorkspaces: [{ id: "workspace-old", name: "legacy-app", rootPath: "/old/legacy", workspaceKind: "local" }],
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitUntil(() => backend.actions().includes("open_workspace"));
  // The fixture's own two recents are not opened either; the first recent row is reopened.
  const reopened = backend.calls.find(call => call.action === "open_workspace")?.request as { workspaceId?: string };
  expect(typeof reopened?.workspaceId).toBe("string");
  expect(app.texts()).not.toContain("No workspace is open yet.");
});

test("Windows draws its own window controls and routes them to the native window", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "windows");
  const app = await open("./App.tsx", { ...DESKTOP, platform: "windows", host: { handlers: native.handlers } });

  await app.waitFor("label:window-minimize");
  await app.press("label:window-minimize");
  await app.press("label:window-maximize");
  await app.press("label:window-close");
  for (const call of ["minimize", "toggleMaximize", "close"]) {
    expect(native.windowCalls).toContain(call);
  }
  // The tray is built once the shell is up, as the desktop frontend does.
  await app.waitUntil(() => backend.actions().includes("initialize_tray_after_startup"));
});

test("macOS keeps its traffic lights and hides the window on a close request", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "macos");
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: native.handlers } });

  await app.waitFor("NSH skeleton");
  expect(app.shows("label:window-minimize")).toBe(false);
  await app.host.send("openbitfun.event", { event: "openbitfun_main_window_close_requested", payload: null });
  await app.waitUntil(() => backend.actions().includes("hide_main_window_after_close_request"));
  expect(backend.actions()).not.toContain("quit_app");
});

test("a Windows close request follows app.close_button_behavior", async () => {
  // No stored preference: the window goes to the tray.
  const trayBackend = createBackend();
  const tray = nativeWindowHandlers(trayBackend, "windows");
  const trayApp = await open("./App.tsx", { ...DESKTOP, platform: "windows", host: { handlers: tray.handlers } });
  await trayApp.waitFor("label:window-close");
  await trayApp.host.send("openbitfun.event", { event: "openbitfun_main_window_close_requested", payload: null });
  await trayApp.waitUntil(() => trayBackend.actions().includes("minimize_to_tray"));
  expect(trayBackend.actions()).not.toContain("quit_app");

  // `ask` puts the choice in the page, where a remote controller could answer it too.
  const askBackend = createBackend({
    configs: { "app.close_button_behavior": "ask", appearance: { theme: "dark" } },
  });
  const ask = nativeWindowHandlers(askBackend, "windows");
  const askApp = await open("./App.tsx", { ...DESKTOP, platform: "windows", host: { handlers: ask.handlers } });
  await askApp.waitFor("label:window-close");
  await askApp.host.send("openbitfun.event", { event: "openbitfun_main_window_close_requested", payload: null });
  await askApp.waitFor("Close OpenBitFun");
  await askApp.press("label:close-ask-quit");
  await askApp.waitUntil(() => askBackend.actions().includes("quit_app"));
  expect(askBackend.actions()).not.toContain("minimize_to_tray");
});

test("the workspace menu renames, copies the path and reveals a local folder", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:workspace-actions-workspace-1");
  await app.press("label:workspace-actions-workspace-1");
  await app.press("Copy path");
  await app.waitUntil(() => app.clipboard() === "/repo");

  await app.press("label:workspace-actions-workspace-1");
  await app.press("Reveal in file manager");
  await app.waitUntil(() => backend.actions().includes("reveal_in_explorer"));
  expect(backend.calls.find(call => call.action === "reveal_in_explorer")?.request).toMatchObject({
    path: "/repo",
    workspaceId: "workspace-1",
  });

  await app.rightClick("label:workspace-row-workspace-1");
  await app.press("Rename…");
  await app.waitFor("label:workspace-rename-input");
  await app.clear("label:workspace-rename-input");
  await app.type("label:workspace-rename-input", "Studio");
  await app.press("label:workspace-rename-save");
  await app.waitUntil(() => backend.actions().includes("update_workspace_info"));
  expect(backend.calls.find(call => call.action === "update_workspace_info")?.request).toMatchObject({
    workspaceId: "workspace-1",
    name: "Studio",
  });
  await app.waitFor("Studio");
});

test("a remote workspace's menu does not offer this machine's file manager", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:workspace-actions-workspace-2");
  await app.press("label:workspace-actions-workspace-2");
  await app.waitFor("Reveal in file manager");
  expect(app.enabled("Reveal in file manager")).toBe(false);
});

test("the session row menu duplicates, exports and renames in place", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:session-row-actions-session-2");
  await app.press("label:session-row-actions-session-2");
  await app.press("Duplicate");
  await app.waitUntil(() => backend.actions().includes("copy_session"));
  expect(backend.calls.find(call => call.action === "copy_session")?.request).toMatchObject({
    source_session_id: "session-2",
    workspace_id: "workspace-1",
  });

  await app.press("label:session-row-actions-session-1");
  await app.press("Rename…");
  await app.waitFor("label:session-rename-input-session-1");
  await app.clear("label:session-rename-input-session-1");
  await app.type("label:session-rename-input-session-1", "Renamed inline");
  await app.submit("label:session-rename-input-session-1");
  await app.waitUntil(() => backend.actions().includes("save_session_metadata"));
  await app.waitFor("Renamed inline");
});

test("the sidebar layout is kept in app storage and read back on the next launch", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("drawer-more");
  await app.press("label:nav-toggle-grouping");
  await app.waitUntil(() => (app.storage()["openbitfun.nsh.shell-layout.v1"] ?? "").includes('"sessionGrouping":"flat"'));

  const next = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: createBackend().handlers },
    storage: { "openbitfun.nsh.shell-layout.v1": JSON.stringify({ drawerOpen: false, navWidth: 999, junk: 1 }) },
  });
  // The stored drawer state wins, and an out-of-range width is clamped rather than dropped.
  await next.waitFor("label:toggle-drawer");
  expect(next.shows("global-search-trigger")).toBe(false);
});

test("a failed turn and an approval land in the notification history", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "macos", { focused: false });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: native.handlers } });

  await app.waitFor("NSH skeleton");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-failed",
    payload: { sessionId: "session-2", turnId: "turn-9", reason: "provider refused" },
  });
  await app.waitFor("label:notifications-unread-1");
  // The window has no focus, so the OS notification goes out too.
  await app.waitUntil(() => backend.actions().includes("send_system_notification"));
  expect(backend.calls.find(call => call.action === "send_system_notification")?.request).toMatchObject({
    title: "OpenBitFun task stopped",
  });
  // The tray counts the session whose result nobody has seen yet.
  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "set_tray_unread_count" && (call.request as { count?: number }).count === 1,
    ),
  );

  await app.press("label:topbar-notifications");
  await app.waitFor("OpenBitFun task stopped");
  await app.press("Mark all as read");
  await app.waitUntil(() => !app.shows("label:notifications-unread-1"));
});

test("About comes from the native menu and shows this window's build", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "macos");
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: native.handlers } });

  await app.waitFor("NSH skeleton");
  await app.host.send("openbitfun.event", { event: "openbitfun_menu_about", payload: null });
  await app.waitFor("About OpenBitFun");
  await app.waitFor("1.4.2");
  expect(app.texts()).toContain("MIT License");
});

test("the footer menu checks for updates and offers the download", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "macos");
  const handlers = {
    ...native.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string };
      if (args.action === "check_for_updates") {
        return {
          ok: true,
          value: { updateAvailable: true, currentVersion: "1.4.2", latestVersion: "1.5.0" },
        };
      }
      if (args.action === "get_pending_update") return { ok: true, value: null };
      if (args.action === "download_update") return { ok: true, value: { version: "1.5.0" } };
      return backend.handlers["openbitfun.invoke"](data);
    },
  };
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers } });

  await app.waitFor("label:nav-footer-menu");
  await app.press("label:nav-footer-menu");
  await app.press("Check for updates");
  await app.waitFor("Update 1.5.0 available");
  await app.waitFor("label:footer-update-badge");
  await app.press("label:nav-footer-menu");
  await app.press("Download update 1.5.0");
  await app.waitFor("Update 1.5.0 is ready to install");
});

test("global search groups workspaces and settings pages beside sessions", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("global-search-trigger");
  await app.press("global-search-trigger");
  await app.type("global-search-input", "remote");
  await app.waitFor("label:global-search-item-workspace:workspace-2");
  expect(app.texts()).toContain("Workspaces");
  // Message hits are read from every opened workspace, not only the active one.
  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "search_session_content" &&
        (call.request as { workspaceId?: string }).workspaceId === "workspace-2",
    ),
  );
  await app.press("label:global-search-item-workspace:workspace-2");
  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "set_active_workspace" &&
        (call.request as { workspaceId?: string }).workspaceId === "workspace-2",
    ),
  );
});

test("general options go through product control, which applies them on the host", async () => {
  const backend = createBackend();
  const controlCalls: Array<Record<string, unknown>> = [];
  const values: Record<string, unknown> = { "launch-at-login": false, "prevent-sleep": false, "auto-update": true };
  const invoke = backend.handlers["openbitfun.invoke"];
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
      if (args.action === "product_control_invoke") {
        // A `{ request }` command, as the desktop serves it.
        const request = args.request ?? {};
        controlCalls.push(request);
        if (request.action === "get") {
          return { ok: true, value: { currentOptionValues: { ...values } }, transport: "dev" };
        }
        values[String(request.optionId)] = request.value;
        return { ok: true, value: { status: "applied" }, transport: "dev" };
      }
      return invoke(data);
    },
  };
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-general");
  await app.waitFor("Start the app when you sign in to this computer.");
  await app.press("launch-at-login");
  expect(controlCalls).toContainEqual({
    action: "configure",
    capabilityId: "setting.application.general",
    optionId: "launch-at-login",
    value: true,
  });
  // Keeping the computer awake is applied by the host, not only stored.
  await app.press("prevent-sleep");
  expect(controlCalls).toContainEqual({
    action: "configure",
    capabilityId: "setting.application.general",
    optionId: "prevent-sleep",
    value: true,
  });
  expect(backend.settingsWrites.some(write => write.path === "app.prevent_sleep")).toBe(false);
});

test("MCP enable flips the stored flag, and delete asks first", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-mcp");
  await app.waitFor("Docs · remote-docs");

  // The menu's Enable enables; it does not open the editor or start the server.
  await app.press("mcp-actions-remote-docs");
  await app.press("mcp-enable-remote-docs");
  await waitForCalls(backend, "save_mcp_json_config");
  const saved = JSON.parse(backend.mcpSaves[0].jsonConfig) as {
    mcpServers: Record<string, { enabled?: boolean }>;
  };
  expect(saved.mcpServers["remote-docs"].enabled).toBe(true);
  expect(backend.actions()).not.toContain("start_mcp_server");
  expect(app.shows("mcp-draft-save")).toBe(false);

  await app.press("mcp-actions-fs-server");
  await app.press("mcp-delete-fs-server");
  await app.waitFor("Delete Filesystem? It stops and is removed from the stored configuration.");
  expect(backend.actions()).not.toContain("delete_mcp_server");
  await app.press("id:mcp-delete-confirm-fs-server >> Delete");
  await waitForCalls(backend, "delete_mcp_server");
});

test("memory folder opens on the host and clearing memories asks first", async () => {
  const backend = createBackend();
  const invoke = backend.handlers["openbitfun.invoke"];
  let resets = 0;
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; raw?: unknown };
      // Both commands take no arguments, so they are positional.
      if (args.action === "get_memory_paths") {
        return { ok: true, value: { memoriesRootDir: "/tmp/openbitfun/memories" }, transport: "dev" };
      }
      if (args.action === "reset_memory") {
        resets += 1;
        return { ok: true, value: { success: true }, transport: "dev" };
      }
      return invoke(data);
    },
  };
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-session-memory");
  await app.press("memory-open-folder");
  await waitForCalls(backend, "reveal_in_explorer");
  expect(backend.reveals).toContain("/tmp/openbitfun/memories");

  await app.press("memory-reset");
  await app.waitFor("Clear every stored memory and the extraction state? This cannot be undone.");
  expect(resets).toBe(0);
  await app.press("id:memory-reset-confirm >> Clear memories");
  await app.waitFor("Cleared the stored memories");
  expect(resets).toBe(1);
});

test("voice input lists this machine's speech models and downloads one", async () => {
  const backend = createBackend();
  const invoke = backend.handlers["openbitfun.invoke"];
  const downloads: unknown[] = [];
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: Record<string, unknown>; raw?: unknown };
      if (args.action === "speech_list_models") {
        if (!("raw" in args)) throw new Error("speech_list_models takes no request");
        return {
          ok: true,
          value: {
            models: [
              {
                modelId: "sensevoice-small-int8",
                displayName: "SenseVoice Small",
                state: "not_installed",
                expectedBytes: 240 * 1024 * 1024,
              },
            ],
          },
          transport: "dev",
        };
      }
      if (args.action === "speech_download_model") {
        downloads.push(args.request);
        return {
          ok: true,
          value: { modelId: "sensevoice-small-int8", displayName: "SenseVoice Small", state: "installed", installedBytes: 240 * 1024 * 1024 },
          transport: "dev",
        };
      }
      return invoke(data);
    },
  };
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-input");
  await app.waitFor("SenseVoice Small");
  await app.press("speech-download-sensevoice-small-int8");
  expect(downloads).toEqual([{ modelId: "sensevoice-small-int8" }]);
  await app.waitFor("Ready");
});

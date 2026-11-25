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
import { showDevices,
  type BackendOptions,
  DEFAULT_USAGE,
  createBackend,
  createDeviceBackend,
  openSession,
  openSessionRow,
  openToolScene,
  showAllSessions,
} from "./test/support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("shell and sessions come from the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("nav-library");
  // The streamlined sidebar keeps Search at top, Library directly below, this
  // device's workspace/session tree, and the account row at bottom.
  expect(app.shows("nav-openbitfun")).toBe(false);
  expect(app.shows("nav-new-session")).toBe(false);
  expect(app.shows("nav-inbox")).toBe(false);
  expect(app.shows("nav-all-sessions")).toBe(false);
  expect(app.shows("global-search-trigger")).toBe(true);
  expect(app.shows("nav-library")).toBe(true);
  expect(app.shows("sidebar-device-tree")).toBe(true);
  await app.waitFor("id:sidebar-session-session-1");
  await showAllSessions(app, "NSH skeleton");

  // The catalog is requested for the workspace the host reported.
  const listCall = backend.calls.find(call => call.action === "list_persisted_sessions_page");
  expect(listCall?.request).toMatchObject({ workspace_id: "workspace-1", limit: 50 });
});

test("sessions open side by side in split view without hidden background tabs", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  // Thread menu omits retired "Open tabs" clutter and offers "Split view".
  await app.press("thread-actions-trigger");
  expect(app.texts()).not.toContain("Open tabs");
  await app.press("session-split-open");

  // Both sessions render simultaneously side by side with independent transcripts.
  await app.waitFor("id:secondary-session-pane");
  await app.waitFor("Port the terminal.");
  expect(app.texts()).toContain("Port the session list.");
  expect(app.texts()).toContain("Port the terminal.");

  // Closing the secondary pane returns cleanly to single-pane mode and releases its transcript.
  await app.press("session-pane-close-1");
  await app.waitFor("id:secondary-session-pane", { state: "gone" });
  expect(app.texts()).toContain("Port the session list.");
  expect(app.texts()).not.toContain("Port the terminal.");
});

test("archived sessions are their own list and can be restored", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  // Archived rows stay out of All sessions; Settings › Archived sessions lists them.
  expect(app.texts()).not.toContain("Old experiment");
  await app.press("Settings");
  await app.press("Archived sessions");
  await app.waitFor("label:settings-archived");
  await app.waitFor("Old experiment");
  await app.press("label:settings-archived-restore-session-3");
  await app.waitUntil(() => backend.actions().includes("unarchive_session"));
  await showAllSessions(app, "Old experiment");
});

test("selecting a session loads its turns", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "Terminal migration");
  await openSessionRow(app, "Terminal migration >> nth=0");
  await app.waitFor("Port the terminal.");
  expect(backend.actions()).toContain("get_session_transcript_view");
  expect(app.texts()).toContain("Port the terminal.");
});

test("deleting a session drops its row and the catalog count with it", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");

  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.press("thread-actions-trigger");
  await app.press("session-delete-trigger");
  await app.waitFor("session-delete-confirm");
  await app.press("session-delete-confirm");

  expect(backend.calls.find(call => call.action === "delete_persisted_session")?.request).toMatchObject({
    session_id: "session-1",
    workspace_id: "workspace-1",
  });
  // The row leaves its workspace in the session tree with it.
  await showAllSessions(app, "Terminal migration");
  await app.waitUntil(() => !app.shows("label:sidebar-workspace-workspace-1 >> NSH skeleton"));
});

test("session header actions archive, rename and send a turn", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");

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

  await showAllSessions(app, "NSH skeleton");
  // Neither session was opened here: session-2 holds an unread result and
  // session-1 also awaits approval, so each row carries its one mark.
  await app.waitFor("label:Done");
  await app.waitFor("label:Needs you");

  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  // A turn in another session marks that row without touching this transcript.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-2", turnId: "turn-2" },
  });
  expect(app.texts()).toContain("Port the session list.");
  await showAllSessions(app);
  await app.waitFor("label:Working");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-2", turnId: "turn-2" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-failed",
    payload: { sessionId: "session-2", turnId: "turn-3", reason: "provider refused" },
  });
  await app.waitFor("label:Failed");
  expect(app.shows("label:Working")).toBe(false);
});

test("settings switches the scheme it draws and remembers the choice", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    // The host's own appearance is dark; the app follows it until asked not to.
    colorScheme: "dark",
  });

  await showAllSessions(app, "NSH skeleton");
  await app.press("Settings");
  await app.press("nav-settings-page-appearance");
  await app.waitFor("Showing the dark scheme");
  // Follow system starts ON and hides the theme gallery until turned off.
  expect(app.shows("appearance-swatch-openbitfun-light")).toBe(false);

  await app.press("appearance-follow-system");
  await app.waitFor("appearance-swatch-openbitfun-light");
  await app.press("appearance-swatch-openbitfun-light");
  await app.waitFor("Showing the light scheme");
  // The choice survives a restart of the surface.
  expect(app.storage()["openbitfun.nsh.appearance.v1"]).toBe("light");
  expect(app.storage()["openbitfun.nsh.appearance-id.v1"]).toBe("openbitfun-light");
  // The light scheme's own muted text: the scene repainted, not just its state.
  expect(app.spanStyle("Showing the light scheme").color).toBe("#5c6672ff");

  await app.press("appearance-follow-system");
  await app.waitFor("Showing the dark scheme");
  expect(app.shows("appearance-swatch-openbitfun-light")).toBe(false);
  expect(app.storage()["openbitfun.nsh.appearance.v1"]).toBe("system");
});

test("a message sent while a turn runs steers that turn instead of starting another", async () => {
  const backend = createBackend({
    configs: { "app.flow_chat.send_during_turn": "immediate" },
  });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // The host reports the turn it started; it is the host that addresses it.
  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Steer this session");

  await app.type("composer", "Also check the tests");
  await app.press("Send");

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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");

  await app.type("composer", "Then look at the docs");
  await app.press("Send");
  await app.waitFor("Queued 1");
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

  // Once the queued turn actually starts, it leaves the queue immediately even if the
  // host snapshot had not yet marked it started before dialog-turn-started fired.
  const queuedTurnId = backend.userMessages[0].turnId;
  backend.setRunningTurn("session-1", queuedTurnId);
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: queuedTurnId, userInput: "Then look at the docs" },
  });
  await app.waitUntil(() => !app.shows("queued-panel"));
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
  await showAllSessions(app, "NSH skeleton");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");

  await app.type("composer", "Hold this until the turn ends");
  await app.press("Send");
  await app.waitFor("Queued 1");

  // The host owns the row: the default setting (`queue`) queues the message
  // without sending an explicit per-message override from the composer.
  const submit = backend.calls.find(call => call.action === "submit_user_message");
  expect(submit?.request).toMatchObject({
    sessionId: "session-1",
    text: "Hold this until the turn ends",
    agentType: "Standard",
  });
  expect((submit?.request as Record<string, unknown>)?.sendDuringTurn).toBeUndefined();
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");

  await app.type("composer", "First on the queue");
  await app.press("Send");
  await app.waitFor("Queued 1");
  await app.type("composer", "Second on the queue");
  await app.press("Send");
  await app.waitFor("Queued 2");

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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");

  await app.type("composer", "Blocked by the host");
  await app.press("Send");
  await app.waitFor("Queued 1");

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

test("editing or cancelling a queued message never wipes the currently running turn's user bubble or stream", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // Turn A is actively running with its user bubble and streamed response on screen.
  backend.setRunningTurn("session-1", "turn-active");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-active", userInput: "Search the web for this" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "turn-active", roundId: "r1", text: "Searching now..." },
  });
  await app.waitFor("Search the web for this");
  await app.waitFor("Searching now...");

  // User queues Turn B while Turn A is still running.
  await app.type("composer", "Follow-up draft");
  await app.press("Send");
  await app.waitFor("Queued 1");
  const queuedTurnId = backend.userMessages.find(m => m.outcome === "queued")?.turnId ?? "";
  expect(queuedTurnId).not.toBe("");

  // Clicking Edit cancels queued Turn B on the host; the host emits `dialog-turn-cancelled` for Turn B.
  await app.press("Edit");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-cancelled",
    payload: { sessionId: "session-1", turnId: queuedTurnId },
  });

  // Draft returns to composer, queue closes, AND Turn A's user bubble + live stream + Stop stay intact!
  await app.waitUntil(() => app.value("composer") === "Follow-up draft");
  expect(app.shows("queued-panel")).toBe(false);
  expect(app.texts()).toContain("Search the web for this");
  expect(app.texts()).toContain("Searching now...");

  // Late text chunk from a different stale turn ID must also not clobber Turn A.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "turn-stale-old", roundId: "r-old", text: "STALE CLOBBER" },
  });
  expect(app.texts().join("\n")).not.toContain("STALE CLOBBER");
  expect(app.texts()).toContain("Search the web for this");
  expect(app.texts()).toContain("Searching now...");
});

test("a pasted image rides into the turn as a compact thumbnail attachment without a clipboard button", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
  });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");
  expect(app.shows("Attach")).toBe(false);

  // Pasting an image URI attaches a compact square thumbnail (no filename text in composer).
  await app.paste("composer", { uris: ["file:///Users/me/Shots/pasted%20image.png"] });
  await app.waitFor("attachment-preview-attachment-drop-1");
  expect(app.texts()).not.toContain("pasted image.png");

  await app.type("composer", "What is in this image?");
  await app.press("Send");

  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "What is in this image?",
    attachments: [
      {
        mime_type: "image/png",
        image_name: "pasted image.png",
        image_path: "/Users/me/Shots/pasted image.png",
      },
    ],
  });
  // The attachment belongs to the turn that just started, not to the next one.
  expect(app.shows("attachment-preview-attachment-drop-1")).toBe(false);
});

test("the session header copies a session and selects the copy", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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

  // A direct session starts where it was asked for: All sessions › By device › the workspace.
  await showAllSessions(app, "NSH skeleton");
  await app.hover("id:sidebar-workspace-row-workspace-1");
  await app.press("sidebar-new-session-workspace-1");
  await app.waitUntil(() => backend.calls.some(call => call.action === "create_session"));
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

  // With no session, the new shell starts one from All sessions › By device ›
  // "New session here"; it starts as the agent the composer is on (the shared
  // preference), and that pick is remembered where the desktop keeps it.
  await showAllSessions(app);
  await app.hover("id:sidebar-workspace-row-workspace-1");
  await app.press("sidebar-new-session-workspace-1");
  await app.waitUntil(() => backend.calls.some(call => call.action === "create_session"));
  expect(backend.calls.find(call => call.action === "create_session")?.request).toMatchObject({
    sessionName: "New session",
    agentType: "Creative",
  });
  await app.waitFor("label:agent-picker >> text:Creative");
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

  // "Fresh session" has no turn yet, so the pick rebinds it.
  await openSession(app, "Fresh session");
  await app.press("agent-picker");
  await app.press("Ultimate");
  expect(backend.sessionModeWrites).toEqual([
    { sessionId: "session-fresh", modeId: "Ultimate", workspaceId: "workspace-1" },
  ]);
  // The host records the pick as `last_mode_id` itself; this surface no longer
  // writes the preference.
  expect(backend.settingsWrites.some(write => write.path === "app.flow_chat.last_mode_id")).toBe(false);
  await app.waitFor("label:agent-picker >> text:Ultimate");

  // The next turn runs as the agent the session is bound to, not as a constant.
  await app.type("composer", "Run as Ultimate");
  await app.press("Send");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-fresh",
    agentType: "Ultimate",
  });

  // A session that already ran a turn keeps its agent: the press asks for a new
  // session instead of rebinding a transcript produced under another agent.
  await openSessionRow(app, "NSH skeleton >> nth=0");
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

  await openSession(app, "NSH skeleton");
  await app.waitFor("label:agent-picker >> text:Standard");
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

  await openToolScene(app, "files");
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

  await openToolScene(app, "files");
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

  await openToolScene(app, "files");
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

  await openToolScene(app, "files");
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

  await openToolScene(app, "files");
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
  await app.waitFor("file-delete-confirm");
  await app.press("file-delete-confirm");
  expect(backend.calls.some(call => call.action === "delete_file")).toBe(true);
});

test("files scene searches file names through the host", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openToolScene(app, "files");
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

  await openToolScene(app, "files");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  // Consecutive non-text tool calls (todo_write + edit) fold into one collapsed activity row.
  await app.waitFor("Completed");
  expect(app.texts().join("")).toContain("1 edit, 1 step");
  await app.press("Completed");

  // Expanding the activity group reveals the compact todo strip and edit card.
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");
  // The catalog's default names the model in the composer bar before the user picks one.
  await app.waitFor("label:bot-capsule-trigger >> text:Primary model");

  await app.press("label:bot-capsule-trigger");
  // A model that cannot chat is not offered.
  // Each row: the model as the host labels it, then its provider (an older host
  // without labels reads as the entry's name and request format).
  await app.waitFor("label:model-option-fast-small >> text:Fast model");
  expect(app.texts()).not.toContain("Image model");

  await app.press("model-option-fast-small");
  const update = backend.calls.find(call => call.action === "update_session_model");
  expect(update?.request).toMatchObject({
    sessionId: "session-1",
    modelName: "fast-small",
    workspaceId: "workspace-1",
  });
  await app.waitFor("label:bot-capsule-trigger >> text:Fast model");

  // Another session shows the model its own record carries, not this one's pick,
  // and a model the catalog does not list is shown by its own id.
  await openSessionRow(app, "Terminal migration >> nth=0");
  await app.waitFor("label:bot-capsule-trigger >> text:session-only-model");
});

test("the composer offers the reasoning the chosen model supports", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  // The session reported no preset (model default): icon-only button without "Default" text clutter.
  await app.waitFor("reasoning-picker");
  expect(app.shows("label:reasoning-picker >> text:Default")).toBe(false);

  await app.press("reasoning-picker");
  await app.waitFor("reasoning-option-high");

  await app.press("reasoning-option-high");
  const update = backend.calls.filter(call => call.action === "update_session_model").at(-1);
  expect(update?.request).toMatchObject({
    sessionId: "session-1",
    modelName: "gpt-4.1-mini",
    reasoningPreset: "high",
    workspaceId: "workspace-1",
  });
  // Elevated reasoning expands into a compact tinted chip with the host-accepted label.
  await app.waitFor("label:reasoning-picker >> text:High");

  // Back to the model's own default, written as a null rather than dropped: the
  // host distinguishes "clear it" from "leave it alone", and the button returns to icon-only.
  await app.press("reasoning-picker");
  await app.press("reasoning-option-default");
  const cleared = backend.calls.filter(call => call.action === "update_session_model").at(-1);
  expect(cleared?.request).toMatchObject({ reasoningPreset: null });
  await app.waitUntil(() => app.shows("reasoning-picker") && !app.shows("label:reasoning-picker >> text:High"));
});

test("a host that declares no reasoning settings draws no control", async () => {
  const backend = createBackend({ reasoningCatalog: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("label:bot-capsule-trigger >> text:Primary model");
  expect(app.shows("reasoning-picker")).toBe(false);
});

test("the transcript shows tool cards from a turn", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  // A read is titled by its verb and the file it read, not by the raw tool name.
  await app.waitFor("NavPanel.tsx");
  const texts = app.texts().join("\n");
  expect(texts).toContain("Read");
  expect(texts).toContain("NavPanel.tsx");
});

test("a reasoning model's streamed notes never become its answer", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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
  // Live reasoning reads "Thinking…" with the matrix spinner and stays collapsed until opened.
  await app.waitFor("Thinking…");
  expect(app.texts().join("\n")).not.toContain("Weigh the options.");

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

  await showAllSessions(app, "Terminal migration");
  await openSessionRow(app, "Terminal migration");
  await app.waitFor("Thinking");

  // Collapsed: one quiet row (no character count, visual spec §5); the notes
  // themselves are not in the transcript yet.
  const collapsed = app.texts().join("\n");
  expect(collapsed).not.toContain("46 characters");
  expect(collapsed).not.toContain("Weigh the two options");

  await app.press("label:thinking-turn-2|thinking|0");
  await app.waitFor("Weigh the two options before writing anything.");
  expect(app.texts().join("\n")).toContain("Weigh the two options before writing anything.");
});

test("a reply renders as Markdown rather than as its source", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "Terminal migration");
  await openSessionRow(app, "Terminal migration");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");

  const turnsBefore = backend.actions().filter(action => action === "get_session_transcript_view").length;

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
  const turnsAfter = backend.actions().filter(action => action === "get_session_transcript_view").length;
  expect(turnsAfter).toBeGreaterThan(turnsBefore);
});

test("a pending permission request is answerable from the scene", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The prompt seeds from what is already waiting when the window attaches.
  await openSession(app, "NSH skeleton");
  await app.waitFor("Wants to run");
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
  await app.waitFor("Wants to edit 1 file");
  await app.press("deny-perm-2");
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
  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("The agent needs an answer");
  await app.waitFor("Port: Which port should the server use?");
  await app.waitFor("8080");
  await app.waitFor("the documented default");
  // Arrival alone must not cancel the host's unattended auto-proceed deadline.
  expect(backend.questionStarts).toEqual([]);

  // Interacting with an option signals the host to pause the auto-proceed timer.
  await app.press("question-tool-q1-0-8080");
  expect(backend.questionStarts).toEqual([{ sessionId: "session-1", toolId: "tool-q1" }]);
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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
  await app.waitFor("Startup");
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
  await app.waitFor("Startup");

  await app.press("notify-permission-request");
  expect(backend.settingsWrites).toContainEqual({ path: "app.notifications.permission_request_notify", value: true });

  // Each field writes its own leaf; the `editor` document is never replaced.
  await app.press("nav-settings-page-editor");
  await app.press("editor-word-wrap-on");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.word_wrap", value: "on" });

  // A typed number saves on Return (or when the field loses focus); no Save button moves the row.
  expect(app.shows("editor-font-size-save")).toBe(false);
  await app.clear("editor-font-size");
  await app.type("editor-font-size", "16");
  expect(app.shows("editor-font-size-save")).toBe(false);
  await app.submit("editor-font-size");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.font_size", value: 16 });

  // The stepper saves at once and clamps to the field's range.
  await app.press("editor-tab-size-increase");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.tab_size", value: 5 });
  await app.clear("editor-tab-size");
  await app.type("editor-tab-size", "99");
  await app.submit("editor-tab-size");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.tab_size", value: 8 });
  // A step after typing starts from the typed value instead of throwing it away.
  await app.clear("editor-tab-size");
  await app.type("editor-tab-size", "2");
  await app.press("editor-tab-size-increase");
  expect(backend.settingsWrites).toContainEqual({ path: "editor.tab_size", value: 3 });
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

  await app.waitFor("nav-library");
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
  await app.waitFor("Startup");

  // Switch live to Simplified Chinese -> entire shell + settings repaint immediately.
  // The host keeps the language through `i18n_set_language`; no `app` document is
  // read and written back from here.
  await app.press("app-language-zh-CN");
  await app.waitFor("界面语言");
  await app.waitFor("启动");
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
  await app.waitFor("Startup");
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
  // The name is a folded, optional field (it defaults to the model id).
  await app.press("model-more-options");
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

  // Removing asks in-place inside the menu ("Cancel | Confirm") before calling delete.
  await app.press("model-actions-model-1");
  await app.press("remove-model-model-1");
  await app.waitFor("model-delete-confirm-model-1");
  expect(backend.settingsWrites.filter(entry => entry.path === "ai.models")).toHaveLength(1);
  await app.press("model-delete-confirm-model-1");
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
  await app.press("model-more-options");
  await app.type("model-name", "Work model");
  await app.type("model-model-name", "gpt-4.1-mini");
  await app.type("model-base-url", "https://api.openai.com/v1");
  await app.press("save-model");
  await app.waitFor("This device is older than this window and cannot apply this change. Update OpenBitFun on it.");
  // No fallback to the whole-list write the command replaced.
  expect(backend.settingsWrites.some(write => write.path === "ai.models")).toBe(false);

  // The refused form stays open over the page (and its list) until it is closed.
  await app.press("model-editor-cancel");
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Edit rules");
  await app.press("permission-mode-auto");
  await app.waitFor("This device is older than this window and cannot apply this change. Update OpenBitFun on it.");
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
  // An edited entry already has its protocol, so it sits in the folded part.
  expect(app.shows("model-format-responses")).toBe(false);
  await app.press("model-more-options");
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
  // The (folded) name follows the picked model, not the provider.
  await app.waitFor("Added Claude Sonnet 4");
  const write = backend.settingsWrites.filter(entry => entry.path === "ai.models").pop()?.value as Array<
    Record<string, unknown>
  >;
  expect(write[1]).toMatchObject({
    name: "Claude Sonnet 4",
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

  await app.press("model-more-options");
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

test("Settings › Shortcuts lists the shell's shortcuts with their keys and writes nothing by itself", async () => {
  // wave22-p5: the page edits `app.keybindings` (test/settings-parity.test.tsx covers the writes).
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-shortcuts");
  await app.waitFor("Keyboard shortcuts");
  await app.waitFor("shortcut-keys-search.global");
  expect(app.texts()).toContain("Show or hide the sidebar");
  expect(app.texts()).toContain("⌘B");
  // The fixture's legacy entries name no shell shortcut: nothing shows as changed.
  expect(app.shows("shortcut-reset-all")).toBe(false);
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
  // A landed write is a passing check beside the control, never a banner that moves the page.
  await app.waitFor("settings-field-saved");
  expect(app.texts()).not.toContain("Saved Model that extracts memories");
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
  await app.submit("memory-max-unused-days");
  await app.waitFor(
    "The extraction window cannot be longer than the retention window: raise the retention first",
  );
  expect(backend.settingsWrites).toHaveLength(before);

  // A window above the retention is the host's refusal too; one inside it saves.
  expect(app.texts().some(text => text.includes("older than"))).toBe(true);
  await app.clear("memory-max-unused-days");
  await app.clear("memory-rollout-age-days");
  await app.type("memory-rollout-age-days", "40");
  await app.submit("memory-rollout-age-days");
  expect(backend.settingsWrites.some(entry => entry.path === "memories.max_rollout_age_days")).toBe(false);
  await app.clear("memory-rollout-age-days");
  await app.type("memory-rollout-age-days", "30");
  await app.submit("memory-rollout-age-days");
  await app.waitUntil(() =>
    backend.settingsWrites.some(entry => entry.path === "memories.max_rollout_age_days" && entry.value === 30),
  );
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
  await app.press("models-tab-pools");
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


test("terminal scene creates a host session", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openToolScene(app, "terminal");
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

  await openToolScene(app, "terminal");
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

  await openToolScene(app, "terminal");
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

  await openToolScene(app, "terminal");
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

  await openToolScene(app, "terminal");
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
  // The host keeps the profile (and mints its id); saving types nothing into a shell.
  expect(backend.calls.find(call => call.action === "upsert_terminal_profile")?.request).toMatchObject({
    workspaceId: "workspace-1",
    profile: { name: "Terminal 1", shellId: "shell-bash", shellType: "Bash", startupCommand: "pnpm run dev" },
  });
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
  expect(backend.calls.find(call => call.action === "delete_terminal_profile")?.request).toMatchObject({
    workspaceId: "workspace-1",
  });
  // Nothing is kept in this surface's storage any more.
  expect(app.storage()["openbitfun.nsh.terminal-profiles.v1"] ?? "").not.toContain("Terminal 1");
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

  await openToolScene(app, "terminal");
  await app.waitFor("shell 1");
  await app.press("profiles-toggle");
  await app.waitFor("Open Dev server");
  expect(app.texts()).toContain("Profiles 1");
  // The list an earlier build kept under the workspace root was handed to the host once
  // (the malformed row stayed behind) and then forgotten here.
  expect(backend.calls.filter(call => call.action === "import_terminal_profiles")).toHaveLength(1);
  expect(backend.calls.find(call => call.action === "import_terminal_profiles")?.request).toMatchObject({
    workspaceId: "workspace-1",
    profiles: [{ id: "p1", name: "Dev server", shellId: "shell-zsh", shellType: "Zsh", startupCommand: "pnpm run dev" }],
  });
  await app.waitUntil(() => app.storage()["openbitfun.nsh.terminal-profiles.v1"] === undefined);

  await app.press("Open Dev server");
  await app.waitFor("Dev server");
  const written = backend.calls.filter(call => call.action === "terminal_write").pop();
  expect(written?.request).toMatchObject({ data: "pnpm run dev\r" });
});

test("an older host without profile commands keeps stored profiles openable and says saving needs an update", async () => {
  const backend = createBackend({ terminalProfilesUnsupported: true });
  const app = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    storage: {
      "openbitfun.nsh.terminal-profiles.v1": JSON.stringify({
        "id:local:workspace-1": [
          { id: "p1", name: "Dev server", shellId: "shell-zsh", shellType: "Zsh", startupCommand: "pnpm run dev" },
        ],
      }),
    },
  });

  await openToolScene(app, "terminal");
  await app.waitFor("shell 1");
  await app.press("profiles-toggle");
  await app.waitFor("Open Dev server");
  await app.press("profile-save");
  await app.waitFor("This device cannot keep terminal profiles. Update OpenBitFun on it to save or delete profiles; profiles saved earlier still open.");
  expect(backend.actions()).not.toContain("upsert_terminal_profile");
  // Nothing is deleted from storage while the host cannot take the rows.
  expect(app.storage()["openbitfun.nsh.terminal-profiles.v1"]).toContain("Dev server");
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
  await app.waitFor("gpt-4.1-mini · Configured model");
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
  await app.submit("subagent-concurrency");
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
  await app.submit("approval-timeout");
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




test("external agents report why a client cannot run, and the document is written whole", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  // External agents live on the MCP servers page now.
  await app.press("nav-settings-page-mcp");
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
  await app.press("nav-settings-page-mcp");
  // The section says it is not available here instead of drawing an empty list.
  await app.waitFor("Not available on this device");
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
  // The grid is the host's view model: its total, not a sum of trend buckets.
  await app.waitFor("Each cell is one day; the busiest day is darkest. 4.0K tokens over the window.");

  // One read of the host's day-keyed activity, in this surface's zone.
  const window = backend.usageRequests.find(call => call.command === "get_token_usage_activity");
  expect(window).toMatchObject({ months: 6, includeSubagent: true });
  expect(backend.usageRequests.some(call => call.timeRange === "custom")).toBe(false);

  // Switching the range reads the range again; the grid's window does not move.
  await app.press("usage-range-today");
  await app.waitFor("Each cell is one day; the busiest day is darkest. 4.0K tokens over the window.");
  expect(backend.usageRequests.filter(call => call.command === "get_token_usage_activity").length).toBe(2);
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

test("a host older than the activity view model asks for an update instead of keying days here", async () => {
  const backend = createBackend({ usageActivityCommand: false });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("42 requests · 120K tokens");
  await app.waitFor("Update OpenBitFun on this device to see the activity chart; its version is too old to compute it.");
  expect(app.texts().join("\n")).not.toContain("tokens over the window.");
});

test("a host that offers no usage statistics says so instead of showing zeros", async () => {
  const backend = createBackend({ usage: null });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-usage");
  await app.waitFor("This device reports no usage statistics, so nothing is invented here.");
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

  await app.press("content-width-increase");
  await app.waitFor("1110px · the transcript column, shared with the desktop surface");
  expect(app.storage()["openbitfun:appearance:flowChatWidth"]).toBe("1110");

  await app.press("content-width-reset");
  await app.waitFor("760px · the transcript column, shared with the desktop surface");
  expect(app.storage()["openbitfun:appearance:flowChatWidth"]).toBe("760");
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
  await app.waitFor("760px · the transcript column, shared with the desktop surface");
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
  await app.waitFor("/tmp/openbitfun/logs/session-7");
  // The level is the select above; the section repeats neither it nor the app.log path.
  expect(app.texts().some(text => text.startsWith("Effective level"))).toBe(false);
  expect(app.texts()).not.toContain("/tmp/openbitfun/logs/session-7/app.log");
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
  await app.waitFor("This device reports no log location.");
  expect(app.shows("logging-export")).toBe(false);
  expect(app.shows("logging-open-folder")).toBe(false);
});


test("settings writes tool and hook switches as leaf paths, not whole objects", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  // Agent hooks live on the Execution page now.
  await app.press("nav-settings-page-execution");
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
  await app.submit("memory-max-unused-days");
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
  await app.waitFor("Names a session from its first message");
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
  await app.waitFor("Keep your computer awake during active runs");
  await app.press("prevent-sleep");
  expect(backend.settingsWrites).toContainEqual({ path: "app.prevent_sleep", value: true });
  await app.press("nav-settings-page-session-memory");
  await app.waitFor("Extract useful facts and preferences from conversations");
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

  // Voice input needs microphone capture, which this UI does not offer: no
  // voice settings are drawn (the host keeps whatever it stores).
  expect(app.shows("voice-input")).toBe(false);
  expect(app.shows("voice-max-seconds")).toBe(false);

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
  await app.waitFor("Not available on this device");
  await app.waitFor("This device does not support restoring removed source sessions. Update OpenBitFun on it and retry.");
  await app.press("external-import-open-agents");
  // The button opens MCP servers at its external-agents section.
  await app.waitFor("acp-json-toggle");
});

test("the stored mid-turn policy decides whether a composer message steers or queues", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // The default is queueing; Settings lets the user switch to live steering.
  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");
  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");

  await app.press("Settings");
  await app.press("nav-settings-page-input");
  await app.waitFor("Message sending");
  await app.press("mid-turn-policy-immediate");
  expect(backend.settingsWrites).toContainEqual({
    path: "app.flow_chat.send_during_turn",
    value: "immediate",
  });

  // Back to the session the message goes to.
  await openSession(app, "NSH skeleton");
  await app.waitFor("Steer this session");
  await app.type("composer", "Steer the turn");
  await app.press("Send");
  await app.waitUntil(() => backend.userMessages.length === 1);
  // The send press carries no choice of its own: the host read the stored
  // policy and steered the message into the running turn.
  const submit = backend.calls.filter(call => call.action === "submit_user_message").at(-1)?.request as Record<string, unknown>;
  expect(submit.sendDuringTurn).toBeUndefined();
  expect(backend.userMessages.at(-1)).toMatchObject({ outcome: "steered", text: "Steer the turn" });
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
  // Quick actions live on the Execution page now.
  await app.press("nav-settings-page-execution");
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
  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  await app.type("composer", "Explain @readme");
  await app.waitFor("README.md");

  // Return with a row on offer attaches it as a styled file chip instead of dumping
  // raw `#file:` text into the input, and nothing is sent yet.
  await app.submit("composer");
  expect(backend.actions()).not.toContain("submit_user_message");
  expect(app.value("composer")).toBe("Explain ");
  await app.waitFor("file-attachment-README.md");

  // The next Return sends what the composer holds together with the attached file tag.
  await app.submit("composer");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "Explain #file:README.md",
  });
});

test("typing @ in the message opens the picker and is replaced by the tag", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  // The token is typed where the message is, so the panel has no field of its own
  // and the search follows what is being written.
  await app.type("composer", "Explain @readme");
  await app.waitFor("README.md");
  expect(app.texts()).not.toContain("A press replaces the @ you typed with the tag");
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

  await showAllSessions(app, "NSH skeleton");
  await openSessionRow(app, "NSH skeleton >> nth=0");

  await app.press("composer-plus");
  await app.press("Reference");
  await app.type("mention-query", "zzz");
  await app.waitFor("No file names match “zzz”");
  // Nothing is invented to fill the list, and no tag can be pressed.
  expect(app.texts()).not.toContain("README.md");

  const refusing = createBackend({ fileSearch: false });
  const other = await open("./App.tsx", { ...DESKTOP, host: { handlers: refusing.handlers } });
  await openSession(other, "NSH skeleton");
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

  const baseline = (px: number) => `${px}px · this device's font baseline`;
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
  await app.waitFor("14px · this device's font baseline");
  // Nothing is written until the user asks for another size.
  expect(backend.settingsWrites.filter(write => write.path === "font")).toHaveLength(0);

  await app.press("font-level-compact");
  await waitForCalls(backend, "set_config");
  expect(backend.settingsWrites.at(-1)).toMatchObject({
    path: "font",
    value: { uiSize: { level: "compact" } },
  });
  await app.waitFor("12px · this device's font baseline");
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

  await showAllSessions(app, "NSH skeleton");
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




test("the sidebar layout is kept in app storage and read back on the next launch", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("label:toggle-drawer");
  await app.press("label:toggle-drawer");
  await app.waitUntil(() => (app.storage()["openbitfun.nsh.shell-layout.v1"] ?? "").includes('"drawerOpen":false'));

  const next = await open("./App.tsx", {
    ...DESKTOP,
    host: { handlers: createBackend().handlers },
    storage: { "openbitfun.nsh.shell-layout.v1": JSON.stringify({ drawerOpen: false, navWidth: 999, junk: 1 }) },
  });
  // The stored drawer state wins, and an out-of-range width is clamped rather than dropped.
  await next.waitFor("label:toggle-drawer");
  expect(next.shows("global-search-trigger")).toBe(false);
});


test("About comes from the native menu and shows this window's build", async () => {
  const backend = createBackend();
  const native = nativeWindowHandlers(backend, "macos");
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: native.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await app.host.send("openbitfun.event", { event: "openbitfun_menu_about", payload: null });
  await app.waitFor("About OpenBitFun");
  await app.waitFor("Version 1.4.2");
});

test("the account menu checks for updates, offers the download and then the restart", async () => {
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

  await app.waitFor("label:account-row");
  await app.press("label:account-row");
  await app.press("Check for updates");
  await app.waitFor("Update 1.5.0 available");
  await app.press("label:account-row");
  await app.press("Download update 1.5.0");
  await app.waitFor("Update 1.5.0 is ready to install");
  // A ready update puts one accent dot on the avatar and "Restart to update" in the menu; no banner.
  await app.waitFor("label:account-update-ready");
  await app.press("label:account-row");
  await app.waitFor("Restart to update");
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
  await app.waitFor("mcp-delete-confirm-fs-server");
  expect(backend.actions()).not.toContain("delete_mcp_server");
  await app.press("mcp-delete-confirm-fs-server");
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
  await app.waitFor("memory-reset-confirm");
  expect(resets).toBe(0);
  await app.press("memory-reset-confirm");
  await app.waitFor("Cleared the stored memories");
  expect(resets).toBe(1);
});

test("the permission page is one host read: policy, approval models and the composer switch", async () => {
  const backend = createBackend();
  const app = await open("./App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.press("Settings");
  await app.press("nav-settings-page-permissions");
  await app.waitFor("Composer switch on");
  expect(backend.calls.some(call => call.action === "get_permission_settings")).toBe(true);
  // The page no longer reads and normalizes the stored documents itself.
  expect(
    backend.calls.some(
      call => call.action === "get_config" && (call.request as Record<string, unknown>)?.path === "tool_permissions",
    ),
  ).toBe(false);
});

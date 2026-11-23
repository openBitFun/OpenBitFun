import { expect, open, test } from "nsh/test";
import { createBackend, openSession, showAllSessions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

function withCustomTurns(
  backend: ReturnType<typeof createBackend>,
  turnsBySession: Record<string, unknown[]>,
): void {
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const result = baseInvoke(data);
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    const sessionId = typeof args.request?.session_id === "string" ? args.request.session_id : "";
    if (args.action === "load_session_turns" && sessionId && sessionId in turnsBySession) {
      return { ok: true, value: turnsBySession[sessionId], transport: "dev" };
    }
    return result;
  };
}

test("welcome empty state starter cards populate composer without auto-sending", async () => {
  const backend = createBackend({
    sessions: [
      {
        sessionId: "session-empty",
        sessionName: "Fresh studio",
        lastUpdated: 1763150000000,
        messageCount: 0,
        agentType: "Standard",
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "Fresh studio");
  await app.waitFor("How can I help today?");
  expect(app.texts()).toContain("Summarize workspace architecture");
  expect(app.texts()).toContain("Review uncommitted Git changes");
  expect(app.texts()).toContain("Plan & implement a feature");
  expect(app.texts()).toContain("Set up a scheduled routine");

  await app.press("starter-card-architecture");
  expect(app.value("composer")).toBe(
    "Summarize the workspace architecture, key modules, and data flow.",
  );
  // Populating a starter card must never auto-send the turn.
  expect(backend.actions()).not.toContain("submit_user_message");

  await app.press("starter-card-git-review");
  expect(app.value("composer")).toBe(
    "Review all uncommitted Git changes and highlight risks or missing tests.",
  );
  expect(backend.actions()).not.toContain("submit_user_message");

  await app.press("Send");
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-empty",
    text: "Review all uncommitted Git changes and highlight risks or missing tests.",
    agentType: "Standard",
  });
});

test("welcome empty state also renders when no sessions exist yet", async () => {
  const backend = createBackend({ sessions: [] });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // With no session, the new shell reaches one through All sessions › By device › "New session here".
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.hover("workspace-row-workspace-1");
  await app.press("new-session-here-workspace-1");
  await app.waitFor("How can I help today?");
  await app.press("starter-card-plan-feature");
  expect(app.value("composer")).toBe("Help me plan and implement a new feature step by step.");
  // A starter card fills the composer; it never sends a turn by itself.
  expect(backend.actions()).not.toContain("submit_user_message");
});

test("tauri transcript progressively discloses thinking, compact tool strips, checklist, diff, aux file open, and live ambient status", async () => {
  const backend = createBackend({
    sessions: [
      {
        sessionId: "session-rich",
        sessionName: "Muse workflow",
        lastUpdated: 1763100000000,
        messageCount: 2,
        agentType: "Standard",
      },
    ],
  });
  withCustomTurns(backend, {
    "session-rich": [
      {
        id: "turn-rich-1",
        timestamp: 1763100000000,
        userMessage: { id: "u-1", content: "Inspect and update the pipeline." },
        modelRounds: [
          {
            modelName: "Primary model",
            durationMs: 1200,
            thinkingItems: [
              {
                id: "th-1",
                content: "Checking git status and cargo workspace before patching.",
                reasoningKind: "summary",
                isStreaming: false,
                isCollapsed: true,
                timestamp: 1,
              },
            ],
            assistantMessage: {
              id: "a-1",
              content: "Pipeline updated.\n\n- Verified tests\n- Applied patch",
              toolCalls: [
                {
                  toolName: "bash",
                  arguments: { command: "cargo test -p core" },
                },
                {
                  toolName: "todo_write",
                  arguments: {
                    todos: [
                      { content: "Analyze crate graph", status: "completed" },
                      { content: "Update pipeline", status: "completed" },
                    ],
                  },
                },
                {
                  toolName: "edit",
                  arguments: {
                    file_path: "/repo/main.rs",
                    old_string: "fn main() {\n    println!(\"hello\");\n}",
                    new_string: "fn main() {\n    println!(\"hello, world\");\n}",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Muse workflow");
  await app.waitFor("Inspect and update the pipeline.");

  // Layered progressive disclosure: compact tool strips show cleanly; reasoning & checklist/diff stay collapsed.
  await app.waitFor("Thinking summary");
  expect(app.texts()).not.toContain("Checking git status and cargo workspace before patching.");
  // Tool rows read as a localized verb plus their target, not as a raw tool name.
  await app.waitFor("Ran");
  await app.waitFor("cargo test -p core");
  await app.waitFor("Updated plan");
  await app.waitFor("Edited");
  await app.waitFor("main.rs");
  await app.waitFor("checklist 2/2");
  await app.waitFor("Primary model · 1.2s");

  // Expanding thinking reveals the reasoning notes.
  await app.press("label:thinking-turn-rich-1|thinking|0");
  await app.waitFor("Checking git status and cargo workspace before patching.");

  // Expanding checklist displays visual progress and todo rows.
  await app.press("tool-card-todo_write");
  await app.waitFor("Analyze crate graph");
  await app.waitFor("Update pipeline");

  // Expanding edit tool card shows DiffView, and clicking Open in Files opens AuxPane Files workbench.
  await app.press("tool-card-edit");
  expect(app.texts().join("\n")).toContain("hello, world");
  expect(app.shows("open-tool-file-edit")).toBe(true);
  await app.press("open-tool-file-edit");
  await app.waitFor("Explorer");

  // Live streaming turn shows ambient status strip above composer and live thinking block.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-rich", turnId: "turn-live-tauri" },
  });
  // The header carries the running state; the ambient strip above the composer is gone (visual spec §5).
  await app.waitFor("session-status-working");

  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-rich", text: "Evaluating edge cases.", contentType: "thinking" },
  });
  await app.waitFor("Thinking…");
  // Live reasoning opens by itself while the model is still thinking.
  await app.waitFor("Evaluating edge cases.");

  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-rich", delta: "All checks are green." },
  });
  await app.waitFor("All checks are green.");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-rich", turnId: "turn-live-tauri" },
  });
  // The live reply stays until the host's durable fence says the turn is final
  // (transcript view, wave 4): completion is emitted before persistence.
  await app.waitFor("All checks are green.");
  await app.host.send("openbitfun.event", {
    event: "agentic://session-history-changed",
    payload: { sessionId: "session-rich", settledTurnId: "turn-live-tauri" },
  });
  await app.waitFor("Streaming response…", { state: "gone" });
});

test("conversation sub-header search, copy transcript, thread actions overlay, fork, and tab close glyph invariants", async () => {
  const backend = createBackend();
  withCustomTurns(backend, {
    "session-1": [
      {
        id: "turn-1",
        turnId: "turn-1",
        userMessage: { id: "user-1", content: "Port the session list." },
        modelRounds: [{ assistantMessage: { id: "a-1", content: "Done with the list." } }],
      },
      {
        id: "turn-2",
        turnId: "turn-2",
        userMessage: { id: "user-2", content: "Prepare fork point." },
        modelRounds: [{ assistantMessage: { id: "a-2", content: "Ready to fork." } }],
      },
    ],
  });
  let copied = "";
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    modules: {
      nsh: {
        "Clipboard.writeText": (value: string) => {
          copied = value;
        },
      },
    },
  });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Ready to fork.");
  // Literal "×" is never rendered outside open tab close buttons inside thread actions overlay.
  expect(app.texts().filter(text => text === "×")).toHaveLength(0);

  // Transcript search filters and highlights matching turns (the header keeps
  // title + status + "…"; search and copy live in the "…" menu).
  await app.press("thread-actions-trigger");
  await app.press("transcript-search-toggle");
  await app.type("transcript-search-input", "fork");
  await app.waitFor("1 match");
  await app.press("close-transcript-search");

  // Copy transcript writes full user + assistant dialogue.
  await app.press("thread-actions-trigger");
  await app.press("copy-transcript");
  expect(copied).toContain("Port the session list.");
  expect(copied).toContain("Ready to fork.");

  // Thread actions anchored overlay opens tabs ("×") and Fork.
  await app.press("thread-actions-trigger");
  await app.waitFor("Open tabs");
  expect(app.texts().filter(text => text === "×")).toHaveLength(1);

  await app.press("Fork");
  expect(backend.calls.find(call => call.action === "fork_session")?.request).toMatchObject({
    source_session_id: "session-1",
    source_turn_id: "turn-2",
    workspace_id: "workspace-1",
  });
});

test("layered 3-band chat input dock supports attachments, agent selector, unified model/reasoning capsule, and quick actions", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    modules: {
      nsh: {
        "Clipboard.readImage": () => ({
          url: "file:///tmp/screenshot.png",
          size: { width: 800, height: 600 },
        }),
      },
    },
  });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Message");

  // Band 1 attachment chip uses vector close icon rather than literal "×".
  await app.press("Attach");
  await app.waitFor("screenshot.png");
  expect(app.texts().filter(text => text === "×")).toHaveLength(0);
  await app.press("remove-attachment-attachment-1");
  expect(app.texts()).not.toContain("screenshot.png");

  // Band 3 selectors open anchored Overlays cleanly.
  await app.press("bot-capsule-trigger");
  await app.waitFor("text:Fast model");
  await app.press("reasoning-picker");
  expect(app.texts()).not.toContain("Fast model");
  await app.waitFor("reasoning-option-high");

  await app.press("agent-picker");
  expect(app.texts()).not.toContain("reasoning-option-high");
  await app.waitFor("Profiles");
  await app.waitFor("Agents");

  // Rarely used controls live in the composer's "+" menu.
  await app.press("composer-plus");
  await app.press("Actions");
  await app.waitFor("Commit");
});

test("permission card and interactive question options answer blocking host interactions", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Wants to run");
  expect(app.texts()).toContain("cargo test -p openbitfun-desktop");

  await app.press("Allow once");
  expect(backend.calls.find(call => call.action === "respond_permission")?.request).toMatchObject({
    requestId: "perm-1",
    reply: "once",
  });
  expect(app.texts()).not.toContain("Wants to run");

  await app.host.send("openbitfun.event", {
    event: "backend-event-toolawaitinguserinput",
    payload: {
      toolId: "tool-tauri-q",
      sessionId: "session-1",
      questions: {
        questions: [
          {
            question: "Pick a target",
            header: "Target",
            multiSelect: false,
            options: [
              { label: "Desktop", description: "Local Tauri workspace" },
              { label: "Remote", description: "SSH host" },
            ],
          },
        ],
        responseHostNowMs: 1,
        responseDeadlineMs: 0,
      },
    },
  });
  await app.waitFor("Target: Pick a target");
  await app.press("question-tool-tauri-q-0-Desktop");
  await app.press("Send answer");
  expect(backend.userAnswers).toEqual([
    { toolId: "tool-tauri-q", answers: { "0": "Desktop" }, sessionId: "session-1" },
  ]);
});

test("sessions scene repaints reactively across dark and light Tauri palettes", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    colorScheme: "dark",
  });

  await openSession(app, "NSH skeleton");
  // The idle shortcut hint is gone (visual spec §5); a tool row's target is muted text too.
  await app.waitFor("NavPanel.tsx");
  expect(app.spanStyle("NavPanel.tsx").color).toBe("#9e9ea6ff");

  await app.press("Settings");
  // Settings opens on General; the scheme lives on the Appearance page.
  await app.press("nav-settings-page-appearance");
  await app.waitFor("appearance-light");
  await app.press("appearance-light");
  // Back to the session through All sessions (the new shell has no settings back row).
  await openSession(app, "NSH skeleton");
  await app.waitFor("NavPanel.tsx");
  expect(app.spanStyle("NavPanel.tsx").color).toBe("#5c6672ff");
});

test("rename sends the whole session record the host deserializes", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.press("thread-actions-trigger");
  await app.press("Rename");
  await app.type("session-rename", "Renamed session");
  await app.press("Save");
  const request = backend.calls.find(call => call.action === "save_session_metadata")?.request as
    | { metadata: Record<string, unknown>; fields: string[] }
    | undefined;
  expect(request?.fields).toEqual(["sessionName"]);
  expect(request?.metadata).toMatchObject({
    sessionId: "session-1",
    sessionName: "Renamed session",
    agentType: "Standard",
    status: "active",
  });
  for (const field of ["modelName", "createdAt", "lastActiveAt", "turnCount", "messageCount", "toolCallCount"]) {
    expect(field in (request?.metadata ?? {})).toBe(true);
  }
  // Fields this surface adds while normalizing never reach the host record.
  expect("persistedStatus" in (request?.metadata ?? {})).toBe(false);
});

test("a persisted round keeps its order and every tool card shows its result", async () => {
  const backend = createBackend({
    sessions: [{ sessionId: "session-ordered", sessionName: "Ordered", lastUpdated: 1763100000000, messageCount: 2, agentType: "Standard" }],
  });
  withCustomTurns(backend, {
    "session-ordered": [
      {
        turnId: "turn-o-1",
        userMessage: { id: "u", content: "Run the suite." },
        status: "completed",
        modelRounds: [
          {
            id: "round-1",
            textItems: [
              { id: "t-1", content: "Let me run the tests.", orderIndex: 0 },
              { id: "t-2", content: "All tests passed.", orderIndex: 2 },
            ],
            toolItems: [
              {
                id: "tool-1",
                toolName: "ExecCommand",
                orderIndex: 1,
                toolCall: { id: "tool-1", input: { cmd: "cargo test -p core" } },
                toolResult: { success: true, result: { output: "test result: ok. 12 passed", exit_code: 0 } },
              },
              {
                id: "tool-2",
                toolName: "Read",
                orderIndex: 3,
                toolCall: { id: "tool-2", input: { file_path: "/repo/missing.rs" } },
                toolResult: { success: false, result: null, error: "No such file" },
              },
            ],
          },
        ],
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Ordered");
  await app.waitFor("All tests passed.");
  const texts = app.texts();
  const before = texts.indexOf("Let me run the tests.");
  const command = texts.indexOf("cargo test -p core");
  const after = texts.indexOf("All tests passed.");
  expect(before).toBeGreaterThanOrEqual(0);
  expect(command).toBeGreaterThan(before);
  expect(after).toBeGreaterThan(command);
  // A successful exit code is a hover hint, not a mark on the row.
  expect(texts).not.toContain("exit 0");

  await app.press("tool-card-ExecCommand");
  await app.waitFor("test result: ok. 12 passed");
  expect(app.texts()).toContain("Output");

  // A failed call says so and shows the host's error.
  await app.waitFor("Failed");
  await app.press("tool-card-Read");
  await app.waitFor("No such file");
});

test("a live round cuts its text at each tool call and shows the tool's result", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  const send = (event: string, payload: Record<string, unknown>) =>
    app.host.send("openbitfun.event", { event, payload: { sessionId: "session-1", turnId: "turn-live", ...payload } });
  await send("agentic://dialog-turn-started", {});
  await send("agentic://text-chunk", { roundId: "r1", text: "First I check the build." });
  await send("agentic://tool-event", {
    roundId: "r1",
    toolEvent: { event_type: "Started", tool_id: "live-1", tool_name: "ExecCommand", params: { cmd: "cargo build" } },
  });
  await app.waitFor("Running");
  await send("agentic://tool-event", {
    roundId: "r1",
    toolEvent: {
      event_type: "Completed",
      tool_id: "live-1",
      tool_name: "ExecCommand",
      result: { output: "Finished dev profile", exit_code: 0 },
      duration_ms: 1200,
    },
  });
  await send("agentic://text-chunk", { roundId: "r1", text: " The build is clean." });
  await app.waitFor("The build is clean.");
  const texts = app.texts();
  expect(texts.indexOf("First I check the build.")).toBeLessThan(texts.indexOf("cargo build"));
  expect(texts.indexOf("cargo build")).toBeLessThan(texts.indexOf("The build is clean."));

  await app.press("tool-card-ExecCommand");
  await app.waitFor("Finished dev profile");
});

test("a running turn keeps streaming while another session is open", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-bg", userInput: "Keep going" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "turn-bg", roundId: "r1", text: "Part one." },
  });
  await app.waitFor("Part one.");

  await openSession(app, "Terminal migration");
  await app.waitFor("Port the terminal.");
  expect(app.texts()).not.toContain("Part one.");
  // While the session is away its turn keeps arriving.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "turn-bg", roundId: "r1", text: " Part two." },
  });
  expect(app.texts().join("\n")).not.toContain("Part two.");

  await openSession(app, "NSH skeleton");
  await app.waitFor("Part one. Part two.");
  expect(app.texts()).toContain("Keep going");
});

test("a turn footer forks from that turn and opens the fork", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");
  await app.press("fork-turn-turn-1");
  expect(backend.calls.find(call => call.action === "fork_session")?.request).toMatchObject({
    source_session_id: "session-1",
    source_turn_id: "turn-1",
    workspace_id: "workspace-1",
  });
  // The fork the host answered with is the session now open.
  await app.waitFor("Fork of turn-1");
  await app.waitUntil(() =>
    backend.calls.some(call => call.action === "get_session_transcript_view" && (call.request as { session_id?: string })?.session_id === "session-fork"),
  );
});

test("the permission pill writes the session's mode", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("composer-plus");
  await app.press("composer-plus");
  await app.press("permission-mode-pill");
  // Opening from "+" aligns to start above the "+" button.
  await app.waitFor("label:permission-mode-popover-start");
  await app.press("permission-mode-full_access");
  expect(backend.calls.find(call => call.action === "update_session_permission_mode")?.request).toMatchObject({
    sessionId: "session-1",
    mode: "full_access",
    workspaceId: "workspace-1",
  });
  await app.waitFor("Full access");

  // Pressing the inline FullAccessNotice trigger opens the popover right-aligned over itself, not over "+".
  await app.press("permission-mode-warning");
  await app.waitFor("label:permission-mode-popover-end");
  await app.press("permission-mode-warning");
  await app.waitFor("id:permission-mode-surface", { state: "gone" });

  // Opening again from "+" restores start alignment on the "+" anchor.
  await app.press("composer-plus");
  await app.press("permission-mode-pill");
  await app.waitFor("label:permission-mode-popover-start");
});

test("editing a user message rolls back to that turn and reruns it", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Add the plan and fix the imports.");
  await app.press("edit-rerun-turn-2");
  await app.waitFor("Roll back and rerun");
  await app.press("Roll back and rerun");
  expect(backend.calls.find(call => call.action === "rollback_session_to_turn")?.request).toMatchObject({
    sessionId: "session-1",
    targetTurnId: "turn-2",
    workspaceId: "workspace-1",
    requireIdle: true,
  });
  await app.waitUntil(() => backend.actions().includes("submit_user_message"));
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    sessionId: "session-1",
    text: "Add the plan and fix the imports.",
  });
});

test("the context ring reports the window the host measured", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");
  expect(app.shows("context-usage")).toBe(false);
  await app.host.send("openbitfun.event", {
    event: "agentic://token-usage-updated",
    payload: { sessionId: "session-1", turnId: "t", inputTokens: 1200, outputTokens: 300, maxContextTokens: 128000, isSubagent: false },
  });
  await app.waitFor("context-usage");
  await app.press("context-usage");
  await app.waitFor("1.2K of 128K tokens (1%)");
});

test("slash commands run the host command instead of sending a turn", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  // The menu is the host's list, the one the IM bots offer too.
  await app.waitUntil(() => backend.actions().includes("list_session_commands"));
  await app.type("composer", "/co");
  await app.waitFor("slash-command-compact");
  await app.press("slash-command-compact");
  expect(backend.calls.find(call => call.action === "execute_session_command")?.request).toMatchObject({
    sessionId: "session-1",
    id: "compact",
    workspaceId: "workspace-1",
  });
  expect(app.value("composer")).toBe("");

  await app.type("composer", "/reload skills");
  await app.submit("composer");
  const reload = backend.calls.filter(call => call.action === "execute_session_command").at(-1);
  expect(reload?.request).toMatchObject({ sessionId: "session-1", id: "reload", arg: "skills" });
  expect(backend.actions()).not.toContain("submit_user_message");
  // The per-command host calls the composer used to choose itself are gone.
  expect(backend.actions()).not.toContain("compact_session");
  expect(backend.actions()).not.toContain("reload_session_context");
});

test("a host without session commands says so instead of listing a client copy", async () => {
  const backend = createBackend();
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const action = (data as { action?: string })?.action;
      if (action === "list_session_commands" || action === "execute_session_command") {
        return { ok: false, error: `Command not found: ${action}` };
      }
      return backend.handlers["openbitfun.invoke"]!(data);
    },
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");
  await app.type("composer", "/");
  await app.waitFor("Update OpenBitFun on this device to use /compact, /init, and /reload.");
  expect(app.shows("slash-command-compact")).toBe(false);
});

test("the host decides whether a mid-turn message steers or queues", async () => {
  const backend = createBackend({ hostQueue: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");
  // Empty composer during a running turn shows Stop, not Send.
  expect(app.shows("Stop")).toBe(true);
  expect(app.shows("Send")).toBe(false);

  // Typing replaces Stop with the normal Send button (no extra Steer / Queue pills).
  await app.type("composer", "Then the docs");
  expect(app.shows("Send")).toBe(true);
  expect(app.shows("Stop")).toBe(false);
  expect(app.texts()).not.toContain("Steer");
  expect(app.texts()).not.toContain("Queue");

  // Default policy is `queue`; the composer sends without an override and the host queues it.
  await app.press("Send");
  await app.waitFor("Then the docs");
  expect(backend.userMessages[0]).toMatchObject({ sessionId: "session-1", outcome: "queued", text: "Then the docs" });
  const queued = backend.calls.find(call => call.action === "submit_user_message")?.request as Record<string, unknown>;
  expect(queued).toMatchObject({ sessionId: "session-1", text: "Then the docs", workspaceId: "workspace-1" });
  expect(queued.sendDuringTurn).toBeUndefined();
  expect(app.value("composer")).toBe("");
  // After sending clears the composer, the Stop button returns while the turn is still running.
  expect(app.shows("Stop")).toBe(true);
  // No client-side queue copy and no client steering call.
  expect(backend.actions()).not.toContain("steer_dialog_turn");
  expect(app.storage()["openbitfun.nsh.pending-queue.v1"]).toBeUndefined();
});

test("a host without a queue or submit_user_message is told to update, nothing is kept here", async () => {
  const backend = createBackend();
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      if ((data as { action?: string })?.action === "submit_user_message") {
        return { ok: false, error: "Command not found: submit_user_message" };
      }
      return backend.handlers["openbitfun.invoke"]!(data);
    },
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  // An idle session still starts its turn on the older host.
  await app.type("composer", "Start here");
  await app.press("Send");
  await app.waitUntil(() => backend.actions().includes("start_dialog_turn"));
  expect(backend.calls.find(call => call.action === "start_dialog_turn")?.request).toMatchObject({
    sessionId: "session-1",
    userInput: "Start here",
    workspaceId: "workspace-1",
  });

  // During a turn the message stays in the composer with the update notice.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");
  // Without the host queue there is an explicit state, not a local list.
  await app.waitFor("This device has no message queue. Update OpenBitFun on it to queue messages during a turn.");
  await app.type("composer", "Mid-turn note");
  await app.submit("composer");
  await app.waitFor("send-host-update");
  expect(app.value("composer")).toBe("Mid-turn note");
  expect(backend.actions()).not.toContain("steer_dialog_turn");
  expect(app.storage()["openbitfun.nsh.pending-queue.v1"]).toBeUndefined();
});

test("stop goes through the host's stop, which picks interrupt or cancel", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");
  backend.setRunningTurn("session-1", "turn-9");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "turn-9" },
  });
  await app.waitFor("Queue follow-up…");
  await app.press("Stop");
  await app.waitUntil(() => backend.actions().includes("stop_dialog_turn"));
  expect(backend.calls.find(call => call.action === "stop_dialog_turn")?.request).toMatchObject({
    sessionId: "session-1",
    dialogTurnId: "turn-9",
  });
  expect(backend.actions()).not.toContain("interrupt_dialog_turn");
  expect(backend.actions()).not.toContain("cancel_dialog_turn");
});

test("unread marks are the host's, and legacy local seen marks are handed over once", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    storage: { "openbitfun.nsh.session-seen.v1": JSON.stringify({ "session-2": 1762950000000 }) },
  });
  await showAllSessions(app, "NSH skeleton");
  // The legacy stamp travels to the host with the row's workspace, once.
  await app.waitUntil(() => backend.seenMarks.some(mark => mark.sessionId === "session-2"));
  expect(backend.seenMarks.find(mark => mark.sessionId === "session-2")).toMatchObject({
    sessionId: "session-2",
    seenThroughMs: 1762950000000,
  });
  await app.waitUntil(() => app.storage()["openbitfun.nsh.session-seen.v1"] === undefined);
  expect(backend.calls.find(call => call.action === "mark_session_seen")?.request).toMatchObject({
    workspaceId: "workspace-1",
  });

  // Opening a session acknowledges the host receipt; no local stamp is written.
  await openSession(app, "NSH skeleton");
  await app.waitUntil(() => backend.seenMarks.some(mark => mark.sessionId === "session-1"));
  expect(app.storage()["openbitfun.nsh.session-seen.v1"]).toBeUndefined();
});

test("a long history opens on its newest turns and loads earlier ones on request", async () => {
  const turns = Array.from({ length: 3 }, (_, index) => ({
    turnId: `turn-${index + 1}`,
    userMessage: { id: `u-${index}`, content: `Question ${index + 1}` },
    modelRounds: [{ textItems: [{ id: `t-${index}`, content: `Answer ${index + 1}` }] }],
  }));
  const backend = createBackend({
    sessions: [
      { sessionId: "session-long", sessionName: "Long history", lastUpdated: 1763100000000, messageCount: 80, turnCount: 40, agentType: "Standard" } as never,
    ],
  });
  withCustomTurns(backend, { "session-long": turns });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Long history");
  await app.waitFor("Answer 3");
  const first = backend.calls.find(call => call.action === "get_session_transcript_view")?.request;
  expect(first).toMatchObject({ session_id: "session-long", limit: 30 });
  await app.waitFor("load-earlier-turns");
  await app.press("load-earlier-turns");
  await app.waitUntil(() =>
    backend.calls.some(call => call.action === "get_session_transcript_view" && (call.request as { limit?: number })?.limit === 60),
  );
});

test("an approval can be rejected with a reason the agent receives", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Wants to run");
  await app.press("reject-with-reason-perm-1");
  await app.type("reject-reason-perm-1", "Use the dry-run flag first");
  await app.press("Reject with reason");
  expect(backend.calls.find(call => call.action === "respond_permission")?.request).toMatchObject({
    requestId: "perm-1",
    reply: "reject",
    feedback: "Use the dry-run flag first",
  });
  await app.waitFor("Wants to run", { state: "gone" });
});

test("a 200-turn transcript with tool output renders, and a 2,000-chunk stream completes", async () => {
  const bigOutput = Array.from({ length: 120 }, (_, line) => `line ${line} of a long build log`).join("\n");
  const hugeReply = Array.from({ length: 600 }, (_, line) => `Paragraph ${line}: the long reply keeps going.\n`).join("\n");
  const turns = Array.from({ length: 200 }, (_, index) => ({
    turnId: `perf-${index + 1}`,
    userMessage: { id: `u-${index}`, content: `Question ${index + 1}` },
    status: "completed",
    modelRounds: [
      {
        id: `round-${index}`,
        textItems: [
          { id: `t-${index}-a`, content: `Looking at step ${index + 1}.`, orderIndex: 0 },
          { id: `t-${index}-b`, content: index === 199 ? hugeReply : `Answer ${index + 1}`, orderIndex: 2 },
        ],
        toolItems: [
          {
            id: `tool-${index}`,
            toolName: "ExecCommand",
            orderIndex: 1,
            toolCall: { id: `tool-${index}`, input: { cmd: `cargo test --step ${index + 1}` } },
            toolResult: { success: true, result: { output: `${bigOutput}\nstep ${index + 1} done`, exit_code: 0 } },
          },
        ],
      },
    ],
  }));
  const backend = createBackend({
    sessions: [
      { sessionId: "session-perf", sessionName: "Long day", lastUpdated: 1763100000000, messageCount: 400, turnCount: 200, agentType: "Standard" } as never,
    ],
  });
  withCustomTurns(backend, { "session-perf": turns });
  // A manual clock: every host event resolves once the app is quiet, and with the
  // system clock each wait would also sit out real idle time; this one measures
  // the app's own work per chunk.
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers }, clock: {} });

  await openSession(app, "Long day");
  const started = Date.now();
  await app.waitFor("Answer 199", { timeout: 20_000 });
  const renderMs = Date.now() - started;
  expect(renderMs).toBeLessThan(20_000);
  // Tool output stays collapsed and is not laid out until the row is opened.
  expect(app.texts().join("\n")).not.toContain("step 1 done");
  // The oversized reply opens as a preview and lays out the rest on request.
  expect(app.texts().join("\n")).toContain("Paragraph 0:");
  expect(app.texts().join("\n")).not.toContain("Paragraph 599:");
  const fullReply = app.texts().find(text => text.startsWith("Show the full reply"));
  expect(fullReply).toBeTruthy();
  await app.press(fullReply!);
  await app.waitFor("Paragraph 599: the long reply keeps going.");

  // A settled card opens on press.
  const outputShown = () => app.texts().some(text => text.includes("step 1 done"));
  await app.press("tool-card-ExecCommand >> nth=0");
  await app.waitUntil(outputShown);

  const send = (event: string, payload: Record<string, unknown>) =>
    app.host.send("openbitfun.event", { event, payload: { sessionId: "session-perf", turnId: "perf-live", ...payload } });
  await send("agentic://dialog-turn-started", { userInput: "Stream a lot" });
  const streamStarted = Date.now();
  for (let chunk = 0; chunk < 2000; chunk += 1) {
    await send("agentic://text-chunk", { roundId: "r-live", text: chunk === 1999 ? " stream-finished." : `w${chunk} ` });
  }
  await app.waitUntil(() => app.texts().some(text => text.includes("stream-finished.")), { timeout: 20_000 });
  // About a millisecond per chunk headless with 200 settled turns on screen: the
  // settled rows are not evaluated again while the live reply grows.
  expect(Date.now() - streamStarted).toBeLessThan(30_000);
  await send("agentic://dialog-turn-completed", {});
  // The host's durable fence settles the turn (transcript view, wave 4).
  await send("agentic://session-history-changed", { settledTurnId: "perf-live" });
  await app.waitFor("Streaming response…", { state: "gone", timeout: 10_000 });
  // The settled card the reader opened stays open across the reload.
  expect(outputShown()).toBe(true);
}, 120_000);

test("a narrow chat runs full width with the composer controls in its + menu", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, width: 1440, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Attach");
  expect(app.shows("agent-picker")).toBe(true);

  await app.setViewport(480, 900);
  await app.waitFor("Attach", { state: "gone" });
  expect(app.shows("agent-picker")).toBe(false);
  expect(app.shows("composer-plus")).toBe(true);
  // On a narrow column the row keeps only "+" and Send (both 44 pt touch targets).
  expect(app.shows("Send")).toBe(true);
  expect(app.shows("thread-actions-trigger")).toBe(true);

  // The "+" menu holds attach, agent, model and the rarely used controls.
  await app.press("composer-plus");
  await app.waitFor("Attach");
  expect(app.shows("Reference")).toBe(true);
  expect(app.shows("permission-mode-pill")).toBe(true);
  await app.press("agent-picker");
  await app.waitFor("Profiles");

  // Back to a wide window, the row shows its controls again.
  await app.setViewport(1440, 900);
  await app.waitFor("agent-picker");
});

// transcript view (wave 4)
test("an older host without the transcript view says so instead of projecting turns itself", async () => {
  const backend = createBackend({ transcriptViewUnsupported: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("transcript-host-update");
  expect(app.texts().join("\n")).toContain("This device cannot show the conversation");
  // No client-side projection of the raw records, and no welcome screen either.
  expect(app.texts()).not.toContain("Port the session list.");
  expect(app.texts()).not.toContain("How can I help today?");
  expect(backend.actions()).toContain("get_session_transcript_view");
});

test("a live turn gives way when the host's view reports it settled, and re-reads ask only for what changed", async () => {
  const backend = createBackend();
  const persisted: Array<Record<string, unknown>> = [
    {
      id: "turn-1",
      turnIndex: 0,
      status: "completed",
      userMessage: { id: "user-1", content: "Port the session list." },
      modelRounds: [{ textItems: [{ id: "t-1", content: "Rendered with a virtualized list." }] }],
    },
  ];
  withCustomTurns(backend, { "session-1": persisted });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Rendered with a virtualized list.");

  const send = (event: string, payload: Record<string, unknown>) =>
    app.host.send("openbitfun.event", { event, payload: { sessionId: "session-1", turnId: "turn-2", ...payload } });
  await send("agentic://dialog-turn-started", { userInput: "Keep going." });
  await send("agentic://text-chunk", { roundId: "r-2", text: "Live answer." });
  await app.waitFor("Live answer.");

  // The host persisted the turn's shell when it started; completion comes
  // before the final record, so the live reply must stay.
  persisted.push({
    id: "turn-2",
    turnIndex: 1,
    status: "inProgress",
    userMessage: { id: "user-2", content: "Keep going." },
    modelRounds: [],
  });
  await send("agentic://dialog-turn-completed", {});
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(app.texts()).toContain("Live answer.");

  persisted[1] = {
    ...persisted[1],
    status: "completed",
    modelRounds: [{ textItems: [{ id: "t-2", content: "Persisted answer." }] }],
  };
  await send("agentic://session-history-changed", { settledTurnId: "turn-2" });
  await app.waitFor("Persisted answer.");
  await app.waitFor("Live answer.", { state: "gone" });
  expect(app.texts()).toContain("Rendered with a virtualized list.");

  const viewReads = backend.calls
    .filter(call => call.action === "get_session_transcript_view")
    .map(call => call.request as { cursor?: string });
  expect(viewReads.length).toBeGreaterThanOrEqual(3);
  // After the first full read every re-read names the last settled turn.
  expect(viewReads[viewReads.length - 1].cursor ?? "").toContain("tv1:0:");
});

test("/model switches models locally, bare /goal & /btw open dialogs, and visualize/Skill cards render cleanly", async () => {
  const backend = createBackend();
  withCustomTurns(backend, {
    "session-1": [
      {
        id: "turn-vis",
        turnIndex: 0,
        status: "completed",
        userMessage: { id: "u-vis", content: "Plot latency" },
        modelRounds: [
          {
            toolItems: [
              {
                id: "tool-skill-1",
                toolName: "Skill",
                toolCall: { input: { command: "visualize" } },
                toolResult: { result: "Loaded visualize skill", success: true },
              },
            ],
            textItems: [
              {
                id: "txt-vis",
                content:
                  'Latency summary:\n\uE200visualize\uE202{"path":"openbitfun://current-session/artifacts/visualizations/v2/p99-latency.html","title":"P99 Latency"}\uE201',
              },
            ],
          },
        ],
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Latency summary:");

  // Raw Private-Use visualize marker must never appear in transcript prose.
  const allText = app.texts().join("\n");
  expect(allText).not.toContain("\uE200visualize");
  expect(allText).not.toContain("openbitfun://current-session/artifacts/visualizations/v2/p99-latency.html\uE201");
  await app.waitFor("id:inline-figure-p99-latency");
  expect(app.shows("id:inline-figure-p99-latency >> text:P99 Latency")).toBe(true);

  // Skill({ command: "visualize" }) renders as Skills card, never shell "Ran".
  expect(app.shows("text:Skills")).toBe(true);
  expect(app.shows("text:visualize")).toBe(true);
  expect(app.shows("text:Ran")).toBe(false);

  // `/model` opens picker without sending literal text to the AI.
  await app.type("composer", "/model");
  await app.waitFor("slash-command-model");
  await app.submit("composer");
  expect(app.value("composer")).toBe("");
  expect(backend.actions()).not.toContain("submit_user_message");

  // Bare `/goal` and `/btw` do not fall through as literal prompts.
  await app.type("composer", "/goal");
  await app.submit("composer");
  expect(app.value("composer")).toBe("");
  await app.type("composer", "/btw");
  await app.submit("composer");
  expect(app.value("composer")).toBe("");
  expect(backend.actions()).not.toContain("submit_user_message");
});

test("assistant workspace exposes only Claw, locks composer switcher, and does not pollute project defaults", async () => {
  const backend = createBackend({
    openedWorkspaces: [
      { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
      { id: "asst-1", name: "Muse", rootPath: "/assistants/muse", workspaceKind: "assistant" },
    ],
    sessions: [
      {
        sessionId: "proj-session",
        sessionName: "Project thread",
        lastUpdated: 1763100000000,
        messageCount: 1,
        agentType: "Creative",
        workspaceId: "workspace-1",
      },
    ],
    configs: {
      "app.flow_chat": { default_mode_strategy: "follow_last", last_mode_id: "Creative" },
    },
  });

  // Verify the backend catalog contract directly for assistant vs project workspaces.
  const assistantCatalog = (
    backend.handlers["openbitfun.invoke"]({
      action: "get_session_mode_catalog",
      request: { workspaceId: "asst-1", workspacePath: "/assistants/muse" },
    }) as { ok: boolean; value: { defaultModeId: string; entries: Array<{ id: string }> } }
  ).value;
  expect(assistantCatalog.defaultModeId).toBe("Claw");
  expect(assistantCatalog.entries.map(entry => entry.id)).toEqual(["Claw"]);

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  // Start in the project workspace on Creative.
  await openSession(app, "Project thread");
  await app.waitFor("label:agent-picker >> text:Creative");

  // Switch to the assistant workspace and create a new session from All sessions › By device.
  await showAllSessions(app, "Project thread");
  await app.press("all-sessions-tab-by-device");
  await app.hover("workspace-row-asst-1");
  await app.press("new-session-here-asst-1");
  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "asst-1",
    ),
  );
  const assistantCreate = backend.calls.find(
    call => call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "asst-1",
  );
  expect(assistantCreate?.request).toMatchObject({
    workspaceId: "asst-1",
    agentType: "Claw",
  });

  // Composer calmly displays Claw as a non-interactive locked badge (not a mode switcher).
  await app.waitFor("label:agent-picker >> text:Claw");
  expect(app.shows("label:agent-picker >> text:Claw")).toBe(true);
  await expect(app.press("agent-picker")).rejects.toThrow(/no pressable/i);
  expect(app.shows("agent-option-Standard")).toBe(false);
  expect(app.shows("agent-option-Ultimate")).toBe(false);
  expect(app.shows("agent-option-Creative")).toBe(false);
  expect(app.texts()).not.toContain("Profiles");

  // Switching back to the project workspace and starting a new session keeps Creative (not Claw).
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.hover("workspace-row-workspace-1");
  await app.press("new-session-here-workspace-1");
  await app.waitUntil(() =>
    backend.calls.some(
      call =>
        call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "workspace-1",
    ),
  );
  const projectCreate = backend.calls.find(
    call =>
      call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "workspace-1",
  );
  expect(projectCreate?.request).toMatchObject({
    workspaceId: "workspace-1",
    agentType: "Creative",
  });
  await app.waitFor("label:agent-picker >> text:Creative");

  // Re-open the assistant session on a compact viewport: the `+` menu keeps Agent: Claw disabled.
  await showAllSessions(app);
  await app.press("all-sessions-tab-by-device");
  await app.hover("workspace-row-asst-1");
  await app.press("new-session-here-asst-1");
  await app.waitFor("label:agent-picker >> text:Claw");
  await app.setViewport(480, 900);
  await app.waitFor("composer-plus");
  await app.press("composer-plus");
  await app.waitFor("label:agent-picker >> text:Agent: Claw");
  expect(app.enabled("agent-picker")).toBe(false);
});

test("creating a session from the sidebar assistant `+` clears stale project mode choices and locks to Claw", async () => {
  const backend = createBackend({
    openedWorkspaces: [
      { id: "workspace-1", name: "openbitfun", rootPath: "/Users/me/openbitfun", workspaceKind: "local" },
      { id: "asst-1", name: "Muse", rootPath: "/assistants/muse", workspaceKind: "assistant" },
    ],
    sessions: [
      {
        sessionId: "proj-session",
        sessionName: "Project thread",
        lastUpdated: 1763100000000,
        messageCount: 0,
        agentType: "Creative",
        workspaceId: "workspace-1",
      },
    ],
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Project thread");
  await app.waitFor("label:agent-picker >> text:Creative");

  // Starting a new session from the sidebar `+` icon on Muse switches workspace,
  // clears stale project modes, creates a Claw session, and locks the picker.
  await app.hover("sidebar-workspace-toggle-asst-1");
  await app.press("sidebar-new-session-asst-1");
  await app.waitUntil(() =>
    backend.calls.some(
      call => call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "asst-1",
    ),
  );
  const created = backend.calls.find(
    call => call.action === "create_session" && (call.request as Record<string, unknown>)?.workspaceId === "asst-1",
  );
  expect(created?.request).toMatchObject({ workspaceId: "asst-1", agentType: "Claw" });
  await app.waitFor("label:agent-picker >> text:Claw");
  await expect(app.press("agent-picker")).rejects.toThrow(/no pressable/i);
  expect(app.shows("agent-option-Standard")).toBe(false);
  expect(app.shows("agent-option-Creative")).toBe(false);
});

test("composer syncs session model from get_session_model_target, omits open skeleton, and hides redundant running hint", async () => {
  const base = createBackend({
    sessions: [
      {
        sessionId: "sess-1",
        sessionName: "Model sync check",
        lastUpdated: 1763100000000,
        messageCount: 1,
        agentType: "Standard",
        workspaceId: "workspace-1",
      },
    ],
    sessionReasoningPreset: "high",
    configs: {
      "ai.models": [
        {
          id: "cfg-primary",
          name: "Primary model",
          provider: "openai",
          model_name: "gpt-4.1-mini",
          base_url: "https://api.openai.com/v1",
          enabled: true,
          capabilities: ["text_chat"],
        },
        {
          id: "cfg-fast",
          name: "Fast model",
          provider: "openai",
          model_name: "fast-small",
          base_url: "https://api.openai.com/v1",
          enabled: true,
          capabilities: ["text_chat"],
        },
      ],
    },
  });
  // Simulate a fleet session whose summary omits `modelName`, while the host's
  // authoritative `get_session_model_target` reports `fast-small` (not primary `gpt-4.1-mini`).
  const handlers: Record<string, (data: unknown) => unknown> = {
    ...base.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const call = data as { action?: string; request?: Record<string, unknown> };
      if (call?.action === "get_session_model_target") {
        base.calls.push({ action: "get_session_model_target", request: call.request, raw: false });
        return {
          ok: true,
          value: {
            sessionId: "sess-1",
            selection: { kind: "model", model_ref: "fast-small" },
            reasoningPreset: "high",
          },
        };
      }
      return base.handlers["openbitfun.invoke"](data);
    },
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });
  await openSession(app, "Model sync check");

  // No transcript loading skeleton appears when opening a session.
  expect(app.shows("transcript-loading")).toBe(false);

  // Composer must reflect the session's authoritative bound model (`Fast model`),
  // not fall back to `Primary model`.
  await app.waitFor("label:bot-capsule-trigger >> text:Fast model");
  await app.waitFor("label:reasoning-picker >> text:Reasoning: High");

  // Changing reasoning sends the session's real model (`fast-small`), never `gpt-4.1-mini`.
  await app.press("reasoning-picker");
  await app.waitFor("reasoning-option-low");
  await app.press("reasoning-option-low");
  await app.waitUntil(() => base.calls.some(call => call.action === "update_session_model"));
  const write = base.calls.find(call => call.action === "update_session_model");
  expect(write?.request).toMatchObject({
    sessionId: "sess-1",
    modelName: "fast-small",
    reasoningPreset: "low",
  });

  // While a turn is running, the redundant footer caption ("Steering the running turn")
  // is not rendered underneath the composer.
  base.setRunningTurn("sess-1", "turn-live");
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "sess-1", turnId: "turn-live", userInput: "checking" },
  });
  await app.waitFor("Stop");
  expect(app.texts()).not.toContain("Steering the running turn");
  expect(app.texts()).not.toContain("Queued until the turn finishes");
});

test("left-side turn jump rail previews a turn on hover and jumps on press", async () => {
  const turns = Array.from({ length: 12 }, (_, index) => ({
    turnId: `turn-${index + 1}`,
    turnIndex: index,
    userMessage: {
      id: `u-${index + 1}`,
      content:
        index === 0
          ? "First question about architecture"
          : `Follow-up question number ${index + 1} covering deployment details`,
      timestamp: 1763100000000 + index * 60000,
    },
    modelRounds: [
      {
        id: `r-${index + 1}`,
        textItems: [
          {
            id: `t-${index + 1}`,
            content:
              index === 0
                ? "Here is the architecture overview.\n\nEach layer keeps dependencies pointed downward so hosts stay thin."
                : `Detailed answer for turn ${index + 1}.\n\nParagraph one explains the state machine.\n\nParagraph two documents recovery and verification steps.`,
          },
        ],
      },
    ],
  }));
  const backend = createBackend({
    sessions: [
      {
        sessionId: "multi-turn",
        sessionName: "Multi turn thread",
        lastUpdated: 1763100720000,
        messageCount: turns.length * 2,
        agentType: "Standard",
        workspaceId: "workspace-1",
      },
    ],
  });
  withCustomTurns(backend, { "multi-turn": turns });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Multi turn thread");
  await app.waitFor("turn-jump-rail");
  expect(app.shows("turn-jump-1")).toBe(true);
  expect(app.shows("turn-jump-12")).toBe(true);

  await app.hover("turn-jump-1");
  await app.waitFor("turn-jump-preview");
  expect(app.shows("label:turn-jump-preview >> text:First question about architecture")).toBe(true);
  expect(
    app.shows(
      "label:turn-jump-preview >> text:Here is the architecture overview. Each layer keeps dependencies pointed downward so hosts stay thin.",
    ),
  ).toBe(true);
  expect(app.shows("label:turn-jump-preview >> text:1 of 12")).toBe(true);

  // Clicking jumps back to turn 1 and reveals the "Latest" pill since the thread overflows.
  await app.press("turn-jump-1");
  await app.waitFor("Latest");
});

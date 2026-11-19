import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

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
  expect(backend.actions()).not.toContain("start_dialog_turn");

  await app.press("starter-card-git-review");
  expect(app.value("composer")).toBe(
    "Review all uncommitted Git changes and highlight risks or missing tests.",
  );
  expect(backend.actions()).not.toContain("start_dialog_turn");

  await app.press("Send");
  expect(backend.calls.find(call => call.action === "start_dialog_turn")?.request).toMatchObject({
    sessionId: "session-empty",
    userInput: "Review all uncommitted Git changes and highlight risks or missing tests.",
    agentType: "Standard",
  });
});

test("welcome empty state also renders when no sessions exist yet", async () => {
  const backend = createBackend({ sessions: [] });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("How can I help today?");
  await app.press("starter-card-plan-feature");
  expect(app.value("composer")).toBe("Help me plan and implement a new feature step by step.");
  expect(backend.actions()).not.toContain("create_session");
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
  await app.waitFor("Muse workflow");
  await app.waitFor("Inspect and update the pipeline.");

  // Layered progressive disclosure: compact tool strips show cleanly; reasoning & checklist/diff stay collapsed.
  await app.waitFor("THINKING SUMMARY");
  expect(app.texts()).not.toContain("Checking git status and cargo workspace before patching.");
  await app.waitFor("TOOL · bash");
  await app.waitFor("$ cargo test -p core");
  await app.waitFor("TOOL · todo_write");
  await app.waitFor("checklist 2/2");
  await app.waitFor("Primary model · 1.2s");

  // Expanding thinking reveals the reasoning notes.
  await app.press(
    "label:thinking-turn-rich-1|thinking|Checking git status and cargo workspace before patching.",
  );
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
  await app.waitFor("Working on your turn…");

  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-rich", text: "Evaluating edge cases.", contentType: "thinking" },
  });
  await app.waitFor("Thinking through the request…");
  await app.press("label:thinking-live-thinking");
  await app.waitFor("Evaluating edge cases.");

  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-rich", delta: "All checks are green." },
  });
  await app.waitFor("Streaming response…");
  await app.waitFor("All checks are green.");

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: "session-rich", turnId: "turn-live-tauri" },
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

  await app.waitFor("Ready to fork.");
  // Literal "×" is never rendered outside open tab close buttons inside thread actions overlay.
  expect(app.texts().filter(text => text === "×")).toHaveLength(0);

  // Transcript search filters and highlights matching turns.
  await app.press("transcript-search-toggle");
  await app.type("transcript-search-input", "fork");
  await app.waitFor("1 match");
  await app.press("close-transcript-search");

  // Copy transcript writes full user + assistant dialogue.
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

  await app.waitFor("NSH skeleton");
  await app.waitFor("Message");

  // Band 1 attachment chip uses vector close icon rather than literal "×".
  await app.press("Attach");
  await app.waitFor("screenshot.png");
  expect(app.texts().filter(text => text === "×")).toHaveLength(0);
  await app.press("remove-attachment-attachment-1");
  expect(app.texts()).not.toContain("screenshot.png");

  // Band 3 selectors open anchored Overlays cleanly.
  await app.press("bot-capsule-trigger");
  await app.waitFor("Fast model · openai");
  await app.press("reasoning-picker");
  expect(app.texts()).not.toContain("Fast model · openai");
  await app.waitFor("reasoning-option-high");

  await app.press("agent-picker");
  expect(app.texts()).not.toContain("reasoning-option-high");
  await app.waitFor("Profiles");
  await app.waitFor("Agents");

  await app.press("Actions");
  await app.waitFor("Commit");
});

test("permission card and interactive question options answer blocking host interactions", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Approval needed: run_command");
  expect(app.texts()).toContain("cargo test -p openbitfun-desktop");

  await app.press("Allow once");
  expect(backend.calls.find(call => call.action === "respond_permission")?.request).toMatchObject({
    requestId: "perm-1",
    reply: "once",
  });
  expect(app.texts()).not.toContain("Approval needed: run_command");

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

  await app.waitFor("Return sends, Shift+Return inserts a line break");
  expect(app.spanStyle("Return sends, Shift+Return inserts a line break").color).toBe("#94949cff");

  await app.press("Settings");
  await app.waitFor("appearance-light");
  await app.press("appearance-light");
  await app.press("Sessions");
  await app.waitFor("Return sends, Shift+Return inserts a line break");
  expect(app.spanStyle("Return sends, Shift+Return inserts a line break").color).toBe("#5c6672ff");
});

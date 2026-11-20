// Wave 5 transcript work: the Task card lists its subagent's steps from the
// transcript view, and a turn that was already running when this surface opened
// the session is hydrated from the view's `runningTurn` snapshot.
import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

type Backend = ReturnType<typeof createBackend>;

/** Answers `load_session_turns` (which the fake view projects) with custom turns. */
function withTurns(backend: Backend, turnsBySession: Record<string, unknown[]>): void {
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    const sessionId = typeof args.request?.session_id === "string" ? args.request.session_id : "";
    if (args.action === "load_session_turns" && sessionId in turnsBySession) {
      return { ok: true, value: turnsBySession[sessionId], transport: "dev" };
    }
    return base(data);
  };
}

/** Adds a `runningTurn` snapshot to the view reads of one session. */
function withRunningTurn(backend: Backend, sessionId: string, snapshot: Record<string, unknown>): void {
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const result = base(data) as { ok: boolean; value?: Record<string, unknown> };
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "get_session_transcript_view" && args.request?.session_id === sessionId && result.ok) {
      return { ...result, value: { ...result.value, runningTurn: snapshot } };
    }
    return result;
  };
}

test("a Task card lists the subagent's steps from the transcript view", async () => {
  const backend = createBackend();
  const steps = Array.from({ length: 10 }, (_, index) => ({
    id: `sub-read-${index}`,
    toolName: "Read",
    toolCall: { input: { file_path: `/repo/src/module-${index}.ts` } },
    toolResult: { result: "ok", success: true },
    isSubagentItem: true,
    parentTaskToolId: "task-1",
  }));
  withTurns(backend, {
    "session-1": [
      {
        turnId: "turn-task",
        userMessage: { id: "u1", content: "Survey the modules" },
        modelRounds: [
          {
            toolItems: [
              {
                id: "task-1",
                toolName: "Task",
                toolCall: { input: { description: "Survey modules", prompt: "Read every module and report.", subagent_type: "Explore" } },
                toolResult: { result: "All modules read.", success: true },
              },
              ...steps,
            ],
            textItems: [
              { id: "sub-text", content: "Every module is small.", isSubagentItem: true, parentTaskToolId: "task-1" },
              { id: "main-text", content: "The survey is done." },
            ],
          },
        ],
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("The survey is done.");
  // The subagent's own answer belongs to the card, not the transcript.
  expect(app.texts()).not.toContain("Every module is small.");

  await app.press("tool-card-Task");
  await app.waitFor("11 steps");
  // Only the latest steps show at first; the rest are one press away.
  expect(app.texts()).toContain("module-9.ts");
  expect(app.texts().join("\n")).not.toContain("module-0.ts");
  await app.press("label:subagent-steps-all-tool:task-1");
  await app.waitFor("module-0.ts");
  expect(app.texts()).toContain("Every module is small.");
});

test("a turn already running when the session opens is hydrated from the view", async () => {
  const backend = createBackend();
  const stream = "stream-a";
  const cursorOf = (cursor: number) => ({
    __openbitfunRuntimeStreamId: stream,
    __openbitfunRuntimeEventCursor: cursor,
  });
  withRunningTurn(backend, "session-1", {
    sessionId: "session-1",
    streamId: stream,
    cursor: 10,
    activeTurnId: "turn-run",
    events: [
      {
        eventName: "agentic://dialog-turn-started",
        payload: { sessionId: "session-1", turnId: "turn-run", turnIndex: 2, userInput: "Is it still running?" },
      },
      {
        eventName: "agentic://text-chunk",
        payload: { sessionId: "session-1", turnId: "turn-run", roundId: "r1", text: "Half of the answer" },
      },
      {
        eventName: "agentic://tool-event",
        payload: {
          sessionId: "session-1",
          turnId: "turn-run",
          roundId: "r1",
          toolEvent: { event_type: "Started", tool_id: "t-run", tool_name: "ExecCommand", params: { cmd: "cargo test" } },
        },
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Half of the answer");
  expect(app.texts()).toContain("Is it still running?");
  expect(app.texts()).toContain("cargo test");
  // The surface knows the turn runs: the composer offers Stop.
  await app.waitFor("Stop");

  const send = (event: string, payload: Record<string, unknown>) =>
    app.host.send("openbitfun.event", { event, payload: { sessionId: "session-1", turnId: "turn-run", ...payload } });
  // A late delivery the snapshot already covered is dropped.
  await send("agentic://text-chunk", { roundId: "r2", text: "Already covered.", ...cursorOf(9) });
  // What follows the snapshot continues the turn.
  await send("agentic://text-chunk", { roundId: "r2", text: "Tests pass.", ...cursorOf(11) });
  await app.waitFor("Tests pass.");
  expect(app.texts().join("\n")).not.toContain("Already covered.");
  // A merged chunk that straddles the snapshot keeps only the new part.
  await send("agentic://text-chunk", {
    roundId: "r3",
    text: "OLD new tail.",
    ...cursorOf(12),
    __openbitfunChunkSpans: [
      [10, 4],
      [12, 13],
    ],
  });
  await app.waitFor("new tail.");
  expect(app.texts().join("\n")).not.toContain("OLD");
});

test("a turn this surface followed from its start is not replayed again", async () => {
  const backend = createBackend();
  withRunningTurn(backend, "session-1", {
    sessionId: "session-1",
    streamId: "stream-b",
    cursor: 5,
    activeTurnId: "turn-live",
    events: [
      {
        eventName: "agentic://dialog-turn-started",
        payload: { sessionId: "session-1", turnId: "turn-live", userInput: "Go" },
      },
      {
        eventName: "agentic://text-chunk",
        payload: { sessionId: "session-1", turnId: "turn-live", roundId: "r1", text: "Snapshot text" },
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Snapshot text");
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "turn-live", roundId: "r1", text: " and live text." },
  });
  await app.waitFor("Snapshot text and live text.");
  // Switching away and back re-reads the view; the followed turn keeps its stream.
  await app.press("Terminal migration >> nth=0");
  await app.waitFor("Port the terminal.");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Snapshot text and live text.");
});

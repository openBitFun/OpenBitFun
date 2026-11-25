// Transcript reads ask for shortened tool results; opening a card reads its one
// turn whole, shows the result there, and offers a retry when that read fails.
import { expect, open, test } from "nsh/test";
import { createBackend, openSession } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const FULL = `FULL-OUTPUT ${"line of output ".repeat(40)}END-OF-OUTPUT`;

function turn(output: string, omitted: boolean) {
  return {
    turnId: "turn-1",
    turnIndex: 3,
    kind: "user_dialog",
    status: "done",
    settled: true,
    user: { id: "u-1", text: "Run the build", displayText: "Run the build", timestampMs: 1, images: [] },
    items: [
      {
        kind: "tool",
        roundIndex: 0,
        tool: {
          id: "call-1",
          name: "GetThings",
          input: { what: "build" },
          status: "completed",
          success: false,
          result: { output },
          startMs: 1,
          ...(omitted ? { detailOmitted: true } : {}),
        },
      },
      { kind: "text", id: "t-1", roundIndex: 0, text: "Build finished" },
    ],
    startTimeMs: 1,
    assistantTimestampMs: 2,
  };
}

test("an opened card reads its turn whole once, and a failed read is said and retried", async () => {
  const backend = createBackend({
    sessions: [
      { sessionId: "session-detail", sessionName: "Summarized", lastUpdated: 1763100000000, messageCount: 2, turnCount: 1, agentType: "Standard" } as never,
    ],
  });
  const reads: Array<Record<string, unknown>> = [];
  let failNext = true;
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action !== "get_session_transcript_view" || args.request?.session_id !== "session-detail") return base(data);
    reads.push(args.request);
    const summary = args.request.tool_detail === "summary";
    if (!summary && args.request.before_turn_index !== undefined && failNext) {
      failNext = false;
      return { ok: false, error: "the device is offline", transport: "dev" };
    }
    return {
      ok: true,
      transport: "dev",
      value: {
        sessionId: "session-detail",
        mode: args.request.before_turn_index !== undefined ? "before" : "full",
        turns: [turn(summary ? "FULL-OUTPUT\n…" : FULL, summary)],
        cursor: null,
        hasEarlier: false,
      },
    };
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Summarized");
  await app.waitFor("Build finished", { timeout: 20_000 });
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(read => read.tool_detail === "summary")).toBe(true);

  await app.press("label:tool-card-GetThings");
  await app.waitFor("Only a preview is available; the full result could not be read.");
  const wholeReads = () => reads.filter(read => read.tool_detail === undefined);
  expect(wholeReads()).toEqual([
    { session_id: "session-detail", workspace_id: wholeReads()[0]!.workspace_id, limit: 1, before_turn_index: 4 },
  ]);

  await app.press("Retry");
  await app.waitFor(`text:${FULL}`);
  expect(app.shows("Only a preview is available; the full result could not be read.")).toBe(false);
  expect(wholeReads().length).toBe(2);

  // Closing and opening it again uses what was read.
  await app.press("label:tool-card-GetThings");
  await app.press("label:tool-card-GetThings");
  await app.waitFor(`text:${FULL}`);
  expect(wholeReads().length).toBe(2);
});

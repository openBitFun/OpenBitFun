// Long, tool-heavy sessions: an open step group is laid out one row per step,
// so the virtualized transcript mounts only the steps near the viewport and a
// jump into such a turn never has to build the whole group at once.
import { expect, open, test } from "nsh/test";
import { createBackend, openSession } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const TURNS = 6;
const TOOLS_PER_TURN = 120;

function longTurns() {
  return Array.from({ length: TURNS }, (_, t) => {
    const n = t + 1;
    const toolItems = Array.from({ length: TOOLS_PER_TURN }, (_, k) => ({
      id: `t${n}-tool-${k}`,
      toolName: "ExecCommand",
      orderIndex: k * 2 + 2,
      toolCall: { id: `t${n}-tool-${k}`, input: { cmd: `grep -rn "title" src/scenes | head -${k + 1}` } },
      toolResult: { success: true, result: { output: `match ${k}`, exit_code: 0 } },
    }));
    const thinkingItems = Array.from({ length: 10 }, (_, k) => ({
      id: `t${n}-think-${k}`,
      content: `Step ${k} of turn ${n}.`,
      orderIndex: k * 24 + 1,
    }));
    return {
      turnId: `long-${n}`,
      userMessage: { id: `u-${n}`, content: `Question ${n}` },
      status: "completed",
      modelRounds: [
        { id: `round-${n}`, thinkingItems, textItems: [{ id: `t${n}-text`, content: `Answer ${n}`, orderIndex: 999 }], toolItems },
      ],
    };
  });
}

test("an open group of 120 steps mounts only the rows near the viewport, also after a jump", async () => {
  const backend = createBackend({
    sessions: [
      { sessionId: "session-long", sessionName: "Tool heavy", lastUpdated: 1763100000000, messageCount: 12, turnCount: TURNS, agentType: "Standard" } as never,
    ],
  });
  const turns = longTurns();
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "load_session_turns" && args.request?.session_id === "session-long") {
      return { ok: true, value: turns, transport: "dev" };
    }
    return base(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Tool heavy");
  await app.waitFor("Answer 6", { timeout: 20_000 });
  await app.waitFor(`turn-jump-${TURNS}`, { timeout: 20_000 });

  await app.press("turn-jump-2");
  await app.waitFor("Question 2");
  await app.press("label:explore-group-explore:tool:t2-tool-0");
  const step = (k: number) => `text:grep -rn "title" src/scenes | head -${k}`;
  await app.waitFor(step(1));
  const mountedSteps = () => {
    let count = 0;
    while (count < TOOLS_PER_TURN && app.shows(`label:tool-card-ExecCommand >> nth=${count}`)) count += 1;
    return count;
  };
  expect(mountedSteps()).toBeLessThan(TOOLS_PER_TURN / 2);
  // The steps past the viewport are not mounted until scrolled to.
  expect(app.shows(step(TOOLS_PER_TURN))).toBe(false);

  await app.press("turn-jump-5");
  await app.waitFor("Question 5");
  await app.press("turn-jump-2");
  await app.waitFor("Question 2");
  await app.waitFor(step(1));
  expect(mountedSteps()).toBeLessThan(TOOLS_PER_TURN / 2);

  await app.press("Latest");
  await app.waitFor("Answer 6");
});

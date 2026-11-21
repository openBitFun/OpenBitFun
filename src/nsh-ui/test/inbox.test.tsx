// The Inbox (visual spec §4.4): prompts from every device answered in place and
// routed to the device that asked, the backend's groups and badge drawn as
// they are, an item that cannot be answered here, and the empty state.
import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow, type Backend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };
const APP = "./fixtures/inboxApp.tsx";

function navigator() {
  const device = (id: string, name: string, hostKind: string, session: string, title: string) =>
    fleetDeviceRow(
      id,
      name,
      [{ workspaceId: "ws-1", name: "openbitfun", rootPath: "/repo", sessions: [fleetSessionRow(id, "ws-1", session, title)] }],
      { hostKind },
    );
  return {
    revision: 3,
    full: true,
    devices: [
      device("dev-a", "mac-mini", "desktop", "s-a1", "Test release 1.2"),
      device("dev-b", "linux-box", "cli", "s-b1", "Fix lexer"),
      device("dev-c", "win-pc", "desktop", "s-c1", "Test on Windows"),
    ],
    removedDeviceIds: [],
    totals: { running: 1, waiting: 3, unread: 0 },
  };
}

function prompts() {
  return {
    revision: 7,
    prompts: [
      {
        deviceId: "dev-a",
        workspaceId: "ws-1",
        sessionId: "s-a1",
        kind: "permission",
        promptId: "perm-1",
        revision: 1,
        title: "run_command",
        payload: { action: "run_command", resources: ["pnpm e2e"] },
        payloadTruncated: false,
        answerable: true,
      },
      {
        deviceId: "dev-b",
        workspaceId: "ws-1",
        sessionId: "s-b1",
        kind: "question",
        promptId: "tool-q1",
        revision: 1,
        title: "Which branch should I start from?",
        toolName: "AskUserQuestion",
        payload: {
          questions: [
            {
              question: "Which branch should I start from?",
              header: "Branch",
              multiSelect: false,
              options: [{ label: "main" }, { label: "release/1.2" }],
            },
          ],
        },
        payloadTruncated: false,
        answerable: true,
      },
      {
        deviceId: "dev-c",
        workspaceId: "ws-1",
        sessionId: "s-c1",
        kind: "permission",
        promptId: "perm-9",
        revision: 1,
        title: "execute",
        payload: { action: "execute", resources: ["cargo test --workspace"] },
        payloadTruncated: false,
        answerable: true,
        answerRoute: "dispatch",
        jobId: "job-7",
      },
    ],
  };
}

/** Answers the commands the simulated backend has no fixture for (the answers and the Inbox view). */
function withAnswers(backend: Backend, attention?: () => unknown): Backend {
  const original = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const action = (data as { action?: string }).action;
    if (action === "dispatch_target_answer") return { ok: true, value: { accepted: true } };
    if (action === "submit_user_answers") return { ok: true, value: null };
    if (action === "fleet_attention") {
      return attention ? { ok: true, value: attention() } : { ok: false, error: "unknown command: fleet_attention" };
    }
    if (action === "fleet_attention_mark_read") return { ok: true, value: null };
    return original(data);
  };
  return backend;
}

function inboxHost(attention?: () => unknown) {
  const backend = withAnswers(createBackend(), attention);
  return fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: navigator(),
    prompts: prompts(),
  });
}

test("prompts from three devices are answered in place, each on the device that asked", async () => {
  const host = inboxHost();
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("Inbox");
  await app.waitFor("id:inbox-group-needs_you");
  // Without `fleet_attention` the badge is the navigator's waiting total.
  expect(app.shows("text:badge:3")).toBe(true);
  // Row 1 names the device and the session; row 2 the request and its command.
  expect(app.shows("id:inbox-item-dev-a/perm-1 >> text:mac-mini")).toBe(true);
  expect(app.shows("id:inbox-item-dev-a/perm-1 >> text:Test release 1.2")).toBe(true);
  expect(app.shows("id:inbox-item-dev-a/perm-1 >> text:Wants to run")).toBe(true);
  expect(app.shows("id:inbox-item-dev-a/perm-1 >> text:pnpm e2e")).toBe(true);
  expect(app.shows("id:inbox-item-dev-b/tool-q1 >> text:Which branch should I start from?")).toBe(true);
  expect(app.shows("id:inbox-item-dev-b/tool-q1 >> text:Type an answer")).toBe(true);

  // A permission goes to mac-mini's runtime.
  await app.press("id:inbox-item-dev-a/perm-1 >> label:allow-once-perm-1");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "respond_permission"));
  const permission = host.fleetCalls.find(call => call.command === "respond_permission");
  expect(permission?.target).toBe("dev-a");
  expect(permission?.args).toEqual({ request: { requestId: "perm-1", reply: "once" } });
  await app.waitFor("id:inbox-item-dev-a/perm-1 >> text:Answered on mac-mini");

  // Tapping an option of a single question answers it on linux-box.
  await app.press("id:inbox-item-dev-b/tool-q1 >> label:release/1.2");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "submit_user_answers"));
  const question = host.fleetCalls.find(call => call.command === "submit_user_answers");
  expect(question?.target).toBe("dev-b");
  expect(question?.args).toEqual({ toolId: "tool-q1", answers: { "0": "release/1.2" }, sessionId: "s-b1" });

  // A Detached Dispatch job's prompt goes to its job mailbox on win-pc.
  await app.press("id:inbox-item-dev-c/perm-9 >> label:deny-perm-9");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "dispatch_target_answer"));
  const dispatch = host.fleetCalls.find(call => call.command === "dispatch_target_answer");
  expect(dispatch?.target).toBe("dev-c");
  expect(dispatch?.args).toEqual({ jobId: "job-7", requestId: "perm-9", reply: "reject" });
  // The answer raises "Answered · {device}".
  await app.waitFor("text:Answered · win-pc");
});

test("a job card draws the same prompt without its header and answers it the same way", async () => {
  const host = inboxHost();
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("id:card-prompt");
  // The card already names the job and its device: no row 1 here.
  expect(app.shows("id:card-prompt >> text:win-pc")).toBe(false);
  expect(app.shows("id:card-prompt >> text:Wants to run")).toBe(true);
  expect(app.shows("id:card-prompt >> text:cargo test --workspace")).toBe(true);
  await app.press("id:card-prompt >> label:allow-always-perm-9");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "dispatch_target_answer"));
  expect(host.fleetCalls.find(call => call.command === "dispatch_target_answer")?.args).toEqual({
    jobId: "job-7",
    requestId: "perm-9",
    reply: "always",
  });
  // Answered here, so the Inbox's copy reads answered too.
  await app.waitFor("id:inbox-item-dev-c/perm-9 >> text:Answered on win-pc");
});

test("the backend's groups, order and badge are drawn as they are; an unanswerable item keeps only Open", async () => {
  const view = {
    revision: 11,
    badge: 2,
    groups: [
      {
        id: "needs_you",
        items: [
          {
            itemId: "dev-b/perm-x",
            kind: "permission",
            source: { deviceId: "dev-b", sessionId: "s-b1" },
            title: "Fix lexer",
            deviceName: "linux-box",
            hostKind: "cli",
            ageMs: 5 * 60_000,
            prompt: {
              deviceId: "dev-b",
              workspaceId: "ws-1",
              sessionId: "s-b1",
              kind: "permission",
              promptId: "perm-x",
              revision: 1,
              title: "write_file",
              payload: { action: "write_file", resources: ["src/lexer.rs", "src/token.rs"] },
              payloadTruncated: false,
              answerable: false,
              unanswerableReason: "linux-box needs an update to do this.",
            },
          },
        ],
      },
      {
        id: "done",
        items: [
          {
            itemId: "cloud/c-1",
            kind: "done",
            source: { deviceId: "cloud", conversationId: "c-1" },
            title: "Release 1.2: all tests passed",
            deviceName: "OpenBitFun",
            ageMs: 3_600_000,
            unread: true,
          },
        ],
      },
      {
        id: "failed",
        items: [
          {
            itemId: "dev-c/s-c1",
            kind: "failure",
            source: { deviceId: "dev-c", sessionId: "s-c1" },
            title: "Test release 1.2",
            detail: "3 tests failed",
            deviceName: "win-pc",
            ageMs: 3 * 3_600_000,
          },
        ],
      },
    ],
  };
  const host = inboxHost(() => view);
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("id:inbox-group-failed");
  expect(app.shows("text:badge:2")).toBe(true);
  const texts = app.texts();
  // Group order is the backend's.
  expect(texts.indexOf("Needs you")).toBeLessThan(texts.indexOf("Done"));
  expect(texts.indexOf("Done")).toBeLessThan(texts.indexOf("Failed"));
  // The unanswerable item says why, and only "Open" stays.
  expect(app.shows("id:inbox-item-dev-b/perm-x >> text:Can't answer here: linux-box needs an update to do this.")).toBe(true);
  expect(app.shows("id:inbox-item-dev-b/perm-x >> text:Allow once")).toBe(false);
  expect(app.shows("id:inbox-item-dev-b/perm-x >> label:Open")).toBe(true);
  expect(app.shows("id:inbox-item-dev-b/perm-x >> text:Wants to edit 2 files")).toBe(true);
  expect(app.shows("id:inbox-item-dev-b/perm-x >> text:5 min")).toBe(true);
  // Done and Failed are one line each.
  expect(app.shows("id:inbox-item-cloud/c-1 >> text:Release 1.2: all tests passed")).toBe(true);
  expect(app.shows("id:inbox-item-dev-c/s-c1 >> text:Test release 1.2 — 3 tests failed")).toBe(true);
  expect(app.shows("id:inbox-item-dev-c/s-c1 >> text:3 h")).toBe(true);
  // "Mark all as read" asks the backend.
  // The Inbox verbs are the entry's own (`FLEET_ENTRY_COMMANDS`): plain calls, never `fleet_call`.
  expect(host.calls.some(call => call.command === "fleet_attention")).toBe(true);
  await app.press("inbox-mark-all-read");
  await app.waitUntil(() => host.calls.some(call => call.command === "fleet_attention_mark_read"));
  expect(host.calls.find(call => call.command === "fleet_attention_mark_read")?.args).toEqual({
    request: { revision: 11 },
  });
  expect(host.fleetCalls.some(call => call.command.startsWith("fleet_attention"))).toBe(false);
});

test("nothing waiting draws the empty state, and the ⌘I sheet shows the same list", async () => {
  const backend = withAnswers(createBackend(), () => ({ revision: 1, badge: 0, groups: [] }));
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: navigator(),
    prompts: { revision: 1, prompts: [] },
  });
  const app = await open(APP, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("Nothing needs you");
  expect(app.shows("text:Approvals and questions from every device show up here.")).toBe(true);
  expect(app.shows("text:badge:0")).toBe(true);
  await app.press("open-inbox-sheet");
  await app.waitFor("id:inbox-sheet");
  expect(app.shows("id:inbox-sheet >> text:Nothing needs you")).toBe(true);
});

test("a phone draws the same groups and answers the same way", async () => {
  const host = inboxHost();
  const app = await open(APP, { ...PHONE, host: { handlers: host.handlers } });
  await app.waitFor("id:inbox-item-dev-a/perm-1");
  expect(app.shows("id:inbox-item-dev-b/tool-q1 >> text:linux-box")).toBe(true);
  await app.press("id:inbox-item-dev-a/perm-1 >> label:allow-once-perm-1");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "respond_permission"));
  expect(host.fleetCalls.find(call => call.command === "respond_permission")?.target).toBe("dev-a");
});

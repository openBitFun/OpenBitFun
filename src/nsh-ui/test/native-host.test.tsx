// The backend connection and the window shell are injected, not hard-wired to
// `host.js`: these tests run the shared UI over the native JSON wire and the NSH
// desktop shell (`fixtures/nativeApp.tsx`, the stand-in for the native desktop
// entry), and hold the shared pieces to the page host's behaviour.

import { expect, open, test } from "nsh/test";
// @ts-ignore host.js is an untyped plain ES module loaded by the web player.
import { createHost } from "../host.js";
import { createTextChunkCoalescer } from "../src/textChunkCoalescer";
import { showAllSessions, openSession, createBackend, type Backend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface WireEvent {
  seq?: number;
  event: string;
  payload: unknown;
}

/**
 * Plays the native host over the test's host channel: `openbitfun.wireInvoke` gets the
 * command and the Tauri args JSON the native module would get, and answers from
 * the simulated backend; `openbitfun.invoke` (the page host) must stay unused.
 */
function wireHost(backend: Backend, options: { readyError?: string; picked?: string | null } = {}) {
  const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
  const pageHostCalls: unknown[] = [];
  let seq = 0;
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.wireReady": () => {
      if (options.readyError) throw new Error(options.readyError);
      return JSON.stringify({ version: "9.8.7", platform: "macos", dataDir: "/tmp/openbitfun-test" });
    },
    "openbitfun.wireInvoke": (data: unknown) => {
      const { command, argsJson } = data as { command: string; argsJson: string };
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      invokes.push({ command, args });
      const keys = Object.keys(args);
      const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
      const reply = backend.handlers["openbitfun.invoke"](
        requestShape ? { action: command, request: args.request ?? null } : { action: command, raw: args },
      ) as { ok: boolean; value?: unknown; error?: string };
      if (!reply.ok) throw new Error(reply.error ?? `${command} failed`);
      return JSON.stringify(reply.value ?? null);
    },
    "openbitfun.wirePickDirectory": () => JSON.stringify(options.picked ?? null),
    "openbitfun.invoke": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: false, error: "the page host must not be used" };
    },
  };
  return {
    handlers,
    invokes,
    pageHostCalls,
    /** One `nextEvents` batch; items without a `seq` get the next one. */
    batch(events: WireEvent[]): string {
      return JSON.stringify(
        events.map(item => {
          if (typeof item.seq === "number") {
            seq = Math.max(seq, item.seq);
            return item;
          }
          seq += 1;
          return { ...item, seq };
        }),
      );
    },
  };
}

function question(toolId: string, header: string, text: string) {
  return {
    event: "backend-event-toolawaitinguserinput",
    payload: {
      toolId,
      sessionId: "session-1",
      questions: {
        questions: [
          {
            question: text,
            header,
            multiSelect: false,
            options: [
              { label: "Yes", description: "" },
              { label: "No", description: "" },
            ],
          },
        ],
        responseHostNowMs: 1,
        responseDeadlineMs: 0,
      },
    },
  };
}

test("the native wire carries every command as its Tauri args and never touches the page host", async () => {
  const backend = createBackend();
  const wire = wireHost(backend);
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await showAllSessions(app, "NSH skeleton");
  expect(wire.pageHostCalls).toEqual([]);
  expect(wire.invokes.length).toBeGreaterThan(0);
  // The simulated backend saw exactly the commands the wire carried.
  expect(backend.actions()).toEqual(wire.invokes.map(call => call.command));
  // A `request` command arrives wrapped as Tauri received it.
  const configRead = wire.invokes.find(call => call.command === "get_config");
  expect(Object.keys(configRead?.args ?? {})).toEqual(["request"]);
});

test("seq-numbered events reach the scenes once, and positional commands stay unwrapped", async () => {
  const backend = createBackend();
  const wire = wireHost(backend);
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await showAllSessions(app, "NSH skeleton");
  await openSession(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");

  await app.host.send("openbitfun.wireEvents", wire.batch([{ seq: 7, ...question("tool-w1", "Deploy", "Ship it now?") }]));
  await app.waitFor("Deploy: Ship it now?");

  // A replayed batch (same seq, as after a reconnect) is not delivered twice.
  await app.host.send("openbitfun.wireEvents", wire.batch([{ seq: 7, ...question("tool-w2", "Replay", "Seen before?") }]));
  await app.host.send("openbitfun.wireEvents", wire.batch([question("tool-w3", "Fresh", "Next one?")]));
  await app.waitFor("Fresh: Next one?");
  expect(app.texts().some(text => text.includes("Seen before?"))).toBe(false);

  await app.press("question-tool-w1-0-Yes");
  await app.press("Send answer >> nth=0");
  await app.waitUntil(() => backend.userAnswers.length > 0);
  expect(backend.userAnswers[0]).toEqual({ toolId: "tool-w1", answers: { "0": "Yes" }, sessionId: "session-1" });
  // `submit_user_answers` is positional: its arguments travel unwrapped.
  const submitted = wire.invokes.find(call => call.command === "submit_user_answers");
  expect(submitted?.args).toMatchObject({ toolId: "tool-w1", sessionId: "session-1" });
  expect(submitted?.args.request).toBeUndefined();
});

test("a backend that failed to start says so instead of rendering an empty app", async () => {
  const backend = createBackend();
  const wire = wireHost(backend, { readyError: "bootstrap failed: disk full" });
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await app.waitFor("label:backend-connection-banner");
  expect(app.texts().some(text => text.includes("bootstrap failed: disk full"))).toBe(true);
});

test("the NSH desktop shell owns the window: menu shortcuts, close press, About from ready()", async () => {
  const backend = createBackend();
  const wire = wireHost(backend);
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await showAllSessions(app, "NSH skeleton");
  // macOS keeps the system's traffic lights; the page draws no window buttons.
  expect(app.shows("label:window-minimize")).toBe(false);

  // Command-B is the View menu's item, not a second page binding: one press, one toggle.
  expect(app.shows("label:nav-split-handle")).toBe(true);
  await app.keyboard.press("mod+b");
  await app.waitUntil(() => !app.shows("label:nav-split-handle"));
  await app.keyboard.press("mod+b");
  await app.waitFor("label:nav-split-handle");

  // About reads this build's version from the backend's ready() answer.
  await app.press("label:account-row");
  await app.press("About OpenBitFun");
  await app.waitFor("Version 9.8.7");

  // The native backend runs the app's own update channel: the menu reads the staged update.
  await app.waitUntil(() => wire.invokes.some(call => call.command === "get_pending_update"));

  // The close button asks the page; macOS hides the window and keeps running.
  await app.window("main").pressClose();
  await app.waitUntil(() => app.window("main").state()?.visible === false);
  const commands = wire.invokes.map(call => call.command);
  for (const tauriOnly of ["quit_app", "hide_main_window_after_close_request", "minimize_to_tray"]) {
    expect(commands).not.toContain(tauriOnly);
  }
});

test("the text-chunk merge matches host.js event for event", async () => {
  const prevTauri = (globalThis as Record<string, unknown>).__TAURI__;
  const registered = new Map<string, Array<(msg: { payload: unknown }) => void>>();
  (globalThis as Record<string, unknown>).__TAURI__ = {
    core: { invoke: async () => null },
    event: {
      listen: async (event: string, cb: (msg: { payload: unknown }) => void) => {
        registered.set(event, [...(registered.get(event) ?? []), cb]);
        return () => undefined;
      },
    },
  };
  const chunk = (extra: Record<string, unknown>) => ({ sessionId: "s1", turnId: "t1", roundId: "r1", ...extra });
  const sequence: Array<[string, Record<string, unknown>]> = [
    ["agentic://text-chunk", chunk({ contentType: "thinking", text: "Plan " })],
    ["agentic://text-chunk", chunk({ contentType: "thinking", text: "it.", isThinkingEnd: true })],
    ["agentic://text-chunk", chunk({ text: "Hello " })],
    ["agentic://text-chunk", chunk({ text: "world" })],
    // Another round is another stream: never merged into the first.
    ["agentic://text-chunk", chunk({ roundId: "r2", text: "Other" })],
    ["agentic://text-chunk", chunk({ roundId: "r2", delta: "Delta" })],
    // A peer's chunk carries its source tag: never merged with local text.
    ["agentic://text-chunk", chunk({ roundId: "r2", delta: "Peer", __openbitfunSourceDeviceId: "device-x" })],
    ["agentic://tool-event", { sessionId: "s1", toolEvent: { event_type: "Started" } }],
    ["agentic://text-chunk", chunk({ text: "After tool" })],
    ["agentic://dialog-turn-completed", { sessionId: "s1", turnId: "t1" }],
  ];
  try {
    const fromHost: Array<{ event: string; payload: unknown }> = [];
    const host = await createHost({
      hostEvent: (_name: string, data: { event: string; payload: unknown }) => fromHost.push(data),
    });
    for (const event of new Set(sequence.map(([name]) => name))) {
      await host.call("openbitfun.listen", { event });
    }
    for (const [event, payload] of sequence) {
      for (const cb of registered.get(event) ?? []) cb({ payload: { ...payload } });
    }

    const fromTs: Array<{ event: string; payload: unknown }> = [];
    const merge = createTextChunkCoalescer((event, payload) => fromTs.push({ event, payload }));
    for (const [event, payload] of sequence) merge.push(event, { ...payload });

    expect(fromTs).toEqual(fromHost);
    // The merge did merge, and released everything before the completion.
    expect(fromTs.length).toBeLessThan(sequence.length);
    expect(fromTs[fromTs.length - 1].event).toBe("agentic://dialog-turn-completed");

    // A lone chunk is released within one frame budget on its own.
    const late: unknown[] = [];
    const timed = createTextChunkCoalescer((_event, payload) => late.push(payload));
    timed.push("agentic://text-chunk", chunk({ text: "tail" }));
    expect(late).toHaveLength(0);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(late).toEqual([chunk({ text: "tail" })]);
  } finally {
    if (prevTauri === undefined) delete (globalThis as Record<string, unknown>).__TAURI__;
    else (globalThis as Record<string, unknown>).__TAURI__ = prevTauri;
  }
});

test("the native shell attaches to the backend and answers its shell requests", async () => {
  const backend = createBackend();
  const wire = wireHost(backend);
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await showAllSessions(app, "NSH skeleton");
  // The shell announces exactly the operations it runs.
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  const attach = wire.invokes.find(call => call.command === "host_shell_attach");
  const ops = (attach?.args.request as { ops?: string[] } | undefined)?.ops ?? [];
  for (const op of ["app.quit", "notification.show", "window.hide", "clipboard.readImage", "loginItem.set"]) {
    expect(ops).toContain(op);
  }

  // A backend command that needs the window (quit_app's sibling minimize_to_tray) asks the shell.
  await app.host.send(
    "openbitfun.wireEvents",
    wire.batch([{ event: "host://shell-request", payload: { id: 41, op: "window.hide", args: null } }]),
  );
  await app.waitUntil(() => app.window("main").state()?.visible === false);
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_respond"));
  const answered = wire.invokes.find(call => call.command === "host_shell_respond");
  expect(answered?.args.request).toEqual({ id: 41, ok: true, value: null });

  // An operation the shell does not run is refused, not left waiting.
  await app.host.send(
    "openbitfun.wireEvents",
    wire.batch([{ event: "host://shell-request", payload: { id: 42, op: "window.teleport", args: {} } }]),
  );
  await app.waitUntil(() =>
    wire.invokes.some(call => (call.args.request as { id?: number } | undefined)?.id === 42),
  );
  const refused = wire.invokes.find(call => (call.args.request as { id?: number } | undefined)?.id === 42);
  expect((refused?.args.request as { ok?: boolean }).ok).toBe(false);
  expect(String((refused?.args.request as { error?: string }).error)).toContain("unsupported_in_native_host");
});

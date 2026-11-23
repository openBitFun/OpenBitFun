import { expect, open, test } from "nsh/test";
// @ts-ignore host.js is an untyped plain ES module loaded by the web player.
import { createHost } from "../host.js";
import {
  toolCallsOf,
  turnDurationMs,
  turnEffectiveModel,
  turnItems,
  turnParts,
} from "../src/format";
import { PERMISSION_ACTIONS, PERMISSION_MODES } from "../src/permissionPolicyStore";
import { getAppearancePreset } from "../src/theme";
import { permissionAlwaysContext, permissionRequestText } from "../src/ui/attention";
import { extractVisualizeDirectives, resolveWorkspaceMarkdownLink } from "../src/ui/markdown";
import { toolKindOf, toolTargetOf } from "../src/ui/toolCards";
import { createBackend, fakeTranscriptTurns, openSession, showAllSessions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("format helpers read the host transcript view of real Rust ModelRoundData (textItems, thinkingItems, toolItems, effectiveModelName)", () => {
  const realRustTurn = {
    turnId: "turn-rust-1",
    turnIndex: 0,
    sessionId: "session-rust",
    timestamp: 1763519340000,
    userMessage: {
      id: "user-1",
      content: "这是什么项目",
      timestamp: 1763519340000,
    },
    modelRounds: [
      {
        id: "round-1",
        turnId: "turn-rust-1",
        roundIndex: 0,
        timestamp: 1763519341000,
        effectiveModelName: "claude-sonnet-4-5",
        durationMs: 1420,
        thinkingItems: [
          {
            id: "think-1",
            content: "Inspecting repository layout.",
            reasoningKind: "reasoning",
            isStreaming: false,
            isCollapsed: true,
            orderIndex: 0,
            timestamp: 1763519341000,
          },
        ],
        toolItems: [
          {
            id: "tool-1",
            toolName: "Read",
            toolCall: { id: "tool-1", input: { file_path: "README.md" } },
            toolResult: { result: { ok: true }, success: true, durationMs: 38 },
            status: "completed",
            orderIndex: 1,
            timestamp: 1763519341200,
          },
        ],
        textItems: [
          {
            id: "text-1",
            content: "OpenBitFun 是一个跨平台 AI 编程与自主代理工作台。",
            isStreaming: false,
            isMarkdown: true,
            orderIndex: 2,
            timestamp: 1763519342000,
          },
        ],
      },
    ],
    status: "completed",
  };

  // The host projects the persisted record; the scene readers only read the view.
  const [view] = fakeTranscriptTurns([realRustTurn]);
  expect(turnParts(realRustTurn)).toEqual([]);
  const parts = turnParts(view);
  expect(parts.map(p => p.role)).toEqual(["user", "thinking", "assistant"]);
  expect(parts[0].text).toBe("这是什么项目");
  expect(parts[1].text).toBe("Inspecting repository layout.");
  expect(parts[2].text).toBe("OpenBitFun 是一个跨平台 AI 编程与自主代理工作台。");

  const tools = toolCallsOf(view);
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({
    id: "tool-1",
    name: "Read",
    status: "completed",
    success: true,
    durationMs: 38,
    input: { file_path: "README.md" },
  });
  expect(turnEffectiveModel(view)).toBe("claude-sonnet-4-5");
  expect(turnDurationMs(view)).toBe(1420);
});

test("sending a message never flashes back to Welcome Studio and survives the completion->history persistence race", async () => {
  const sessionId = "session-real-flow";
  const persistedTurns: unknown[] = [];

  const backend = createBackend({
    sessions: [
      {
        sessionId,
        sessionName: "New session",
        lastActiveAt: 1763519300000,
        messageCount: 0,
        status: "active",
        agentType: "Standard",
        modelName: "primary",
      },
    ],
  });

  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "load_session_turns" && args.request?.session_id === sessionId) {
      return { ok: true, value: [...persistedTurns], transport: "tauri" };
    }
    if (args.action === "start_dialog_turn") {
      // Mirrors real Rust `start_dialog_turn`: returns immediately while turn executes async.
      return { ok: true, value: { success: true, message: "Dialog turn started" }, transport: "tauri" };
    }
    return baseInvoke(data);
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "New session");
  await app.waitFor("How can I help today?");

  // Send message: start_dialog_turn resolves BEFORE first token arrives.
  await app.type("composer", "这是什么项目");
  await app.press("Send");

  // BUG 1 regression check: Welcome Studio must NOT flash back while waiting for TTFT!
  await app.waitFor("这是什么项目");
  expect(app.texts()).not.toContain("How can I help today?");

  // Simulate real Rust turn lifecycle with a retried attempt + live tool event.
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId, turnId: "turn-live-1", userInput: "这是什么项目" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://model-round-started",
    payload: { sessionId, turnId: "turn-live-1", roundId: "round-1", roundIndex: 0 },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: {
      sessionId,
      turnId: "turn-live-1",
      roundId: "round-1",
      attemptId: "round-1:attempt:1",
      text: "GARBAGE_FROM_FAILED_ATTEMPT",
    },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://model-round-attempt-superseded",
    payload: {
      sessionId,
      turnId: "turn-live-1",
      roundId: "round-1",
      diagnostic: { attemptId: "round-1:attempt:1", attemptIndex: 1 },
    },
  });
  // Late chunk from superseded attempt must be ignored.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: {
      sessionId,
      turnId: "turn-live-1",
      roundId: "round-1",
      attemptId: "round-1:attempt:1",
      text: "STALE_RETRY_TAIL",
    },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: {
      sessionId,
      turnId: "turn-live-1",
      roundId: "round-1",
      attemptId: "round-1:attempt:2",
      text: "OpenBitFun 是一个跨平台 AI 编程工作台。",
    },
  });
  await app.waitFor("OpenBitFun 是一个跨平台 AI 编程工作台。");
  expect(app.texts().join("\n")).not.toContain("GARBAGE_FROM_FAILED_ATTEMPT");
  expect(app.texts().join("\n")).not.toContain("STALE_RETRY_TAIL");

  // Simulate BUG 3B race: `dialog-turn-completed` arrives BEFORE `coordinator.rs`
  // persists `modelRounds` to disk (disk only holds the skeleton user turn).
  persistedTurns.push({
    turnId: "turn-live-1",
    turnIndex: 0,
    sessionId,
    timestamp: 1763519340000,
    userMessage: { id: "u-1", content: "这是什么项目", timestamp: 1763519340000 },
    modelRounds: [],
    status: "in_progress",
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId, turnId: "turn-live-1", durationMs: 850, success: true },
  });

  // Streamed text MUST stay visible while waiting for durable persistence!
  expect(app.texts().join("\n")).toContain("OpenBitFun 是一个跨平台 AI 编程工作台。");

  // Now Rust finishes writing real `ModelRoundData` (`textItems`, NO `assistantMessage`)
  // and emits the durable fence `agentic://session-history-changed`.
  persistedTurns[0] = {
    turnId: "turn-live-1",
    turnIndex: 0,
    sessionId,
    timestamp: 1763519340000,
    userMessage: { id: "u-1", content: "这是什么项目", timestamp: 1763519340000 },
    modelRounds: [
      {
        id: "round-1",
        turnId: "turn-live-1",
        roundIndex: 0,
        timestamp: 1763519341000,
        effectiveModelName: "claude-sonnet-4-5",
        durationMs: 850,
        textItems: [
          {
            id: "text-1",
            content: "OpenBitFun 是一个跨平台 AI 编程工作台。",
            isStreaming: false,
            isMarkdown: true,
            orderIndex: 0,
            timestamp: 1763519341500,
          },
        ],
        toolItems: [
          {
            id: "tool-read-1",
            toolName: "Read",
            toolCall: { id: "tool-read-1", input: { file_path: "Cargo.toml" } },
            toolResult: { result: {}, success: true, durationMs: 12 },
            status: "completed",
            orderIndex: 1,
            timestamp: 1763519341100,
          },
        ],
        thinkingItems: [],
      },
    ],
    status: "completed",
  };

  await app.host.send("openbitfun.event", {
    event: "agentic://session-history-changed",
    payload: { sessionId, settledTurnId: "turn-live-1" },
  });

  // BUG 3A regression check: persisted text from `textItems` and tool from `toolItems` stay visible!
  await app.waitFor("OpenBitFun 是一个跨平台 AI 编程工作台。");
  await app.waitFor("Cargo.toml");

  // BUG 4A regression check: live `session_title_generated` replaces "New session".
  await app.host.send("openbitfun.event", {
    event: "session_title_generated",
    payload: { sessionId, title: "OpenBitFun 架构概览", method: "ai", timestamp: Date.now() },
  });
  await app.waitFor("OpenBitFun 架构概览");
});

test("real Rust model catalog resolves primary role, text_chat capability, config IDs, and embedded reasoning", async () => {
  const backend = createBackend({
    sessions: [
      {
        sessionId: "session-primary",
        sessionName: "Primary check",
        lastActiveAt: 1763519300000,
        messageCount: 1,
        status: "active",
        agentType: "Standard",
        modelName: "primary",
      },
    ],
  });

  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string };
    if (args.action === "get_ai_model_catalog") {
      return {
        ok: true,
        transport: "tauri",
        value: {
          version: 7,
          models: [
            {
              id: "cfg-claude-sonnet",
              name: "Claude Sonnet 4.5",
              provider: "anthropic",
              model_name: "claude-sonnet-4-5",
              enabled: true,
              capabilities: ["text_chat", "function_calling"],
              reasoning: {
                status: "supported",
                default_preset: "medium",
                presets: [
                  { id: "medium", label: "Medium", order: 1, actions: [], source: "provider" },
                  { id: "high", label: "High", order: 2, actions: [], source: "provider" },
                ],
              },
            },
            {
              id: "cfg-claude-haiku",
              name: "Claude Haiku 4.5",
              provider: "anthropic",
              model_name: "claude-haiku-4-5",
              enabled: true,
              capabilities: ["text_chat"],
            },
            {
              id: "cfg-disabled",
              name: "Disabled Model",
              provider: "openai",
              model_name: "gpt-disabled",
              enabled: false,
              capabilities: ["text_chat"],
            },
            {
              id: "cfg-image-only",
              name: "DALL-E",
              provider: "openai",
              model_name: "dall-e-3",
              enabled: true,
              capabilities: ["image_generation"],
            },
          ],
          default_models: { primary: "cfg-claude-sonnet", fast: "cfg-claude-haiku" },
        },
      };
    }
    return baseInvoke(data);
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "Primary check");
  // Must resolve symbolic "primary" to "Claude Sonnet 4.5" instead of showing raw "primary"!
  await app.waitFor("label:bot-capsule-trigger >> text:Claude Sonnet 4.5");

  // Embedded reasoning presets must be available without extra `project_ai_model_reasoning_catalog` RPC!
  await app.waitFor("label:reasoning-picker >> text:Default");
  expect(backend.actions()).not.toContain("project_ai_model_reasoning_catalog");

  // Picker offers `"text_chat"` enabled models and hides disabled + image-only models.
  await app.press("label:bot-capsule-trigger");
  await app.waitFor("label:model-option-cfg-claude-haiku >> text:Claude Haiku 4.5");
  expect(app.shows("label:model-option-cfg-claude-haiku >> text:anthropic")).toBe(true);
  expect(app.texts()).not.toContain("Disabled Model");
  expect(app.texts()).not.toContain("DALL-E");

  // Choosing a model sends real config ID (`cfg-claude-haiku`), NOT upstream `model_name`.
  await app.press("model-option-cfg-claude-haiku");
  const update = backend.calls.find(call => call.action === "update_session_model");
  expect(update?.request).toMatchObject({
    sessionId: "session-primary",
    modelName: "cfg-claude-haiku",
  });
  await app.waitFor("label:bot-capsule-trigger >> text:Claude Haiku 4.5");
});

test("real Rust snake_case ToolAwaitingUserInput renders live prompt and submits answers", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  // Real Rust `BackendEvent::ToolAwaitingUserInput` has NO rename_all -> snake_case!
  await app.host.send("openbitfun.event", {
    event: "backend-event-toolawaitinguserinput",
    payload: {
      type: "ToolAwaitingUserInput",
      value: {
        tool_id: "tool-snake-42",
        session_id: "session-1",
        questions: {
          questions: [
            {
              header: "Deploy target",
              question: "Which environment should I deploy to?",
              multiSelect: false,
              options: [
                { label: "Staging", description: "Pre-production cluster" },
                { label: "Production", description: "Live users" },
              ],
            },
          ],
        },
      },
    },
  });

  await app.waitFor("Deploy target: Which environment should I deploy to?");
  await app.press("Staging");
  await app.press("Send answer");

  const submit = backend.calls.find(call => call.action === "submit_user_answers");
  expect(submit?.raw).toBe(true);
  expect(submit?.request).toMatchObject({
    toolId: "tool-snake-42",
    sessionId: "session-1",
    answers: { "0": "Staging" },
  });
});

test("real Rust SessionMetadata (status: archived, lastActiveAt) drives archive filter and unread state", async () => {
  const backend = createBackend({
    sessions: [
      {
        sessionId: "session-live",
        sessionName: "Live Rust session",
        lastActiveAt: 1763519500000,
        messageCount: 3,
        status: "active",
        agentType: "Standard",
      },
      {
        sessionId: "session-old",
        sessionName: "Archived Rust session",
        lastActiveAt: 1763519000000,
        messageCount: 2,
        status: "archived",
        agentType: "Standard",
      },
    ],
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  // All sessions lists the active row only; the archived one is in Settings › Archived sessions.
  await showAllSessions(app, "Live Rust session");
  expect(app.texts()).not.toContain("Archived Rust session");

  await app.press("Settings");
  await app.press("Archived sessions");
  await app.waitFor("Archived Rust session");
});

test("host.js coalesces agentic://text-chunk per frame, preserves causal order before non-text events, dedupes listeners, and exposes macOS windowChrome", async () => {
  const prevTauri = (globalThis as Record<string, unknown>).__TAURI__;
  const prevNavigator = (globalThis as Record<string, unknown>).navigator;

  const registeredListeners = new Map<string, Array<(msg: { payload: unknown }) => void>>();
  let listenCalls = 0;
  let unlistenCalls = 0;
  let dragCalls = 0;
  let maximizeCalls = 0;
  let unmaximizeCalls = 0;
  let toggleMaxCalls = 0;
  let isMaximizedState = false;

  (globalThis as Record<string, unknown>).__TAURI__ = {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async (event: string, cb: (msg: { payload: unknown }) => void) => {
        listenCalls += 1;
        // Simulate async registration latency to exercise concurrent dedupe & early cancel.
        await Promise.resolve();
        const list = registeredListeners.get(event) ?? [];
        list.push(cb);
        registeredListeners.set(event, list);
        return () => {
          unlistenCalls += 1;
          const cur = registeredListeners.get(event) ?? [];
          registeredListeners.set(
            event,
            cur.filter(fn => fn !== cb),
          );
        };
      },
    },
    window: {
      getCurrentWindow: () => ({
        isFullscreen: async () => false,
        isMaximized: async () => isMaximizedState,
        maximize: async () => {
          maximizeCalls += 1;
          isMaximizedState = true;
        },
        unmaximize: async () => {
          unmaximizeCalls += 1;
          isMaximizedState = false;
        },
        startDragging: async () => {
          dragCalls += 1;
        },
        toggleMaximize: async () => {
          toggleMaxCalls += 1;
        },
      }),
    },
  };
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });
  } catch {
    // Some runtimes freeze navigator; platform check still falls back safely.
  }

  try {
    const forwarded: Array<{ name: string; data: { event: string; payload: unknown } }> = [];
    const player = {
      hostEvent: (name: string, data: { event: string; payload: unknown }) => {
        forwarded.push({ name, data });
      },
    };
    const host = await createHost(player);

    // 1. Window chrome bridge (must use ACL-permitted isMaximized + maximize/unmaximize, NOT toggleMaximize)
    const chrome = await host.call("openbitfun.windowChrome", {});
    expect(chrome.ok).toBe(true);
    expect(chrome.value).toMatchObject({ native: true, isFullscreen: false });
    await host.call("openbitfun.windowDrag", {});
    await host.call("openbitfun.windowToggleMaximize", {});
    await host.call("openbitfun.windowToggleMaximize", {});
    expect(dragCalls).toBe(1);
    expect(maximizeCalls).toBe(1);
    expect(unmaximizeCalls).toBe(1);
    expect(toggleMaxCalls).toBe(0);

    // 2. Concurrent listenTo dedupe: two simultaneous calls must register only ONCE.
    listenCalls = 0;
    await Promise.all([
      host.call("openbitfun.listen", { event: "agentic://text-chunk" }),
      host.call("openbitfun.listen", { event: "agentic://text-chunk" }),
    ]);
    expect(listenCalls).toBe(1);
    await host.call("openbitfun.listen", { event: "agentic://dialog-turn-completed" });

    // 3. Per-frame text-chunk coalescing + immediate causal flush before completion event.
    const emit = (event: string, payload: unknown) => {
      for (const cb of registeredListeners.get(event) ?? []) cb({ payload });
    };
    emit("agentic://text-chunk", { sessionId: "s1", turnId: "t1", roundId: "r1", text: "Hello " });
    emit("agentic://text-chunk", { sessionId: "s1", turnId: "t1", roundId: "r1", text: "smooth " });
    emit("agentic://text-chunk", { sessionId: "s1", turnId: "t1", roundId: "r1", text: "world!" });
    // Chunks are still buffered (not forwarded synchronously 3 times).
    expect(forwarded).toHaveLength(0);

    // Non-text event flushes the coalesced single chunk BEFORE forwarding itself!
    emit("agentic://dialog-turn-completed", { sessionId: "s1", turnId: "t1" });
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0].data).toEqual({
      event: "agentic://text-chunk",
      payload: { sessionId: "s1", turnId: "t1", roundId: "r1", text: "Hello smooth world!" },
    });
    expect(forwarded[1].data).toEqual({
      event: "agentic://dialog-turn-completed",
      payload: { sessionId: "s1", turnId: "t1" },
    });

    // 4. Unlisten while listenTo is still in-flight disposes cleanly without leaking.
    const inflight = host.call("openbitfun.listen", { event: "agentic://tool-event" });
    await host.call("openbitfun.unlisten", { event: "agentic://tool-event" });
    await inflight;
    expect(unlistenCalls).toBeGreaterThanOrEqual(1);
    expect(registeredListeners.get("agentic://tool-event") ?? []).toHaveLength(0);
  } finally {
    if (prevTauri === undefined) delete (globalThis as Record<string, unknown>).__TAURI__;
    else (globalThis as Record<string, unknown>).__TAURI__ = prevTauri;
    try {
      Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true });
    } catch {
      // Ignore if non-configurable.
    }
  }
});

test("markdown TextView repaints from Dark to Light + 16px after unmounting Sessions via Settings", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
    colorScheme: "dark",
  });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Rendered with a virtualized list.");
  const darkReplyStyle = app.spanStyle("Rendered with a virtualized list.");
  expect(darkReplyStyle.color).toBe(`${getAppearancePreset("openbitfun-dark").palette.text}ff`);

  // Navigate to Settings (unmounts SessionsScene), switch to Light + Large 16px,
  // then return to Sessions. TextView styles must NEVER stay frozen in Dark colors!
  await app.press("Settings");
  // Settings opens on General; the scheme lives on the Appearance page.
  await app.press("nav-settings-page-appearance");
  await app.waitFor("appearance-light");
  await app.press("appearance-light");
  await app.press("font-level-large");
  // Back to the session the way the new shell reaches it (All sessions › Recent).
  await openSession(app, "NSH skeleton");

  await app.waitFor("Rendered with a virtualized list.");
  const lightReplyStyle = app.spanStyle("Rendered with a virtualized list.");
  expect(lightReplyStyle.color).toBe(`${getAppearancePreset("openbitfun-light").palette.text}ff`);
  expect(lightReplyStyle.color).not.toBe(darkReplyStyle.color);
  expect(lightReplyStyle.fontSize).toBeGreaterThan(darkReplyStyle.fontSize ?? 0);
});

test("host.js dev-mode start_dialog_turn streams chunks and persists real Rust textItems", async () => {
  const prevTauri = (globalThis as Record<string, unknown>).__TAURI__;
  delete (globalThis as Record<string, unknown>).__TAURI__;
  try {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const host = await createHost({
      hostEvent: (_name: string, data: { event: string; payload: Record<string, unknown> }) => {
        events.push(data);
      },
    });
    const created = await host.call("openbitfun.invoke", {
      action: "create_session",
      request: { sessionName: "New session", agentType: "Standard", workspace_id: "dev-workspace" },
    });
    expect(created.ok).toBe(true);
    const sessionId = created.value.sessionId as string;

    const started = await host.call("openbitfun.invoke", {
      action: "start_dialog_turn",
      request: { sessionId, userInput: "Hello dev mode", agentType: "Standard" },
    });
    expect(started.ok).toBe(true);
    expect(started.value).toMatchObject({ success: true });

    await new Promise(resolve => setTimeout(resolve, 350));
    const names = events.map(e => e.event);
    expect(names).toContain("agentic://dialog-turn-started");
    expect(names).toContain("agentic://text-chunk");
    expect(names).toContain("agentic://dialog-turn-completed");
    expect(names).toContain("agentic://session-history-changed");
    expect(names).toContain("session_title_generated");

    const loaded = await host.call("openbitfun.invoke", {
      action: "load_session_turns",
      request: { session_id: sessionId },
    });
    expect(loaded.ok).toBe(true);
    const turns = loaded.value as Array<{ modelRounds?: Array<{ textItems?: unknown[] }> }>;
    expect(turns).toHaveLength(1);
    expect((turns[0].modelRounds?.[0]?.textItems ?? []).length).toBeGreaterThan(0);
    expect(turnParts(fakeTranscriptTurns(turns)[0]).some(part => part.role === "assistant" && part.text.includes("Hello dev mode"))).toBe(
      true,
    );
  } finally {
    if (prevTauri !== undefined) (globalThis as Record<string, unknown>).__TAURI__ = prevTauri;
  }
});

test("upstream parity helpers: visualize directives, relative links, Skill aliases, permission context, and thinking keys", () => {
  // 1. Visualize 1.0.109 Private-Use directives are stripped cleanly (complete and streaming partial).
  const raw =
    'Here is the chart:\n\uE200visualize\uE202{"path":"openbitfun://current-session/artifacts/visualizations/v2/latency-chart.html","title":"Latency"} \uE201\nDone.';
  const parsed = extractVisualizeDirectives(raw);
  expect(parsed.text).toBe("Here is the chart:\n\nDone.");
  expect(parsed.text).not.toContain("\uE200");
  expect(parsed.figures).toEqual([
    {
      path: "openbitfun://current-session/artifacts/visualizations/v2/latency-chart.html",
      slug: "latency-chart",
      title: "Latency",
    },
  ]);
  const streaming = extractVisualizeDirectives('Partial \uE200visualize\uE202{"path":"openbit', { streaming: true });
  expect(streaming.text).toBe("Partial");

  // 2. Relative Markdown links resolve against POSIX and Windows workspace roots.
  expect(resolveWorkspaceMarkdownLink("./src/main.rs#L10-L20", "/repo")).toEqual({
    kind: "workspace",
    path: "/repo/src/main.rs",
    line: 10,
    endLine: 20,
  });
  expect(resolveWorkspaceMarkdownLink("docs/guide.md:42", "/repo", true)).toEqual({
    kind: "workspace",
    path: "/repo/docs/guide.md",
    line: 42,
  });
  expect(resolveWorkspaceMarkdownLink("file:///C:/work/app/src/index.ts", "C:\\work\\app", false)).toEqual({
    kind: "workspace",
    path: "C:\\work\\app\\src\\index.ts",
  });
  expect(resolveWorkspaceMarkdownLink("https://openbitfun.com", "/repo")).toEqual({
    kind: "external",
    url: "https://openbitfun.com",
  });

  // 3. Skill({ command }) is classified as "skill", never shell "exec".
  const skillByCommand = { name: "Skill", detail: "", input: { command: "visualize" } };
  const skillByAlias = { name: "Skill", detail: "", input: { skill: "pdf" } };
  expect(toolKindOf(skillByCommand)).toBe("skill");
  expect(toolTargetOf(skillByCommand)).toBe("visualize");
  expect(toolKindOf(skillByAlias)).toBe("skill");
  expect(toolTargetOf(skillByAlias)).toBe("pdf");

  // 4. Ask-mode permissions & command-context Always-allow metadata.
  expect(PERMISSION_MODES.find(m => m.value === "ask")?.hint).toContain("read-only");
  expect(PERMISSION_ACTIONS).toContain("delete");
  expect(PERMISSION_ACTIONS).toContain("process.execute");
  expect(PERMISSION_ACTIONS).toContain("process.execute.read_only");
  const cmdPrompt = {
    deviceId: "dev-1",
    workspaceId: "ws-1",
    sessionId: "s-1",
    kind: "permission",
    promptId: "p-1",
    revision: 1,
    title: "process.execute",
    payload: {
      action: "process.execute",
      resources: ["npm run build"],
      saveResources: ["exec-plan:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      displayMetadata: { shellPath: "/bin/zsh", workdir: "/repo" },
    },
    payloadTruncated: false,
    answerable: true,
  };
  expect(permissionRequestText(cmdPrompt).request).toBe("Wants to run");
  expect(permissionAlwaysContext(cmdPrompt)).toBe("/bin/zsh · /repo");

  // 5. Thinking item keys use index rather than embedding the full thinking text.
  const view = fakeTranscriptTurns([
    {
      turnId: "turn-k",
      userMessage: { id: "u1", content: "hi" },
      modelRounds: [{ thinkingItems: [{ id: "th-1", content: "A very long thinking text..." }] }],
    },
  ])[0];
  const items = turnItems(view);
  expect(items[0]?.kind).toBe("thinking");
  expect(items[0]?.key).toBe("turn-k|thinking|0");
});

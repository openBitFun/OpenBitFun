// The cloud node's `superagent_*` answers for the OpenBitFun conversation
// tests: one conversation with three live jobs (visual spec §4.3), Working
// now, the history groups, and the other commands the scene sends. Every
// command the app sends is recorded, so a test checks the wire it used.

export interface SuperagentCall {
  action: string;
  request: Record<string, unknown>;
  raw: boolean;
}

export interface SuperagentFixtureOptions {
  /** `account_status`'s `loggedIn` (true). */
  signedIn?: boolean;
  /** `superagent_status`'s `enabled` (true). */
  enabled?: boolean;
  /** `superagent_status` fails with this message (an older host, an unreachable cloud node). */
  statusError?: string;
  /** The first `statusFailures` (1) reads of `superagent_status` fail with this message (a link that was reconnecting). */
  statusErrorOnce?: string;
  statusFailures?: number;
  /** The first `superagent_send` fails with this message, as a lost entry would. */
  failFirstSend?: string;
  /** The running turn's step in the release conversation ("parked"). */
  turnStep?: string;
  /** Model picks the conversations start with (absent: Auto). */
  picks?: Record<string, { deviceId: string; modelId: string }>;
}

export interface SuperagentFixture {
  handlers: Record<string, (data: unknown) => unknown>;
  calls: SuperagentCall[];
  actions(): string[];
  callsOf(action: string): SuperagentCall[];
  /** The card as the fixture holds it now (a test changes it, then pushes `superagent://card-changed`). */
  card(jobId: string): Record<string, unknown>;
  setCard(jobId: string, patch: Record<string, unknown>): Record<string, unknown>;
  enable(): void;
}

const MIN = 60 * 1000;

function gate(allowed: boolean, reason?: string): Record<string, unknown> {
  return allowed ? { allowed: true } : { allowed: false, reason };
}

export function superagentCards(now = Date.now()): Record<string, Record<string, unknown>> {
  return {
    "job-build": {
      jobId: "job-build",
      deviceId: "dev-linux",
      deviceName: "linux-box",
      os: "linux",
      hostKind: "cli",
      title: "Build release 1.2",
      state: "done",
      branch: "release/1.2",
      diffStat: { filesChanged: 2, insertions: 3, deletions: 1, files: [], truncated: false },
      sessionId: "session-build",
      updatedMs: now - 4 * MIN,
      seen: false,
      actions: {
        openTranscript: gate(true),
        message: gate(true),
        cancel: gate(false, "job_terminal"),
        publish: gate(true),
        answer: gate(false, "no_pending_prompt"),
      },
    },
    "job-test-mac": {
      jobId: "job-test-mac",
      deviceId: "dev-mac",
      deviceName: "mac-mini",
      os: "macos",
      hostKind: "desktop",
      title: "Test release 1.2 on macOS",
      state: "blocked",
      stateReason: "prompt_pending",
      branch: "release/1.2",
      pendingPrompt: {
        requestId: "perm-e2e",
        toolName: "Bash",
        title: "pnpm e2e",
        more: 0,
        kind: "permission",
        payload: { action: "bash", resources: ["pnpm e2e"] },
      },
      sessionId: "session-mac",
      updatedMs: now - 10 * 1000,
      actions: {
        openTranscript: gate(true),
        message: gate(true),
        cancel: gate(true),
        publish: gate(false, "job_not_finished"),
        answer: gate(true),
      },
    },
    "job-test-linux": {
      jobId: "job-test-linux",
      deviceId: "dev-linux",
      deviceName: "linux-box",
      os: "linux",
      hostKind: "cli",
      title: "Test release 1.2 on Linux",
      state: "working",
      branch: "release/1.2",
      summaryLine: "cargo test 812/1400",
      lastAnswer: { promptId: "perm-cargo", answeredBy: "superagent", decision: "once", atMs: now - 2 * MIN, detail: "cargo test --workspace" },
      sessionId: "session-linux",
      updatedMs: now - 2 * MIN,
      actions: {
        openTranscript: gate(true),
        message: gate(true),
        cancel: gate(true),
        publish: gate(false, "job_not_finished"),
        answer: gate(false, "no_pending_prompt"),
      },
    },
    "job-test-win": {
      jobId: "job-test-win",
      deviceId: "dev-win",
      deviceName: "win-pc",
      os: "windows",
      hostKind: "desktop",
      title: "Test release 1.2 on Windows",
      state: "queued",
      stateReason: "waiting_for_device",
      summaryLine: "Starts when it's online, expires in 23 h",
      updatedMs: now - MIN,
      actions: {
        openTranscript: gate(false, "waiting_for_device"),
        message: gate(false, "waiting_for_device"),
        cancel: gate(true),
        publish: gate(false, "job_not_finished"),
        answer: gate(false, "no_pending_prompt"),
      },
    },
  };
}

interface FixtureConversation {
  id: string;
  title: string;
  updatedMs: number;
  rollup: string;
  unread: boolean;
  turn: { id: string; step: string } | null;
  messages: Array<Record<string, unknown>>;
}

export function createSuperagentFixture(options: SuperagentFixtureOptions = {}): SuperagentFixture {
  const now = Date.now();
  const calls: SuperagentCall[] = [];
  const cards = superagentCards(now);
  let enabled = options.enabled !== false;
  let sendFailures = options.failFirstSend ? 1 : 0;
  let statusFailuresLeft = options.statusErrorOnce ? (options.statusFailures ?? 1) : 0;
  let seq = 0;
  const conversations: Record<string, FixtureConversation> = {
    "conv-release": {
      id: "conv-release",
      title: "Release 1.2",
      updatedMs: now - MIN,
      rollup: "needs_you",
      unread: false,
      turn: { id: "turn-3", step: options.turnStep ?? "parked" },
      messages: [
        { id: "m1", role: "user", text: "Build on the linux box, then test it on all three.", atMs: now - 9 * MIN, clientMessageId: "c-1" },
        { id: "m2", role: "assistant", text: "Building on linux-box first. I'll start the tests when it passes.", atMs: now - 9 * MIN },
        { id: "m3", role: "jobs", jobIds: ["job-build"], atMs: now - 9 * MIN },
        {
          id: "m4",
          role: "assistant",
          text: "Build passed. Testing on three machines.",
          atMs: now - 4 * MIN,
          citations: [{ jobId: "job-build", label: "Build release 1.2" }],
        },
        { id: "m5", role: "jobs", jobIds: ["job-test-mac", "job-test-linux", "job-test-win"], atMs: now - 4 * MIN },
      ],
    },
    "conv-812": { id: "conv-812", title: "Fix #812", updatedMs: now - 30 * MIN, rollup: "working", unread: false, turn: null, messages: [] },
    "conv-deps": { id: "conv-deps", title: "Bump deps", updatedMs: now - 26 * 60 * MIN, rollup: "unread", unread: true, turn: null, messages: [] },
  };
  // The model picker (wave 21): devices with their models, each conversation's pick.
  const modelDevices = [
    { deviceId: "dev-mac", name: "mac-mini", hostKind: "desktop", online: true,
      models: [{ modelId: "sonnet", displayName: "Claude Sonnet", provider: "anthropic", primary: true }, { modelId: "gpt", displayName: "GPT-5", provider: "openai" }] },
    { deviceId: "dev-win", name: "win-pc", hostKind: "desktop", online: false, unavailableReason: "device_offline",
      models: [{ modelId: "local", displayName: "Local model", provider: "openai", primary: true }] },
  ];
  const picks: Record<string, { deviceId: string; modelId: string } | null> = { ...(options.picks ?? {}) };
  const selectionOf = (id: string) => {
    const pick = picks[id];
    if (!pick) return { mode: "auto" };
    const device = modelDevices.find(item => item.deviceId === pick.deviceId);
    const model = device?.models.find(item => item.modelId === pick.modelId);
    return {
      mode: "pinned",
      deviceId: pick.deviceId,
      deviceName: device?.name,
      modelId: pick.modelId,
      modelName: model?.displayName,
      ...(device?.unavailableReason ? { unavailableReason: device.unavailableReason } : {}),
    };
  };
  const row = (conversation: FixtureConversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedMs: conversation.updatedMs,
    status: conversation.turn ? "running" : "idle",
    rollup: conversation.rollup,
    unread: conversation.unread,
  });
  const answer = (action: string, request: Record<string, unknown>): unknown => {
    switch (action) {
      case "account_status":
        return { logged_in: options.signedIn !== false, loggedIn: options.signedIn !== false, user_id: options.signedIn !== false ? "u-1" : null };
      case "account_identity":
        return null;
      case "superagent_status":
        if (options.statusError) throw new Error(options.statusError);
        if (options.statusErrorOnce && statusFailuresLeft > 0) {
          statusFailuresLeft -= 1;
          throw new Error(options.statusErrorOnce);
        }
        return {
          enabled,
          signedIn: true,
          deviceId: "cloud-test",
          name: "Super Agent",
          hostKind: "cloud",
          placeholder: "Ask Super Agent…",
          suggestions: ["Run the tests on all my devices", "Update deps", "Summarize today's work"],
          workingNow: { needsYou: [cards["job-test-mac"]], working: [cards["job-test-linux"], cards["job-test-win"]] },
          models: modelDevices,
        };
      case "superagent_enable":
        enabled = true;
        return { enabled: true };
      case "superagent_list_conversations": {
        const today = ["conv-release", "conv-812"].filter(id => conversations[id]).map(id => row(conversations[id]!));
        const yesterday = ["conv-deps"].filter(id => conversations[id]).map(id => row(conversations[id]!));
        const extra = Object.values(conversations)
          .filter(item => !["conv-release", "conv-812", "conv-deps"].includes(item.id))
          .map(row);
        const groups = [
          { id: "today", rows: [...extra, ...today] },
          { id: "yesterday", rows: yesterday },
        ].filter(group => group.rows.length > 0);
        return { groups, nextCursor: null, timeZone: String(request.timeZone ?? "UTC") };
      }
      case "superagent_get_conversation": {
        const conversation = conversations[String(request.conversationId ?? "")];
        if (!conversation) throw new Error("not_found: no such conversation");
        const ids = new Set(conversation.messages.flatMap(message => (message.jobIds as string[] | undefined) ?? []));
        return {
          conversation: { id: conversation.id, title: conversation.title, updatedMs: conversation.updatedMs, turn: conversation.turn, model: selectionOf(conversation.id) },
          messages: conversation.messages,
          cursor: 0,
          hasMore: false,
          cards: [...ids].map(id => cards[id]).filter(Boolean),
        };
      }
      case "superagent_send": {
        if (sendFailures > 0) {
          sendFailures -= 1;
          throw new Error(options.failFirstSend);
        }
        let conversation = request.conversationId ? conversations[String(request.conversationId)] : undefined;
        if (!conversation) {
          seq += 1;
          conversation = {
            id: `conv-new-${seq}`,
            title: String(request.message ?? "").slice(0, 48),
            updatedMs: Date.now(),
            rollup: "none",
            unread: false,
            turn: null,
            messages: [],
          };
          conversations[conversation.id] = conversation;
        }
        if (request.model !== undefined) picks[conversation.id] = (request.model as { deviceId: string; modelId: string } | null) ?? null;
        const duplicate = conversation.messages.some(message => message.clientMessageId === request.clientMessageId);
        if (!duplicate) {
          conversation.messages.push({ id: `m-${++seq}`, role: "user", text: String(request.message ?? ""), clientMessageId: request.clientMessageId });
        }
        conversation.turn = { id: `turn-${seq}`, step: "model_round" };
        return { conversationId: conversation.id, messageId: `m-${seq}`, turnId: `turn-${seq}`, ...(duplicate ? { duplicate: true } : {}) };
      }
      case "superagent_set_model": {
        const id = String(request.conversationId ?? "");
        if (!conversations[id]) throw new Error("not_found: no such conversation");
        picks[id] = request.deviceId ? { deviceId: String(request.deviceId), modelId: String(request.modelId) } : null;
        return { conversationId: id, model: selectionOf(id) };
      }
      case "superagent_cancel_turn": {
        const conversation = conversations[String(request.conversationId ?? "")];
        if (conversation?.turn) conversation.turn = { ...conversation.turn, step: "cancelled" };
        return { cancelled: true };
      }
      case "superagent_job_action": {
        const jobId = String(request.jobId ?? "");
        const card = cards[jobId];
        if (!card) throw new Error("not_found: no such job");
        if (request.action === "cancel") {
          cards[jobId] = { ...card, state: "cancelled", stateReason: undefined, pendingPrompt: undefined };
          return { cancelled: true };
        }
        if (request.action === "message") return { jobId, outcome: card.state === "working" ? "steered" : "queued" };
        throw new Error(`invalid_request: unknown job action '${String(request.action)}'`);
      }
      case "superagent_rename_conversation": {
        const conversation = conversations[String(request.conversationId ?? "")];
        if (!conversation) throw new Error("not_found: no such conversation");
        conversation.title = String(request.title ?? "");
        return { conversationId: conversation.id, title: conversation.title };
      }
      case "superagent_delete_conversation":
        delete conversations[String(request.conversationId ?? "")];
        return { deleted: true, jobsLeftRunning: 0 };
      case "dispatch_target_answer":
        return { accepted: true };
      default:
        throw new Error(`the simulated backend has no answer for ${action}`);
    }
  };
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const action = args.action ?? "";
      const raw = Object.prototype.hasOwnProperty.call(args, "raw");
      const request = ((raw ? args.raw : args.request) ?? {}) as Record<string, unknown>;
      calls.push({ action, request, raw });
      try {
        return { ok: true, value: answer(action, request), transport: "dev" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    "openbitfun.listen": () => ({ ok: true }),
    "openbitfun.unlisten": () => ({ ok: true }),
  };
  return {
    handlers,
    calls,
    actions: () => calls.map(call => call.action),
    callsOf: action => calls.filter(call => call.action === action),
    card: jobId => cards[jobId]!,
    setCard: (jobId, patch) => {
      cards[jobId] = { ...cards[jobId]!, ...patch };
      return cards[jobId]!;
    },
    enable: () => {
      enabled = true;
    },
  };
}

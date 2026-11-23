// A simulated OpenBitFun desktop backend for the headless tests.
//
// The tests play the embedding host: they answer `openbitfun.invoke` exactly as
// `host.js` forwards it to Tauri, so the scenes, the transport and the request
// shapes are the production ones. What the tests replace is only the native
// process, which they cannot start here.

export interface BackendCall {
  action: string;
  request: unknown;
  raw: boolean;
}

export interface BackendOptions {
  /** transcript view (wave 4): a host that predates `get_session_transcript_view`. */
  transcriptViewUnsupported?: boolean;
  /** remote link + terminal profiles (wave 4): a host that predates the profile commands. */
  terminalProfilesUnsupported?: boolean;
  /** Profiles the host config already keeps, by workspace id. */
  terminalProfiles?: Record<string, Array<{ id: string; name: string; shellId: string; shellType: string; startupCommand: string }>>;
  sessions?: Array<{
    sessionId: string;
    sessionName: string;
    lastActiveAt?: number;
    lastUpdated?: number;
    messageCount?: number;
    status?: string;
    persistedStatus?: string;
    modelName?: string;
    agentType?: string;
    workspaceId?: string;
  }>;
  files?: Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }>;
  fileContent?: Record<string, string>;
  configs?: Record<string, unknown>;
  /** One job the controller's index already knows about. */
  dispatchJob?: Record<string, unknown>;
  /** The target's event log for that job, replayed page by page from a cursor. */
  dispatchEvents?: Array<Record<string, unknown>>;
  /** Events one `dispatch_status` page may carry; the target's own page limit. */
  dispatchPageSize?: number;
  /** Permissions the target is waiting on while the job is not terminal. */
  dispatchPermissions?: Array<Record<string, unknown>>;
  /** The state reported before any `jobState` event has been replayed. */
  dispatchState?: string;
  /** The usage dashboard's answer; `null` means this host does not offer it. */
  usage?: Record<string, unknown> | null;
  /**
   * The answer to the fixed six-month activity read. `null` means the host takes
   * the range read and refuses this one, which must cost only the heatmap.
   */
  usageActivity?: Record<string, unknown> | null;
  /** The ACP client list; `null` means this host has no ACP commands. */
  acpClients?: Array<Record<string, unknown>> | null;
  /** What the requirement probe answers. */
  acpProbes?: Array<Record<string, unknown>>;
  /** Config paths the host refuses to read, as an older file would. */
  absentConfigs?: string[];
  /** A host older than the typed settings commands (wave 3 config): they are unknown. */
  legacySettingsHost?: boolean;
  /**
   * account settings sync (wave 21): what `account_settings_sync_status`
   * answers; `null` is a host without the commands. Default: on and synced.
   */
  accountSync?: Record<string, unknown> | null;
  /**
   * account records (wave24-replica): what `device_records_overview`
   * answers; omitted or `null` is a host without the command.
   */
  accountRecords?: Record<string, unknown> | null;
  devices?: Array<Record<string, unknown>>;
  /** The host answers `manage_dialog_queue`; without it the surface keeps its own list. */
  hostQueue?: boolean;
  /**
   * Whether that host advertises `supportsReorder`; `null` omits the field, which
   * is what a build predating reorder answers.
   */
  hostQueueReorder?: boolean | null;
  /** Rows the fixture host reports as held back, by turn id, with the reason. */
  hostQueueBlocked?: Record<string, string>;
  /** The host answers `get_web_search_credential_status` with this. */
  searchCredentialConfigured?: boolean;
  /** What `get_runtime_logging_info` answers; `null` means the host has no such command. */
  runtimeLogging?: Record<string, unknown> | null;
  /** Questions the session mailbox reports as still waiting; `null` means no such command. */
  pendingQuestions?: Array<Record<string, unknown>> | null;
  /** Whether the vault starts with a decision-model key stored. */
  decisionKeyConfigured?: boolean;
  /** The agent catalogue; `null` means this host has no `get_available_modes`. */
  agentModes?: Array<Record<string, unknown>> | null;
  /** `false` makes the host refuse `search_files`, as a build without it would. */
  fileSearch?: boolean;
  /**
   * The `font` document the host stores; `null` means it stores none, which is
   * what a fresh install answers. Absent means the default (14 px).
   */
  fontPreference?: Record<string, unknown> | null;
  /**
   * The answer to `get_local_models_dev_catalogs`; `null` means this host does not
   * offer the command, which is what a build predating the picker answers.
   */
  modelCatalog?: Record<string, unknown> | null;
  /**
   * The host's message hits; `null` means this host has no
   * `search_session_content`, which the search field has to survive.
   */
  sessionSearch?: Array<Record<string, unknown>> | null;
  /**
   * The reasoning setting `get_session_model_target` reports for a session.
   * `undefined` (the default) makes the fixture omit the field, which is how a
   * host older than it answers.
   */
  sessionReasoningPreset?: string | null;
  /**
   * The answer to `project_ai_model_reasoning_catalog`; `null` means this host
   * does not offer the command, and the composer then draws no reasoning control.
   */
  reasoningCatalog?: Record<string, unknown> | null;
  /** Workspaces the host remembers as recent but has not opened. */
  recentOnlyWorkspaces?: Array<{ id: string; name: string; rootPath: string; workspaceKind?: string }>;
  /** Opened workspaces; the default is the local `workspace-1` and the remote `workspace-2`. */
  openedWorkspaces?: Array<{
    id: string;
    name: string;
    rootPath: string;
    workspaceKind?: string;
    sshHost?: string;
    connectionId?: string;
  }>;
  /** The workspace `get_current_workspace` reports; the default is the first opened one. */
  currentWorkspaceId?: string | null;
  // view models (wave 4)
  /** `false` makes the host older than `get_workspace_navigator`. */
  workspaceNavigator?: false;
  /** `false` makes the host older than `get_token_usage_activity`. */
  usageActivityCommand?: false;
  /** `false` makes the host older than `get_personal_overview`. */
  personalOverview?: false;
}

// transcript view (wave 4)
/**
 * A fake host's `get_session_transcript_view`: the backend projection
 * (`remote_connect::transcript_view`) over the fixture's persisted turns. It also
 * reads the legacy `assistantMessage` / `toolCalls` fixture shapes the tests
 * were written with, which a real host never stores.
 */
type FixtureRecord = Record<string, unknown>;
const asRecord = (value: unknown): FixtureRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as FixtureRecord) : null;
const pick = (record: FixtureRecord | null, ...keys: string[]): unknown => {
  if (!record) return undefined;
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function fakeToolView(raw: unknown, fallbackId: string): FixtureRecord | null {
  const record = asRecord(raw);
  const call = asRecord(pick(record, "toolCall", "tool_call"));
  const result = asRecord(pick(record, "toolResult", "tool_result"));
  const name = pick(record, "toolName", "tool_name") ?? pick(call, "toolName", "tool_name") ?? pick(record, "name", "tool");
  if (typeof name !== "string" || !name) return null;
  const id = text(pick(record, "id")) || text(pick(call, "id")) || fallbackId;
  const input = pick(call, "input", "arguments") ?? pick(record, "arguments", "input", "parameters", "params", "toolInput");
  const hasResult = Boolean(result) || pick(record, "result") !== undefined;
  const status = text(pick(record, "status")) || (hasResult ? "completed" : "completed");
  const error = text(pick(result, "error")) || text(pick(record, "error"));
  const out: FixtureRecord = { id, name, input: input ?? null, status, startMs: num(pick(record, "startTime", "start_time")) ?? 0 };
  const success = pick(result, "success");
  if (typeof success === "boolean") out.success = success;
  if (error) out.error = error;
  const value = pick(result, "result") ?? pick(record, "result");
  if (value !== undefined) out.result = value;
  const forAssistant = text(pick(result, "resultForAssistant", "result_for_assistant"));
  if (forAssistant) out.resultForAssistant = forAssistant;
  const duration = num(pick(record, "durationMs", "duration_ms")) ?? num(pick(result, "durationMs", "duration_ms"));
  if (duration !== undefined) out.durationMs = duration;
  return out;
}

function fakeStatus(raw: unknown): string {
  const status = text(raw).toLowerCase();
  if (status === "inprogress" || status === "in_progress" || status === "active" || status === "running") return "active";
  if (status === "error" || status === "failed") return "failed";
  if (status === "cancelled" || status === "interrupted") return "cancelled";
  return "done";
}

export function fakeTranscriptTurns(rawTurns: unknown[]): FixtureRecord[] {
  return rawTurns.flatMap((raw, position) => {
    const turn = asRecord(raw);
    if (!turn) return [];
    const turnId = text(pick(turn, "turnId", "turn_id", "id")) || `turn-${position}`;
    const user = asRecord(pick(turn, "userMessage", "user_message"));
    const metadata = asRecord(pick(user, "metadata"));
    const images = Array.isArray(metadata?.images)
      ? (metadata!.images as unknown[]).flatMap(entry => {
          const image = asRecord(entry);
          if (!image) return [];
          const out: FixtureRecord = { name: text(pick(image, "name", "image_name", "imageName")) || "image" };
          const dataUrl = text(pick(image, "data_url", "dataUrl"));
          const imagePath = text(pick(image, "image_path", "imagePath"));
          if (dataUrl) out.dataUrl = dataUrl;
          if (imagePath) out.imagePath = imagePath;
          return [out];
        })
      : [];
    const items: FixtureRecord[] = [];
    const subagent: Array<{ parent: string; item: FixtureRecord }> = [];
    let toolSeq = 0;
    const turnTools = [
      ...((pick(turn, "toolItems", "tool_items") as unknown[]) ?? []),
      ...((pick(turn, "toolCalls", "tool_calls") as unknown[]) ?? []),
    ];
    for (const rawTool of turnTools) {
      const tool = fakeToolView(rawTool, `${turnId}-tool-${toolSeq++}`);
      if (tool) items.push({ kind: "tool", roundIndex: 0, tool });
    }
    const rounds = (pick(turn, "modelRounds", "model_rounds") as unknown[]) ?? [];
    let modelName: string | undefined;
    let roundDuration = 0;
    let sawDuration = false;
    let lastRoundTime: number | undefined;
    rounds.forEach((rawRound, roundIndex) => {
      const round = asRecord(rawRound);
      if (!round) return;
      const model = text(pick(round, "effectiveModelName", "effective_model_name", "modelName", "model_name", "model")).trim();
      if (model) modelName = model;
      const duration = num(pick(round, "durationMs", "duration_ms"));
      if (duration !== undefined) {
        roundDuration += duration;
        sawDuration = true;
      }
      lastRoundTime = num(pick(round, "endTime", "end_time")) ?? num(pick(round, "startTime", "start_time")) ?? lastRoundTime;
      const ordered: Array<{ order?: number; seq: number; item: FixtureRecord; subagentOf?: string }> = [];
      let seq = 0;
      const push = (entry: FixtureRecord | null, item: FixtureRecord) => {
        const order = num(pick(entry, "orderIndex", "order_index"));
        const isSub = pick(entry, "isSubagentItem", "is_subagent_item") === true;
        const parent = text(pick(entry, "parentTaskToolId", "parent_task_tool_id"));
        ordered.push({ order, seq: seq++, item, ...(isSub ? { subagentOf: parent } : {}) });
      };
      for (const rawItem of ((pick(round, "thinkingItems", "thinking_items") as unknown[]) ?? [])) {
        const entry = asRecord(rawItem);
        const content = text(pick(entry, "content"));
        if (!content) continue;
        const kind = text(pick(entry, "reasoningKind", "reasoning_kind"));
        push(entry, {
          kind: "thinking",
          id: text(pick(entry, "id")) || `${turnId}-${roundIndex}-thinking-${seq}`,
          roundIndex,
          text: content,
          ...(kind === "summary" || kind === "reasoning" ? { reasoningKind: kind } : {}),
        });
      }
      let addedText = false;
      for (const rawItem of ((pick(round, "textItems", "text_items") as unknown[]) ?? [])) {
        const entry = asRecord(rawItem);
        const content = text(pick(entry, "content"));
        if (!content) continue;
        addedText = true;
        push(entry, { kind: "text", id: text(pick(entry, "id")) || `${turnId}-${roundIndex}-${seq}`, roundIndex, text: content });
      }
      const assistant = asRecord(pick(round, "assistantMessage", "assistant_message"));
      if (!addedText && text(pick(assistant, "content"))) {
        push(null, {
          kind: "text",
          id: text(pick(assistant, "id")) || `${turnId}-${roundIndex}`,
          roundIndex,
          text: text(pick(assistant, "content")),
        });
      }
      const roundTools = [
        ...((pick(round, "toolItems", "tool_items") as unknown[]) ?? []),
        ...((pick(round, "toolCalls", "tool_calls") as unknown[]) ?? []),
        ...((pick(assistant, "toolCalls", "tool_calls") as unknown[]) ?? []),
      ];
      for (const rawTool of roundTools) {
        const tool = fakeToolView(rawTool, `${turnId}-${roundIndex}-tool-${toolSeq++}`);
        if (tool) push(asRecord(rawTool), { kind: "tool", roundIndex, tool });
      }
      if (ordered.some(entry => entry.order !== undefined)) {
        ordered.sort((left, right) => {
          if (left.order !== undefined && right.order !== undefined && left.order !== right.order) return left.order - right.order;
          if (left.order !== undefined && right.order === undefined) return -1;
          if (left.order === undefined && right.order !== undefined) return 1;
          return left.seq - right.seq;
        });
      }
      for (const entry of ordered) {
        if (entry.subagentOf !== undefined) {
          if (entry.subagentOf) subagent.push({ parent: entry.subagentOf, item: entry.item });
          continue;
        }
        items.push(entry.item);
      }
    });
    for (const { parent, item } of subagent) {
      const owner = items.find(entry => entry.kind === "tool" && (entry.tool as FixtureRecord).id === parent);
      if (owner) {
        const tool = owner.tool as FixtureRecord;
        tool.subagentItems = [...((tool.subagentItems as unknown[]) ?? []), item];
      }
    }
    const status = fakeStatus(pick(turn, "status", "state"));
    const startTimeMs = num(pick(turn, "startTime", "start_time")) ?? num(pick(turn, "timestamp")) ?? 0;
    const view: FixtureRecord = {
      turnId,
      turnIndex: num(pick(turn, "turnIndex", "turn_index")) ?? position,
      kind: text(pick(turn, "kind")) || "user_dialog",
      status,
      settled: status !== "active",
      user: {
        id: text(pick(user, "id")) || `${turnId}-user`,
        text: text(pick(user, "content")),
        timestampMs: num(pick(user, "timestamp")) ?? num(pick(turn, "timestamp")) ?? 0,
        ...(images.length ? { images } : {}),
      },
      items,
      startTimeMs,
      assistantTimestampMs: lastRoundTime ?? startTimeMs,
    };
    const error = text(pick(turn, "error")).trim();
    if (error) view.error = error;
    const detail = asRecord(pick(turn, "errorDetail", "error_detail"));
    if (detail) view.errorDetail = detail;
    const topModel = text(pick(turn, "effectiveModelName", "effective_model_name", "modelName", "model_name", "model")).trim();
    if (modelName || topModel) view.effectiveModel = modelName || topModel;
    const duration = num(pick(turn, "durationMs", "duration_ms"));
    if (duration !== undefined) view.durationMs = duration;
    else if (sawDuration) view.durationMs = roundDuration;
    const usage = asRecord(pick(turn, "tokenUsage", "token_usage"));
    if (usage) view.tokenUsage = usage;
    const recovery = asRecord(pick(turn, "recovery"));
    if (recovery) {
      view.recovery = {
        status: text(pick(recovery, "status")),
        executionGeneration: num(pick(recovery, "executionGeneration", "execution_generation")) ?? 0,
      };
    }
    return [view];
  });
}

/** The fake host's whole answer, including the cursor rule (only what follows the last settled turn). */
export function fakeTranscriptView(sessionId: string, rawTurns: unknown[], request: unknown): FixtureRecord {
  const turns = fakeTranscriptTurns(rawTurns);
  const cursorOf = (list: FixtureRecord[]) => {
    let last: FixtureRecord | undefined;
    for (const turn of list) {
      if (!turn.settled) break;
      last = turn;
    }
    return last ? `tv1:${String(last.turnIndex)}:fake:${String(last.turnId)}` : undefined;
  };
  const cursor = text(asRecord(request)?.cursor);
  const [, rawIndex, , cursorTurn] = cursor.split(":");
  const anchor = cursor.startsWith("tv1:")
    ? turns.findIndex(turn => String(turn.turnIndex) === rawIndex && turn.turnId === cursorTurn && turn.settled)
    : -1;
  if (anchor >= 0) {
    const after = turns.slice(anchor + 1);
    return {
      sessionId,
      mode: "after",
      keptThroughIndex: turns[anchor].turnIndex,
      turns: after,
      cursor: cursorOf(after) ?? cursor,
      hasEarlier: false,
    };
  }
  return { sessionId, mode: "full", turns, ...(cursorOf(turns) ? { cursor: cursorOf(turns) } : {}), hasEarlier: false };
}

// view models (wave 4)
type FixtureWorkspace = { id?: string } & Record<string, unknown>;

/**
 * A fake host's `get_workspace_navigator`: the backend projection's rules over
 * the fixture's own opened, recent and current answers (dedupe, recent never
 * lists an opened workspace, selection kept / host current / first opened / none).
 */
export function projectWorkspaceNavigator(
  openedRaw: unknown,
  recentRaw: unknown,
  currentId: string | null | undefined,
  selectedId: string | null | undefined,
): Record<string, unknown> {
  const unique = (list: unknown, exclude: Set<string>): FixtureWorkspace[] => {
    const seen = new Set<string>();
    return (Array.isArray(list) ? (list as FixtureWorkspace[]) : []).filter(item => {
      const id = String(item?.id ?? "");
      if (!id || exclude.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  const opened = unique(openedRaw, new Set());
  const openedIds = new Set(opened.map(item => String(item.id)));
  const recent = unique(recentRaw, openedIds);
  if (selectedId && openedIds.has(selectedId)) {
    return { opened, recent, selectedId, selection: "kept" };
  }
  if (currentId && openedIds.has(currentId)) {
    return { opened, recent, selectedId: currentId, selection: "host_current" };
  }
  if (opened.length > 0) {
    return { opened, recent, selectedId: String(opened[0].id), selection: "first_opened" };
  }
  return {
    opened,
    recent,
    selectedId: null,
    selection: "none",
    ...(recent[0]?.id ? { reopenCandidateId: String(recent[0].id) } : {}),
  };
}

/**
 * A fake host's `get_personal_overview`, composed from the fixture's own section
 * commands the way the backend helpers compose it: counts, enabled filters, the
 * due-soon window (last hour to next day, soonest first) and the running Spaces.
 * `read` answers one command or throws its error, so a section fails on its own.
 */
export function composePersonalOverview(
  read: (action: string, payload: Record<string, unknown>, raw: boolean) => unknown,
): Record<string, unknown> {
  const section = (build: () => unknown) => {
    try {
      return { status: "ready", value: build() };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  };
  const list = (value: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  const now = Date.now();
  return {
    assistants: section(() => ({
      count: list(read("get_assistant_workspaces", {}, true)).length,
    })),
    skills: section(() => {
      const raw = read(
        "get_skill_configs",
        { forceRefresh: false, includeDiagnostics: false, workspaceId: null, workspacePath: null },
        true,
      );
      const skills = Array.isArray(raw) ? list(raw) : list((raw as { skills?: unknown })?.skills);
      return {
        count: skills.length,
        enabled: skills.filter(skill => skill.enabled !== false && skill.disabled !== true).length,
      };
    }),
    routines: section(() => {
      const jobs = list(read("list_cron_jobs", {}, false));
      const dueSoon = jobs
        .filter(job => job.enabled !== false)
        .map(job => {
          const state = (job.state ?? {}) as Record<string, unknown>;
          return {
            id: String(job.id ?? ""),
            name: String(job.name ?? job.id ?? ""),
            nextRunAtMs: typeof state.nextRunAtMs === "number" ? state.nextRunAtMs : NaN,
            ...(state.lastRunStatus ? { lastRunStatus: String(state.lastRunStatus) } : {}),
            schedule: job.schedule ?? null,
          };
        })
        .filter(job => job.nextRunAtMs >= now - 3_600_000 && job.nextRunAtMs <= now + 86_400_000)
        .sort((left, right) => left.nextRunAtMs - right.nextRunAtMs);
      return {
        count: jobs.length,
        enabled: jobs.filter(job => job.enabled !== false).length,
        dueSoon,
      };
    }),
    spaces: section(() => {
      const running = new Set(list(read("miniapp_worker_list_running", {}, true)).map(String));
      const items = list(read("list_miniapps", {}, true)).map(app => ({
        id: String(app.id ?? ""),
        name: String(app.name ?? app.id ?? ""),
        description: String(app.description ?? ""),
        icon: String(app.icon ?? "") || "shapes",
        running: running.has(String(app.id ?? "")),
      }));
      return { count: items.length, running: items.filter(item => item.running).length, items };
    }),
    ssh: section(() => ({
      connections: list(read("ssh_list_saved_connections", {}, true)),
    })),
    usage: section(() => {
      const stats = (read(
        "get_token_usage_statistics",
        { timeRange: "custom", granularity: "day", includeSubagent: true },
        false,
      )) as Record<string, unknown>;
      const models = list(stats.byModel).sort(
        (left, right) => Number(right.tokens ?? 0) - Number(left.tokens ?? 0),
      );
      return {
        days: 30,
        totalTokens: stats.totalTokens ?? 0,
        totalRequests: stats.totalRequests ?? 0,
        inputTokens: stats.totalInputTokens ?? 0,
        outputTokens: stats.totalOutputTokens ?? 0,
        cachedTokens: stats.totalCachedTokens ?? 0,
        failedRequests: stats.failedRequests ?? 0,
        topModelName: String(models[0]?.name ?? ""),
      };
    }),
    activity: section(() => read("get_token_usage_activity", { months: 6 }, false)),
  };
}

/** A fake host's six-month activity grid with two busy days (4.0K tokens). */
export function fixtureUsageActivity(now = new Date()): Record<string, unknown> {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - 182 * dayMs;
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const gridStart = start - offset * dayMs;
  const weekCount = Math.ceil(((today - start) / dayMs + 1 + offset) / 7);
  const busy = new Map<number, number>([
    [today - 3 * dayMs, 1_500],
    [today - 2 * dayMs, 2_500],
  ]);
  const days = Array.from({ length: weekCount * 7 }, (_, index) => {
    const time = gridStart + index * dayMs;
    const date = new Date(time);
    const inRange = time >= start && time <= today;
    const tokens = inRange ? busy.get(time) ?? 0 : 0;
    return {
      date: date.toISOString().slice(0, 10),
      month: date.getUTCMonth() + 1,
      dayOfMonth: date.getUTCDate(),
      tokens,
      level: tokens === 0 ? 0 : tokens >= 2_500 ? 4 : 3,
      inRange,
    };
  });
  return {
    timeZone: "UTC",
    months: 6,
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(today).toISOString().slice(0, 10),
    weekCount,
    days,
    monthHeaders: [{ weekIndex: 2, month: new Date(start + 14 * dayMs).getUTCMonth() + 1 }],
    totalTokens: 4_000,
    peakTokens: 2_500,
    activeDays: 2,
    longestStreak: 2,
    currentStreak: 0,
  };
}

interface HostQueueRow {
  sessionId: string;
  turnId: string;
  content: string;
  status: string;
}

export interface Backend {
  calls: BackendCall[];
  actions(): string[];
  /** Every `set_config` request, in order. */
  settingsWrites: Array<{ path: string; value: unknown }>;
  /** Every `save_web_search_credential` request, in order. */
  credentialWrites: Array<{ provider: string; secret: string }>;
  /** Every provider whose key a `clear_web_search_credential` removed. */
  clearedCredentials: string[];
  /** Every decision-model key the vault was asked to store, in order. */
  decisionKeyWrites: string[];
  /** How many times the decision-model key was removed. */
  decisionKeyClears: () => number;
  /** Every `save_mcp_json_config` request, in order. */
  mcpSaves: Array<{ jsonConfig: string; expectedFingerprint: string }>;
  /** The MCP document the host currently stores, parsed. */
  mcpDocument: () => unknown;
  /** Makes the next save carry a stale fingerprint, as a concurrent edit would. */
  changeMcpDocumentElsewhere: () => void;
  /** Moves the remote OAuth session this host reports, as the flow does. */
  setMcpOAuthSession: (session: Record<string, unknown> | null) => void;
  /** Every `update_mcp_remote_auth` value the host accepted, in order. */
  mcpAuthWrites: Array<{ serverId: string; authorizationValue: string }>;
  /** Every server id a `clear_mcp_remote_auth` cleared, in order. */
  mcpAuthClears: string[];
  /** The last `dispatch_submit` request, or `null`. */
  submittedDispatch: () => unknown;
  /** Every job id a `dispatch_cancel` named, in order. */
  cancelledJobs: string[];
  /** Every `dispatch_answer` request, in order. */
  dispatchAnswers: Array<{ jobId: string; requestId: string; reply: string }>;
  /** Every `dispatch_append` request, in order. */
  dispatchAppends: Array<{ jobId: string; content: string }>;
  /** Every `dispatch_continue` request, in order. */
  dispatchContinues: Array<{ jobId: string; turnId: string; prompt: string }>;
  /** Every job id a `dispatch_sync_result` named, in order. */
  dispatchSyncs: string[];
  /** Every `get_token_usage_statistics` request, in order. */
  usageRequests: Array<Record<string, unknown>>;
  /** Every `update_session_mode` request the host accepted, in order. */
  sessionModeWrites: Array<{ sessionId: string; modeId: string; workspaceId?: string }>;
  /** Every `save_acp_json_config` payload, in order. */
  acpSaves: string[];
  /** Every `install_acp_client_cli` client id, in order. */
  acpInstalls: string[];
  /** Every path a `reveal_in_explorer` asked to show, in order. */
  reveals: string[];
  /** Every `start_user_question_interaction` request, in order. */
  questionStarts: Array<{ sessionId: string; toolId: string }>;
  /** Every `submit_user_answers` request, in order. */
  userAnswers: Array<{ toolId: string; answers: Record<string, unknown>; sessionId: string }>;
  /** Every `manage_dialog_queue` reorder the host accepted, in order. */
  queueReorders: Array<{ turnId: string; beforeTurnId: string | null; expectedRevision: number }>;
  // session policy (wave 3)
  /** What `submit_user_message` decided for each message, in order. */
  userMessages: Array<{ sessionId: string; text: string; outcome: string; turnId: string; workspaceId?: string }>;
  /** Marks the turn the fixture host is running for a session (`null` settles it). */
  setRunningTurn: (sessionId: string, turnId: string | null) => void;
  /** Every `mark_session_seen` request, in order. */
  seenMarks: Array<{ sessionId: string; seenThroughMs?: number }>;
  /** features (wave 5): every `report_openbitfun_control_result` request, in order. */
  controlReports?: Array<Record<string, unknown>>;
  handlers: Record<string, (data: unknown) => unknown>;
}

const DEFAULT_RUNTIME_LOGGING = {
  effectiveLevel: "info",
  sessionLogDir: "/tmp/openbitfun/logs/session-1",
  earlyStartupLogPath: "/tmp/openbitfun/logs/session-1/early.log",
  appLogPath: "/tmp/openbitfun/logs/session-1/app.log",
  flowChatLogPath: "/tmp/openbitfun/logs/session-1/flow-chat.log",
  previousUnexpectedExit: null,
};

const DEFAULT_ACP_CLIENTS = [
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
    enabled: true,
    readonly: false,
    status: "running",
    permissionMode: "ask",
    toolName: "run_opencode_agent",
    sessionCount: 2,
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "npx",
    args: ["--yes", "@agentclientprotocol/codex-acp@latest"],
    enabled: false,
    readonly: false,
    status: "stopped",
    permissionMode: "ask",
    toolName: "run_codex_agent",
    sessionCount: 0,
  },
];

const DEFAULT_ACP_PROBES = [
  {
    id: "opencode",
    tool: { name: "opencode", installed: true, version: "0.9.1", path: "/usr/local/bin/opencode" },
    adapter: { name: "adapter", installed: true, version: "1.2.0", path: "/tmp/adapter" },
    runnable: true,
    notes: [],
  },
  {
    id: "codex",
    tool: { name: "npx", installed: true, version: "10.2.0", path: "/usr/local/bin/npx" },
    adapter: { name: "codex-acp", installed: false, error: "not installed" },
    runnable: false,
    notes: ["The codex-acp adapter is not installed"],
  },
];

export const DEFAULT_USAGE = {
  totalRequests: 42,
  unknownUsageRequests: 1,
  failedRequests: 2,
  totalTokens: 120_000,
  totalInputTokens: 90_000,
  totalOutputTokens: 30_000,
  totalCachedTokens: 40_000,
  totalCacheWriteTokens: 5_000,
  totalCacheReportedInputTokens: 80_000,
  byModel: [
    { key: "m-primary", name: "primary-large", providerName: "openai", requests: 30, tokens: 100_000, cacheHitRate: 0.5 },
    { key: "m-small", name: "small-model", providerName: null, requests: 12, tokens: 20_000, cacheHitRate: null },
  ],
  byGroup: [],
  byEndpoint: [],
  trend: [
    { bucket: "2026-01-01T00:00:00Z", inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 100 },
    { bucket: "2026-01-02T00:00:00Z", inputTokens: 2_000, outputTokens: 700, cacheReadTokens: 200 },
  ],
  granularity: "day",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The answer to the fixed six-month activity read: two busy days inside any
 * window and one bucket far outside it, so a projection that forgets the window
 * shows the wrong total.
 */

const DEFAULT_SESSIONS = [
  {
    sessionId: "session-1",
    sessionName: "NSH skeleton",
    lastUpdated: 1763000000000,
    messageCount: 4,
    agentType: "Standard",
    // The host's unread receipt: a settled result nobody has opened yet.
    unreadCompletion: "completed",
  },
  {
    sessionId: "session-2",
    sessionName: "Terminal migration",
    lastUpdated: 1762900000000,
    messageCount: 9,
    modelName: "session-only-model",
    unreadCompletion: "completed",
  },
  {
    sessionId: "session-3",
    sessionName: "Old experiment",
    lastUpdated: 1762800000000,
    messageCount: 2,
    persistedStatus: "archived",
  },
];

/**
 * The agent catalogue: the four execution profiles the harness control draws,
 * then the agents this workspace can run, one of them external.
 */
const DEFAULT_AGENT_MODES = [
  { id: "Minimal", name: "Minimal", description: "Read-mostly edits with the smallest tool set." },
  { id: "Standard", name: "Standard", description: "The default profile." },
  { id: "Ultimate", name: "Ultimate", description: "The widest tool set, for long tasks." },
  { id: "Creative", name: "Creative", description: "Explores alternatives before editing." },
  { id: "DeepResearch", name: "Deep research", description: "Builds a report from several sources." },
  { id: "opencode", name: "OpenCode", description: "A configured external agent.", source: "external" },
  // An agent the host resolves but the desktop never switches a session to.
  { id: "Claw", name: "Claw", description: "Runs in assistant workspaces." },
];

const DEFAULT_FILES = [
  {
    name: "docs",
    path: "/repo/docs",
    isDirectory: true,
    children: [{ name: "guide.md", path: "/repo/docs/guide.md", isDirectory: false }],
  },
  { name: "README.md", path: "/repo/README.md", isDirectory: false },
  { name: "main.rs", path: "/repo/main.rs", isDirectory: false },
  { name: "logo.png", path: "/repo/logo.png", isDirectory: false },
  { name: "demo.mp4", path: "/repo/demo.mp4", isDirectory: false },
  { name: "huge.mp4", path: "/repo/huge.mp4", isDirectory: false, size: 48 * 1024 * 1024 },
];

const DEFAULT_CONTENT: Record<string, string> = {
  "/repo/README.md": "# Project\n\nMarkdown preview from the host.",
  "/repo/docs/guide.md": "# Guide\n\nSecond document.",
  "/repo/main.rs": "fn main() {\n    println!(\"hello\");\n}\n",
  // Media is read as base64, the way the host serves bytes to a preview.
  "/repo/logo.png": "iVBORw0KGgoAAAANSUhEUg==",
  "/repo/demo.mp4": "AAAAIGZ0eXBpc29t",
};

const DEFAULT_CONFIGS: Record<string, unknown> = {
  editor: { font_size: 14, tab_size: 4, word_wrap: "off", line_numbers: "on", minimap: { enabled: true } },
  terminal: { font_size: 14, scrollback: 1000, cursor_style: "block" },
  "app.logging.level": "info",
  "app.close_button_behavior": "minimize_to_tray",
  "app.notifications.dialog_completion_notify": true,
  "app.notifications.permission_request_notify": false,
  app: {
    language: "en-US",
    auto_update: true,
    telemetry: false,
    confirm_on_exit: true,
    restore_windows: true,
    // Two keys the user remapped; this front end shows the count, not an editor.
    keybindings: { "tab.close": "Mod+W", "session.new": "Mod+N" },
  },
  "app.ai_experience": {
    enable_session_title_generation: true,
    enable_workspace_search: false,
    quick_actions: [
      { id: "commit", label: "Commit", prompt: "Commit all current code changes", enabled: true },
      { id: "create_pr", label: "Create PR", prompt: "Create a Pull Request", enabled: false },
    ],
  },
  // A policy that asks the user, with one allow rule and a chat approval model.
  tool_permissions: {    policy: {
      preset: "ask",
      rules: [{ action: "run_command", resource: "git status", effect: "allow" }],
    },
    interaction: { auto_approve_ask: false },
    approval: {
      strategy: "interactive",
      model_kind: "chat",
      chat_model_id: "",
      timeout_ms: 30000,
      on_ask: "user",
      on_error: "ask",
    },
  },
  "memories.generate_memories": true,
  "memories.use_memories": true,
  "memories.generate_for_btw_sessions": false,
  "memories.external_context_policy": "clear_tool_results",
  "memories.max_unused_days": 30,
  "memories.max_raw_memories_for_consolidation": 64,
  // The document the memory fields that live in an object are read from, so a
  // write patches the same shape the host stores.
  memories: {
    generate_memories: true,
    generate_for_btw_sessions: false,
    use_memories: true,
    external_context_policy: "clear_tool_results",
    max_raw_memories_for_consolidation: 64,
    max_unused_days: 30,
    max_rollout_age_days: 10,
    max_rollouts_per_startup: 5,
    max_rollouts_scan_limit: 2000,
    min_rollout_idle_hours: 6,
    phase1_max_concurrency: 1,
    extract_model: null,
    consolidation_model: null,
  },
  "app.prevent_sleep": false,
  "app.logging.include_sensitive_diagnostics": false,
  "app.hooks.enabled": true,
  "app.hooks.project_hooks_enabled": false,
  "ai.computer_use_enabled": true,
  "ai.browser_control_auto_connect_on_startup": false,
  "ai.browser_control_preferred_browser": "",
  "app.flow_chat.show_permission_mode_control": true,
  "app.flow_chat.auto_show_selection_toolbar": true,
  "app.flow_chat.send_during_turn": "queue",
  "app.ai_experience.voice_input.enabled": true,
  "app.ai_experience.voice_input.default_language": "auto",
  "app.ai_experience.voice_input.max_recording_seconds": 60,
  "app.ai_experience.voice_input.microphone_device_id": "",
  "app.worktrees.rootPath": "~/.openbitfun/worktrees",
  "app.worktrees.branchPrefix": "openbitfun/",
  "app.worktrees.copyLocalChanges": false,
  "app.worktrees.autoDeleteEnabled": true,
  "app.worktrees.autoDeleteLimit": 15,
  // The document the desktop page writes whole; an unknown provider field is kept.
  "ai.web_search": {
    provider: "exa_search_api",
    providers: {
      exa_search_api: { credentialId: "exa-search-api" },
      tavily: { credentialId: "tavily-search-api" },
      deepseek: { credentialId: "deepseek-search-api" },
      keenable: { credentialId: "keenable-search-api" },
      openbitfun_search_http: {
        endpoint: "",
        auth: { mode: "none", credentialId: "openbitfun-search-http", headerName: "" },
      },
    },
  },
  "ai.enable_deferred_tool_loading": true,
  "ai.subagent_max_concurrency": 4,
  "ai.subagent_batch_execution_policy": "force_parallel",
  "ai.tool_presentation_mode": "native",
  // The serde shape of `TaskModelSelection`: a unit variant, and a struct one.
  "ai.task_models": {
    session_title: { Fixed: { model_id: "model-1" } },
    git_commit: "Inherit",
  },
  "ai.models": [
    {
      id: "model-1",
      name: "Configured model",
      provider: "openai",
      model_name: "gpt-4.1-mini",
      base_url: "https://api.openai.com/v1",
      request_url: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-configured",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
  ],
  // The default roles automatic approval offers before any concrete model id.
  "ai.default_models": { primary: "model-1" },
  "ai.decision_model": { model_name: "jev-latest", endpoint: "https://api.typesafe.ai/v1/systemone" },
};

const DEFAULT_MODEL_CATALOG = {
  provider_catalog: {
    revision: "fixture-1",
    source: "bundle",
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        requires_api_key: true,
        endpoints: [
          {
            id: "anthropic-default",
            base_url: "https://api.anthropic.com/v1",
            api_format: "anthropic",
            label: "Anthropic",
            is_default: true,
            trusted_for_auto_detection: true,
          },
        ],
        models: [
          {
            id: "claude-sonnet-4",
            display_name: "Claude Sonnet 4",
            recommended: true,
            limits: { context: 200_000, output: 8_000 },
            capabilities: { chat: true, tool_call: true, reasoning: true, attachment: true },
          },
          {
            // A model the catalog knows but gives no limits, so the picker must
            // leave the form's limit fields alone instead of writing zeroes.
            id: "claude-haiku-4",
            display_name: "Claude Haiku 4",
            recommended: false,
            capabilities: { chat: true, tool_call: true, reasoning: false, attachment: false },
          },
        ],
      },
      {
        id: "moonshot",
        name: "Moonshot",
        description: "Kimi models",
        requires_api_key: true,
        endpoints: [
          {
            id: "moonshot-default",
            base_url: "https://api.moonshot.cn/v1",
            api_format: "openai",
            label: "Moonshot",
            is_default: true,
            trusted_for_auto_detection: true,
          },
        ],
        models: [
          {
            id: "kimi-k2",
            display_name: "Kimi K2",
            recommended: true,
            limits: { context: 128_000, output: 4_000 },
            capabilities: { chat: true, tool_call: true, reasoning: true, attachment: false },
          },
        ],
      },
    ],
  },
};

/** The presets a model's provider compiles its reasoning into, as the host reports them. */
const DEFAULT_REASONING_CATALOG = {
  status: "known",
  default_preset: "low",
  presets: [
    { id: "low", label: "Low", order: 0, actions: [{ type: "effort", value: "low" }], source: "models_dev" },
    { id: "high", label: "High", order: 1, actions: [{ type: "effort", value: "high" }], source: "models_dev" },
  ],
};

/** What the host's message search answers before a query narrows it. */
const DEFAULT_SESSION_HITS = [
  {
    kind: "message",
    matchedField: "content",
    sessionId: "session-2",
    sessionTitle: "Terminal migration",
    turnId: "turn-1",
    snippet: "Terminal is wired to terminal_create.",
    archived: false,
    updatedAtMs: 1762900000000,
    score: 2,
  },
  {
    kind: "message",
    matchedField: "content",
    sessionId: "session-1",
    sessionTitle: "NSH skeleton",
    turnId: "turn-2",
    snippet: "Planned, then edited the imports.",
    archived: false,
    updatedAtMs: 1763000000000,
    score: 1,
  },
];

const TURNS: Record<string, unknown[]> = {
  "session-1": [
    {
      id: "turn-1",
      userMessage: { id: "user-1", content: "Port the session list." },
      modelRounds: [
        {
          assistantMessage: {
            id: "a-1",
            content: "Rendered with a virtualized list.",
            toolCalls: [{ toolName: "read_file", arguments: { path: "src/web-ui/src/app/NavPanel.tsx" } }],
          },
        },
      ],
    },
    {
      id: "turn-2",
      userMessage: { id: "user-2", content: "Add the plan and fix the imports." },
      modelRounds: [
        {
          assistantMessage: {
            id: "a-2",
            content: "Planned, then edited.",
            toolCalls: [
              {
                toolName: "todo_write",
                arguments: {
                  todos: [
                    { content: "Read the panel", status: "completed" },
                    { content: "Move the list", status: "in_progress" },
                    { content: "Delete the old table", status: "pending" },
                  ],
                },
              },
              {
                toolName: "edit",
                arguments: {
                  file_path: "/repo/main.rs",
                  old_string: "fn main() {\n    println!(\"hello\");\n}",
                  new_string: "fn main() {\n    println!(\"hello, cards\");\n}",
                },
              },
            ],
          },
        },
      ],
    },
  ],
  "session-2": [
    {
      id: "turn-1",
      userMessage: { id: "user-1", content: "Port the terminal." },
      modelRounds: [{ assistantMessage: { id: "a-1", content: "Terminal is wired to terminal_create." } }],
    },
    {
      // A reply as a model writes one: a heading, inline code and emphasis, a
      // fenced block and a link, which the transcript shows as Markdown.
      id: "turn-2",
      userMessage: { id: "user-2", content: "Show the plan." },
      modelRounds: [
        {
          // The reasoning a model streamed beside its answer is stored with it.
          thinkingItems: [
            {
              id: "think-1",
              content: "Weigh the two options before writing anything.",
              reasoningKind: "reasoning",
              isStreaming: false,
              isCollapsed: true,
              timestamp: 1,
            },
          ],
          assistantMessage: {
            id: "a-2",
            content:
              "## Plan\n\nRun `pnpm run check` first, then **fix** the rest.\n\n```rust\nlet rows = load();\n```\n\nSee [the docs](https://example.com/docs) for more.",
          },
        },
      ],
    },
  ],
};

interface VirtualEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

function entryName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * A mutable directory map the file commands act on, so a create, rename or
 * delete in a test changes what the next `explorer_get_children` returns the way
 * the host would.
 */
function buildVirtualFs(
  root: string,
  files: Array<{ name: string; path: string; isDirectory: boolean; size?: number; children?: unknown[] }>,
) {
  const byDirectory = new Map<string, VirtualEntry[]>();
  const put = (directory: string, entry: VirtualEntry) => {
    const list = byDirectory.get(directory) ?? [];
    if (!list.some(item => item.path === entry.path)) list.push(entry);
    byDirectory.set(directory, list);
  };
  const walk = (
    directory: string,
    children: Array<{ name: string; path: string; isDirectory: boolean; size?: number; children?: unknown[] }>,
  ) => {
    for (const child of children ?? []) {
      put(directory, {
        name: child.name || entryName(child.path),
        path: child.path,
        isDirectory: Boolean(child.isDirectory),
        // A listing carries the size, so a preview can decide before reading bytes.
        ...(typeof child.size === "number" ? { size: child.size } : {}),
      });
      if (child.isDirectory) {
        byDirectory.set(child.path, byDirectory.get(child.path) ?? []);
        walk(
          child.path,
          (child.children ?? []) as Array<{
            name: string;
            path: string;
            isDirectory: boolean;
            size?: number;
            children?: unknown[];
          }>,
        );
      }
    }
  };
  byDirectory.set(root, []);
  walk(root, files);
  return byDirectory;
}

// settings mutations (wave 3 config): what `get_settings_schema` answers on the
// host, as generated from the product-control catalog and `GlobalConfig`'s
// defaults for the paths the settings page draws.
const SETTINGS_DESCRIPTOR: Record<string, Record<string, unknown>> = {
  "ai.browser_control_auto_connect_on_startup": {"constrained": true, "default": false, "type": "boolean"},
  "ai.browser_control_preferred_browser": {"constrained": false, "default": ""},
  "ai.computer_use_enabled": {"constrained": true, "default": true, "type": "boolean"},
  "ai.enable_deferred_tool_loading": {"constrained": true, "default": true, "type": "boolean"},
  "ai.proxy.enabled": {"constrained": false, "default": false},
  "ai.proxy.password": {"constrained": false, "default": null},
  "ai.proxy.url": {"constrained": false, "default": ""},
  "ai.proxy.username": {"constrained": false, "default": null},
  "ai.stream_idle_timeout_secs": {"constrained": true, "default": 600, "maximum": 86400, "minimum": 1, "nullable": true, "type": "integer"},
  "ai.stream_ttft_timeout_secs": {"constrained": true, "default": 600, "maximum": 86400, "minimum": 1, "nullable": true, "type": "integer"},
  "ai.subagent_batch_execution_policy": {"constrained": true, "default": "force_parallel", "enum": ["safe_only", "force_parallel", "serial"], "type": "string"},
  "ai.subagent_max_concurrency": {"constrained": true, "default": 5, "maximum": 32, "minimum": 1, "type": "integer"},
  "ai.swarm_max_concurrency": {"constrained": true, "default": 16, "maximum": 64, "minimum": 1, "type": "integer"},
  "ai.tool_execution_timeout_secs": {"constrained": true, "default": null, "maximum": 86400, "minimum": 1, "nullable": true, "type": "integer"},
  "ai.tool_presentation_mode": {"constrained": true, "default": "native", "enum": ["native", "ptc", "ptc_python"], "type": "string"},
  "ai.user_question_timeout_secs": {"constrained": false, "default": 180},
  "app.ai_experience.enable_git_commit_coauthor": {"constrained": false, "default": true},
  "app.ai_experience.enable_prompt_suggestion": {"constrained": false, "default": true},
  "app.ai_experience.enable_session_title_generation": {"constrained": false, "default": true},
  "app.ai_experience.enable_workspace_search": {"constrained": false, "default": false},
  "app.ai_experience.voice_input.default_language": {"constrained": false, "default": "auto"},
  "app.ai_experience.voice_input.enabled": {"constrained": false, "default": true},
  "app.ai_experience.voice_input.max_recording_seconds": {"constrained": false, "default": 60},
  "app.ai_experience.voice_input.microphone_device_id": {"constrained": false, "default": ""},
  "app.auto_update": {"constrained": true, "default": true, "type": "boolean"},
  "app.close_button_behavior": {"constrained": true, "default": "minimize_to_tray", "enum": ["ask", "minimize_to_tray", "quit"], "type": "string"},
  "app.flow_chat.auto_show_selection_toolbar": {"constrained": true, "default": true, "type": "boolean"},
  "app.hooks.enabled": {"constrained": false, "default": true},
  "app.hooks.project_hooks_enabled": {"constrained": false, "default": false},
  "app.logging.include_sensitive_diagnostics": {"constrained": true, "default": false, "type": "boolean"},
  "app.logging.level": {"constrained": true, "default": "debug", "enum": ["error", "warn", "info", "debug", "trace", "off"], "type": "string"},
  "app.notifications.dialog_completion_notify": {"constrained": true, "default": true, "type": "boolean"},
  "app.notifications.permission_request_notify": {"constrained": true, "default": true, "type": "boolean"},
  "app.prevent_sleep": {"constrained": false, "default": false},
  "app.worktrees.autoDeleteEnabled": {"constrained": true, "default": true, "type": "boolean"},
  "app.worktrees.autoDeleteLimit": {"constrained": true, "default": 15, "maximum": 100, "minimum": 1, "type": "integer"},
  "app.worktrees.branchPrefix": {"constrained": true, "default": "openbitfun/", "maxLength": 200, "minLength": 1, "type": "string"},
  "app.worktrees.copyLocalChanges": {"constrained": true, "default": false, "type": "boolean"},
  "app.worktrees.rootPath": {"constrained": true, "default": "~/.openbitfun/worktrees", "maxLength": 4096, "minLength": 1, "type": "string"},
  "editor.font_size": {"constrained": true, "default": 14, "maximum": 32, "minimum": 10, "type": "integer"},
  "editor.line_numbers": {"constrained": true, "default": "on", "enum": ["on", "off", "relative", "interval"], "type": "string"},
  "editor.minimap.enabled": {"constrained": true, "default": true, "type": "boolean"},
  "editor.tab_size": {"constrained": true, "default": 4, "maximum": 8, "minimum": 1, "type": "integer"},
  "editor.word_wrap": {"constrained": true, "default": "off", "enum": ["off", "on", "wordWrapColumn", "bounded"], "type": "string"},
  "memories.consolidation_model": {"constrained": false, "default": null},
  "memories.external_context_policy": {"constrained": false, "default": "clear_tool_results"},
  "memories.extract_model": {"constrained": false, "default": null},
  "memories.generate_for_btw_sessions": {"constrained": false, "default": false},
  "memories.generate_memories": {"constrained": false, "default": false},
  "memories.max_raw_memories_for_consolidation": {"constrained": false, "default": 64},
  "memories.max_rollout_age_days": {"constrained": false, "default": 10},
  "memories.max_rollouts_per_startup": {"constrained": false, "default": 2},
  "memories.max_rollouts_scan_limit": {"constrained": false, "default": 2000},
  "memories.max_unused_days": {"constrained": false, "default": 30},
  "memories.min_rollout_idle_hours": {"constrained": false, "default": 6},
  "memories.phase1_max_concurrency": {"constrained": false, "default": 1},
  "memories.use_memories": {"constrained": false, "default": false},
  "terminal.cursor_style": {"constrained": false, "default": "block"},
  "terminal.font_size": {"constrained": false, "default": 14},
  "terminal.scrollback": {"constrained": false, "default": 1000},
};

export function createBackend(options: BackendOptions = {}): Backend {
  let accountSyncStatus: Record<string, unknown> | null =
    options.accountSync === undefined
      ? { enabled: true, phase: "synced", pending: 0, peers: 1, peersOnline: 1, active: true, groups: ["preferences", "permissions"] }
      : options.accountSync;
  const calls: BackendCall[] = [];
  // features (wave 5): what the presentation surface reported back.
  const controlReports: Array<Record<string, unknown>> = [];
  // remote link + terminal profiles (wave 4)
  const hostTerminalProfiles: Record<
    string,
    Array<{ id: string; name: string; shellId: string; shellType: string; startupCommand: string }>
  > = JSON.parse(JSON.stringify(options.terminalProfiles ?? {}));
  let terminalProfileSeq = 0;
  // Sessions carry their agent binding, so a switch shows up in the next read the
  // way the host reports it.
  let sessions: Array<Record<string, unknown>> = options.sessions ?? DEFAULT_SESSIONS;
  let createdSessionSeq = 0;
  let openedWorkspaces: Array<{
    id: string;
    name: string;
    rootPath: string;
    workspaceKind?: string;
    sshHost?: string;
    connectionId?: string;
  }> =
    options.openedWorkspaces ?? [
      { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
      { id: "workspace-2", name: "remote-host", rootPath: "/srv/app", workspaceKind: "remote" },
    ];
  let recentOnlyWorkspaces = options.recentOnlyWorkspaces ?? [];
  let currentWorkspaceId: string | null =
    options.currentWorkspaceId !== undefined ? options.currentWorkspaceId : (openedWorkspaces[0]?.id ?? null);
  const files = options.files ?? DEFAULT_FILES;
  const content = options.fileContent ?? DEFAULT_CONTENT;
  const fs = buildVirtualFs("/repo", files);
  const settingsWrites: Array<{ path: string; value: unknown }> = [];
  // The documents `get_config` answers from. A `set_config` lands here too, as on
  // the host, so a surface that re-reads before it writes sees its own last write.
  // A copy per backend: the shared defaults never change between tests.
  const liveConfigs: Record<string, unknown> = JSON.parse(JSON.stringify(options.configs ?? DEFAULT_CONFIGS));
  const initialAppConfig = (options.configs ?? DEFAULT_CONFIGS).app;
  let currentLanguage =
    initialAppConfig &&
    typeof initialAppConfig === "object" &&
    typeof (initialAppConfig as Record<string, unknown>).language === "string"
      ? String((initialAppConfig as Record<string, unknown>).language)
      : "en-US";
  // The web-search key lives in the vault, not in the config: the fixture keeps
  // the two apart so a test can see which command a secret travelled in.
  const credentialWrites: Array<{ provider: string; secret: string }> = [];
  let decisionKeyConfigured = options.decisionKeyConfigured === true;
  const decisionKeyWrites: string[] = [];
  let decisionKeyCleared = 0;
  const clearedCredentials: string[] = [];
  let credentialConfigured = options.searchCredentialConfigured ?? false;
  let submitted: unknown = null;
  const cancelledJobs: string[] = [];
  const dispatchAnswers: Array<{ jobId: string; requestId: string; reply: string }> = [];
  const dispatchAppends: Array<{ jobId: string; content: string }> = [];
  const dispatchContinues: Array<{ jobId: string; turnId: string; prompt: string }> = [];
  const dispatchSyncs: string[] = [];
  const usageRequests: Array<Record<string, unknown>> = [];
  const sessionModeWrites: Array<{ sessionId: string; modeId: string; workspaceId?: string }> = [];
  // session policy (wave 3): what the fixture host runs and decides.
  const runningTurnsBySession: Record<string, string> = {};
  const userMessages: Backend["userMessages"] = [];
  const seenMarks: Backend["seenMarks"] = [];
  let submittedTurns = 0;
  const acpSaves: string[] = [];
  const acpInstalls: string[] = [];
  const reveals: string[] = [];
  // The log folder the fixture host reports, and how it ends its run.
  const runtimeLogging = options.runtimeLogging === undefined ? DEFAULT_RUNTIME_LOGGING : options.runtimeLogging;
  // Blocking user questions: the mailbox answer, and everything this surface sent.
  let pendingQuestions = options.pendingQuestions === undefined ? [] : options.pendingQuestions;
  const questionStarts: Array<{ sessionId: string; toolId: string }> = [];
  const userAnswers: Array<{ toolId: string; answers: Record<string, unknown>; sessionId: string }> = [];
  // Per-session permission mode overrides (`null` follows the default), as the host keeps them.
  const sessionPermissionModes: Record<string, string | null> = {};
  const turnPermissionModes: Record<string, string | null> = {};
  let acpJsonText = '{\n  "acpClients": {}\n}';
  let acpRows = [...(options.acpClients ?? DEFAULT_ACP_CLIENTS)];
  let terminalCount = 0;
  // The host holds queued messages; the fixture keeps the same shape so the
  // surface's list is the host's answer rather than its own bookkeeping.
  const hostQueue: HostQueueRow[] = [];
  // Every mutation bumps the revision, so a reorder that names a stale one is
  // refused here exactly as the runtime refuses it.
  let queueRevision = 0;
  const queueReorders: Array<{ turnId: string; beforeTurnId: string | null; expectedRevision: number }> = [];
  // Model pools belong to the host too: `save_model_pool` with an empty id is how
  // a new one is created, and the host allocates the id it returns.
  const poolRows: Array<{ id: string; name: string; strategy: string; member_model_ids: string[] }> = [];
  let poolSeq = 1;
  // A session's reasoning setting is host state, written together with its model.
  // `null` is the model's own default, and `undefined` is a host too old to report
  // the field at all.
  let sessionReasoningPreset: string | null | undefined = options.sessionReasoningPreset;
  const reasoningCatalogFixture =
    options.reasoningCatalog === undefined ? undefined : options.reasoningCatalog;

  /** The host's own models.dev projection; `null` makes the command absent. */
  const modelCatalogFixture =
    options.modelCatalog === undefined ? DEFAULT_MODEL_CATALOG : options.modelCatalog;

  function poolDocument(): unknown {
    return { version: 1, pools: poolRows.map(row => ({ ...row, member_model_ids: [...row.member_model_ids] })) };
  }

  function answerPools(action: string, request: unknown): unknown {
    const payload = (request ?? {}) as {
      pool?: { id?: string; name?: string; strategy?: string; member_model_ids?: string[] };
      poolId?: string;
    };
    switch (action) {
      case "get_model_pools":
        return poolDocument();
      case "save_model_pool": {
        const pool = payload.pool ?? {};
        const members = Array.isArray(pool.member_model_ids) ? pool.member_model_ids : [];
        const existing = poolRows.find(row => row.id === pool.id);
        if (existing) {
          existing.name = String(pool.name ?? existing.name);
          existing.strategy = String(pool.strategy ?? existing.strategy);
          existing.member_model_ids = members;
        } else {
          poolRows.push({
            id: `pool-${poolSeq++}`,
            name: String(pool.name ?? "Pool"),
            strategy: String(pool.strategy ?? "ordered"),
            member_model_ids: members,
          });
        }
        return poolDocument();
      }
      case "delete_model_pool": {
        const index = poolRows.findIndex(row => row.id === payload.poolId);
        if (index >= 0) poolRows.splice(index, 1);
        return poolDocument();
      }
      case "get_model_pool_status":
        return (poolRows.find(row => row.id === payload.poolId)?.member_model_ids ?? []).map(modelId => ({
          modelId,
          status: modelId === "model-1" ? "cooling_down" : "available",
          ...(modelId === "model-1" ? { reason: "rate limited" } : {}),
        }));
      default:
        return poolDocument();
    }
  }

  function unsupported(action: string): never {
    throw new Error(`${action} is not available on this host`);
  }
  // MCP: the runtime list, the stored document and its fingerprint all live on the
  // host and move together, so a test can see which command changed what. The
  // document keeps a field no form draws, which a configuration write must not drop.
  const mcpRows: Array<Record<string, unknown>> = [
    {
      id: "fs-server",
      name: "Filesystem",
      status: "Connected",
      transport: "stdio",
      enabled: true,
      autoStart: true,
      command: "npx",
      commandAvailable: true,
      startSupported: true,
    },
    {
      id: "remote-docs",
      name: "Docs",
      status: "Stopped",
      transport: "streamable-http",
      enabled: false,
      autoStart: false,
      url: "https://docs.example/mcp",
      startSupported: true,
      statusMessage: "not started yet",
      oauthEnabled: true,
      authConfigured: false,
    },
  ];
  let mcpDocumentText = JSON.stringify(
    {
      mcpServers: {
        "fs-server": {
          command: "npx",
          args: ["-y", "fs-mcp"],
          enabled: true,
          autoStart: true,
          transport: "stdio",
          keepMe: "unknown field",
        },
        "remote-docs": {
          url: "https://docs.example/mcp",
          transport: "streamable-http",
          enabled: false,
          oauthEnabled: true,
        },
      },
    },
    null,
    2,
  );
  let mcpFingerprint = 1;
  const mcpSaves: Array<{ jsonConfig: string; expectedFingerprint: string }> = [];
  // The remote OAuth session the host holds for one server, and what the
  // authorization writes did. A test moves the session with `setMcpOAuthSession`.
  let mcpOAuthSession: Record<string, unknown> | null = null;
  const mcpAuthWrites: Array<{ serverId: string; authorizationValue: string }> = [];
  const mcpAuthClears: string[] = [];
  // The resources one connected server publishes; the browser reads them per URI.
  const mcpResourceRows = [
    {
      uri: "memo://notes",
      name: "Notes",
      title: "Team notes",
      description: "Weekly notes",
      mimeType: "text/markdown",
    },
    { uri: "memo://config", name: "Config", mimeType: "application/json" },
    { uri: "memo://logo", name: "Logo", mimeType: "image/png" },
  ];

  function mcpRow(id: string): Record<string, unknown> | undefined {
    return mcpRows.find(row => row.id === id);
  }

  function mcpStatusOf(id: string): string {
    return String(mcpRows.find(row => row.id === id)?.status ?? "Stopped");
  }
  function mcpSetStatus(id: string, status: string): void {
    const row = mcpRows.find(entry => entry.id === id);
    if (row) row.status = status;
  }

  function answerMcp(action: string, request: unknown, positional: boolean): unknown {
    const body = (request ?? {}) as {
      serverId?: string;
      jsonConfig?: string;
      expectedFingerprint?: string;
      authorizationValue?: string;
      resourceUri?: string;
    };
    // The simulated host rejects a call whose argument shape does not match the
    // command's real signature, the way Tauri does.
    const positionalCommands = new Set([
      "save_mcp_json_config",
      "start_mcp_server",
      "stop_mcp_server",
      "restart_mcp_server",
    ]);
    if (positionalCommands.has(action) !== positional) {
      throw new Error(`${action} does not take ${positional ? "positional" : "a request"} arguments`);
    }
    switch (action) {
      case "get_mcp_servers":
        return mcpRows;
      case "load_mcp_json_config":
        return { jsonConfig: mcpDocumentText, fingerprint: `fp-${mcpFingerprint}` };
      case "save_mcp_json_config": {
        const expected = String(body.expectedFingerprint ?? "");
        if (expected !== `fp-${mcpFingerprint}`) {
          // The host refuses a write based on a document that moved under it.
          throw new Error("MCP configuration changed; reload before saving");
        }
        mcpSaves.push({ jsonConfig: String(body.jsonConfig ?? ""), expectedFingerprint: expected });
        mcpDocumentText = String(body.jsonConfig ?? "");
        mcpFingerprint += 1;
        // The runtime list follows the stored `enabled` flags, as the host's does.
        try {
          const stored = (JSON.parse(mcpDocumentText) as { mcpServers?: Record<string, { enabled?: boolean }> })
            .mcpServers ?? {};
          for (const row of mcpRows) {
            const entry = stored[String(row.id)];
            if (entry) row.enabled = entry.enabled !== false;
          }
        } catch {
          // A document the test wrote by hand may not parse; the rows stay as they were.
        }
        return null;
      }
      case "start_mcp_server": {
        // The host refuses to start a server the stored configuration disables.
        const serverId = String(body.serverId ?? "");
        const stored = (JSON.parse(mcpDocumentText) as { mcpServers?: Record<string, { enabled?: boolean }> })
          .mcpServers?.[serverId];
        if (stored && stored.enabled === false) {
          throw new Error(`MCP server '${serverId}' is disabled`);
        }
        mcpSetStatus(serverId, "Connected");
        return null;
      }
      case "stop_mcp_server":
        mcpSetStatus(String(body.serverId ?? ""), "Stopped");
        return null;
      case "restart_mcp_server":
        mcpSetStatus(String(body.serverId ?? ""), "Connected");
        return null;
      case "list_mcp_resources": {
        // What one connected server publishes: text, json, and a binary entry the
        // browser must report as binary rather than decode.
        return mcpResourceRows;
      }
      case "read_mcp_resource": {
        const uri = String(body.resourceUri ?? "");
        if (uri === "memo://notes") {
          return {
            contents: [{ uri, mimeType: "text/markdown", content: "# Notes\n\nHello from the server." }],
          };
        }
        if (uri === "memo://config") {
          return {
            contents: [
              { uri, mimeType: "application/json", content: "{\n  \"retries\": 2\n}" },
              { uri, mimeType: "text/plain", content: "second block" },
            ],
          };
        }
        if (uri === "memo://logo") {
          return { contents: [{ uri, mimeType: "image/png", blob: "iVBORw0KGgoAAAANSUhEUg==" }] };
        }
        return { contents: [] };
      }
      case "delete_mcp_server": {
        if (positional) throw new Error("delete_mcp_server takes a request object");
        const id = String(body.serverId ?? "");
        const index = mcpRows.findIndex(row => row.id === id);
        if (index >= 0) mcpRows.splice(index, 1);
        const parsed = JSON.parse(mcpDocumentText) as { mcpServers?: Record<string, unknown> };
        if (parsed.mcpServers) delete parsed.mcpServers[id];
        mcpDocumentText = JSON.stringify(parsed, null, 2);
        mcpFingerprint += 1;
        return null;
      }
      case "start_mcp_remote_oauth": {
        const id = String(body.serverId ?? "");
        mcpOAuthSession = {
          serverId: id,
          status: "awaitingBrowser",
          authorizationUrl: "https://auth.example/authorize?state=abc123",
          redirectUri: "http://127.0.0.1:45871/oauth/callback",
          message: "Waiting for the browser",
        };
        return mcpOAuthSession;
      }
      case "get_mcp_remote_oauth_session": {
        const id = String(body.serverId ?? "");
        return mcpOAuthSession && mcpOAuthSession.serverId === id ? mcpOAuthSession : null;
      }
      case "cancel_mcp_remote_oauth":
        if (mcpOAuthSession) mcpOAuthSession = { ...mcpOAuthSession, status: "cancelled" };
        return null;
      case "update_mcp_remote_auth": {
        const id = String(body.serverId ?? "");
        mcpAuthWrites.push({ serverId: id, authorizationValue: String(body.authorizationValue ?? "") });
        const row = mcpRow(id);
        if (row) row.authConfigured = true;
        return null;
      }
      case "clear_mcp_remote_auth": {
        const id = String(body.serverId ?? "");
        mcpAuthClears.push(id);
        const row = mcpRow(id);
        if (row) row.authConfigured = false;
        return null;
      }
      default:
        return mcpStatusOf(String(body.serverId ?? ""));
    }
  }

  /**
   * The target's event log, read the way `dispatch_status` reads it: the cursor
   * is "everything up to here is applied", a page carries at most the target's
   * page limit, and a cursor beyond the log is the reset signal.
   */
  function answerDispatchStatus(payload: Record<string, unknown>): unknown {
    const log = options.dispatchEvents ?? [];
    const requestCursor = Number(payload.cursor ?? 0);
    if (requestCursor > log.length) {
      return {
        state: String(options.dispatchState ?? "running"),
        cursor: 0,
        events: [],
        pendingPermissions: [],
        cursorReset: true,
        historyTruncated: false,
        eventLogComplete: true,
        omittedEventCount: 0,
      };
    }
    const pageSize = options.dispatchPageSize ?? 4;
    const events = log.slice(requestCursor, requestCursor + pageSize);
    const cursor = requestCursor + events.length;
    // The state the job reached by the end of this page.
    let state = String(options.dispatchState ?? "running");
    for (const event of log.slice(0, cursor)) {
      if (event.type === "jobState" && typeof event.state === "string") state = event.state;
    }
    const terminal = state === "succeeded" || state === "failed" || state === "cancelled";
    return {
      state,
      cursor,
      events,
      pendingPermissions: terminal ? [] : (options.dispatchPermissions ?? []),
      cursorReset: false,
      historyTruncated: false,
      eventLogComplete: true,
      omittedEventCount: 0,
    };
  }

  /** Whether the referenced workspace is an assistant workspace (`workspaceKind === "assistant"`). */
  function isAssistantWorkspace(workspaceId: unknown, workspacePath?: unknown): boolean {
    const id = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
    const all = [...openedWorkspaces, ...recentOnlyWorkspaces];
    const match =
      (id ? all.find(ws => ws.id === id) : undefined) ??
      (path ? all.find(ws => ws.rootPath === path) : undefined);
    return (match?.workspaceKind ?? "").toLowerCase() === "assistant";
  }

  /** The fixture host's mode catalog: assistant workspaces offer only Claw; project workspaces exclude Claw. */
  function answerModeCatalog(payload: Record<string, unknown>): unknown {
    const rows = (options.agentModes ?? DEFAULT_AGENT_MODES) as Array<{ id: string; name?: string; description?: string }>;
    const sessionId = String(payload.sessionId ?? "");
    const row = sessions.find(item => item.sessionId === sessionId);
    const started = Boolean(row) && Number(row?.messageCount ?? 1) > 0;
    const assistant = isAssistantWorkspace(payload.workspaceId ?? row?.workspaceId, payload.workspacePath);
    if (assistant) {
      const clawRow = rows.find(item => String(item.id ?? "").trim().toLowerCase() === "claw");
      const sessionMode = row ? String(row.agentType ?? "Claw") : undefined;
      const switchable = !(row && started) || String(sessionMode ?? "").toLowerCase() === "claw";
      return {
        entries: [
          {
            id: "Claw",
            label: String(clawRow?.name ?? "").trim() || "Claw",
            description: String(clawRow?.description ?? ""),
            profile: false,
            switchable,
          },
        ],
        defaultModeId: "Claw",
        ...(row ? { sessionModeId: sessionMode, sessionStarted: started } : {}),
      };
    }
    const profiles = ["Minimal", "Standard", "Ultimate", "Creative"];
    const aliases: Record<string, string> = { agentic: "Standard", balanced: "Standard", ultra: "Ultimate" };
    const profileOf = (id: string) =>
      profiles.find(name => name.toLowerCase() === (aliases[id.toLowerCase()] ?? id).toLowerCase()) ?? null;
    const seen = new Set<string>();
    const entries: Array<{ id: string; label: string; description: string; profile: boolean; switchable: boolean }> = [];
    for (const row of rows) {
      const raw = String(row.id ?? "").trim();
      if (!raw || ["claw", "multitask", "plan"].includes(raw.toLowerCase())) continue;
      const profile = profileOf(raw);
      const id = profile ?? raw;
      if (seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      entries.push({ id, label: String(row.name ?? "").trim() || id, description: String(row.description ?? ""), profile: profile !== null, switchable: true });
    }
    const ordered = [
      ...profiles.flatMap(name => entries.filter(entry => entry.profile && entry.id === name)),
      ...entries.filter(entry => !entry.profile),
    ];
    const sessionMode = row ? String(row.agentType ?? "Standard") : undefined;
    if (row && started) {
      for (const entry of ordered) entry.switchable = entry.id.toLowerCase() === (profileOf(sessionMode!) ?? sessionMode!).toLowerCase();
    }
    const flow = (liveConfigs["app.flow_chat"] ?? {}) as Record<string, unknown>;
    const eligible = (value: unknown) => {
      if (typeof value !== "string" || !value.trim()) return null;
      if (["claw", "multitask", "plan"].includes(value.trim().toLowerCase())) return null;
      const id = profileOf(value.trim()) ?? value.trim();
      return ordered.some(entry => entry.id.toLowerCase() === id.toLowerCase()) ? id : null;
    };
    const fixed = eligible(flow.default_mode_id);
    const last = eligible(flow.last_mode_id);
    const defaultModeId = (flow.default_mode_strategy === "fixed" ? fixed ?? last : last ?? fixed) ?? "Standard";
    return {
      entries: ordered,
      defaultModeId,
      ...(row ? { sessionModeId: sessionMode, sessionStarted: started } : {}),
    };
  }

  function answerHostQueue(request: unknown): unknown {    const payload = (request ?? {}) as {
      sessionId?: string;
      action?: string;
      message?: { turnId?: string; content?: string; displayContent?: string };
      turnId?: string;
      beforeTurnId?: string | null;
      expectedRevision?: number;
    };
    const sessionId = String(payload.sessionId ?? "");
    switch (payload.action) {
      case "list":
        return snapshot(sessionId);
      case "submit": {
        const turnId = String(payload.message?.turnId ?? "");
        hostQueue.push({
          sessionId,
          turnId,
          content: String(payload.message?.displayContent ?? payload.message?.content ?? ""),
          status: "queued",
        });
        queueRevision += 1;
        return snapshot(sessionId);
      }
      case "cancel": {
        const index = hostQueue.findIndex(row => row.turnId === payload.turnId);
        if (index >= 0) {
          hostQueue.splice(index, 1);
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      case "promote": {
        const row = hostQueue.find(entry => entry.turnId === payload.turnId);
        if (row) {
          row.status = "started";
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      case "reorder": {
        // A stale revision is refused, so a client that forgot to re-read the
        // snapshot fails here rather than silently overwriting another change.
        const turnId = String(payload.turnId ?? "");
        const beforeTurnId = payload.beforeTurnId ?? null;
        if (payload.expectedRevision !== queueRevision) {
          throw new Error(`stale queue revision ${String(payload.expectedRevision)}`);
        }
        queueReorders.push({ turnId, beforeTurnId, expectedRevision: queueRevision });
        const from = hostQueue.findIndex(row => row.sessionId === sessionId && row.turnId === turnId);
        if (from >= 0) {
          const [moving] = hostQueue.splice(from, 1);
          const before = beforeTurnId === null
            ? -1
            : hostQueue.findIndex(row => row.sessionId === sessionId && row.turnId === beforeTurnId);
          if (before < 0) hostQueue.push(moving);
          else hostQueue.splice(before, 0, moving);
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      default:
        return snapshot(sessionId);
    }
  }

  function snapshot(sessionId: string): unknown {
    const blocked = options.hostQueueBlocked ?? {};
    const items = hostQueue
      .filter(row => row.sessionId === sessionId)
      .map(row => ({
        turnId: row.turnId,
        displayContent: row.content,
        previewTruncated: false,
        attachmentCount: 0,
        agentType: "Standard",
        createdAtMs: 0,
        status: blocked[row.turnId] ? "blocked" : row.status,
        reason: blocked[row.turnId] ?? null,
        targetTurnId: null,
        steeringId: null,
      }));
    const reorder = options.hostQueueReorder === undefined ? true : options.hostQueueReorder;
    return {
      sessionId,
      queueEpoch: "epoch-1",
      revision: queueRevision,
      activeTurnId: null,
      items,
      ...(reorder === null ? {} : { supportsReorder: reorder }),
      capacity: 20,
      used: items.length,
      receipt: null,
    };
  }

  // settings mutations (wave 3 config): the typed commands, applied the way the
  // host does to the document `get_config` reads, then stored through
  // `set_config` so `settingsWrites` shows the document each intent produced.
  let mintedModels = 0;
  function readLive(path: string): unknown {
    try {
      return answer("get_config", { path, skipRetryOnNotFound: true });
    } catch {
      return null;
    }
  }
  function writeLive(path: string, value: unknown): void {
    answer("set_config", { path, value });
  }
  function storedRequestUrl(baseUrl: string, provider: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    if (trimmed.endsWith("#")) return trimmed.slice(0, -1).replace(/\/+$/, "");
    if (provider === "openai") return trimmed.endsWith("chat/completions") ? trimmed : `${trimmed}/chat/completions`;
    if (provider === "responses") return trimmed.endsWith("responses") ? trimmed : `${trimmed}/responses`;
    if (provider === "anthropic") {
      if (trimmed.endsWith("/messages")) return trimmed;
      return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
    }
    if (provider === "gemini") return trimmed.replace(/\/v1beta(?:\/models\/[^/]*)?$/, "").replace(/\/+$/, "");
    return trimmed;
  }
  function capabilitiesOf(category: string): string[] {
    if (category === "multimodal") return ["text_chat", "image_understanding"];
    if (category === "speech_recognition") return ["speech_recognition"];
    return ["text_chat"];
  }
  function permissionView(document: Record<string, unknown>): unknown {
    const policy = (document.policy ?? {}) as { preset?: string; rules?: unknown[] };
    const interaction = (document.interaction ?? {}) as { auto_approve_ask?: boolean };
    const approval = {
      strategy: "interactive",
      model_kind: "chat",
      chat_model_id: "fast",
      timeout_ms: 30000,
      on_ask: "user",
      on_error: "ask",
      ...((document.approval ?? {}) as Record<string, unknown>),
    };
    const preset = policy.preset ?? "full_access";
    const mode =
      preset === "full_access"
        ? "full_access"
        : interaction.auto_approve_ask || approval.strategy === "model" || approval.strategy === "immediate_allow"
          ? "auto_approve"
          : "ask";
    return { mode, rules: policy.rules ?? [], approval };
  }
  function permissionDocument(): Record<string, unknown> {
    const stored = readLive("tool_permissions");
    const document = JSON.parse(JSON.stringify(stored ?? {})) as Record<string, unknown>;
    document.policy = { preset: "full_access", rules: [], ...((document.policy ?? {}) as object) };
    document.interaction = { auto_approve_ask: false, ...((document.interaction ?? {}) as object) };
    return document;
  }
  function sameRule(left: unknown, right: unknown): boolean {
    const a = (left ?? {}) as Record<string, unknown>;
    const b = (right ?? {}) as Record<string, unknown>;
    return a.action === String(b.action ?? "").trim() && a.resource === String(b.resource ?? "").trim() && a.effect === b.effect;
  }
  function checkedRule(rule: unknown): Record<string, unknown> {
    const record = (rule ?? {}) as Record<string, unknown>;
    const action = String(record.action ?? "").trim();
    const resource = String(record.resource ?? "").trim();
    if (!action) throw new Error("Every rule needs an action, or * for all of them");
    if (!resource) throw new Error("Every rule needs a resource, for example workspace/*");
    return { action, resource, effect: record.effect };
  }
  function answerSettingsMutation(action: string, payload: Record<string, unknown>): unknown {
    if (options.legacySettingsHost) throw new Error(`Command ${action} not found`);
    switch (action) {
      // permission page view (wave 4): the host's projection of the stored documents.
      case "get_permission_settings": {
        const view = permissionView(permissionDocument()) as Record<string, unknown>;
        const models = (Array.isArray(readLive("ai.models")) ? readLive("ai.models") : []) as Array<Record<string, unknown>>;
        const configured = models.flatMap(entry => {
          const id = typeof entry.id === "string" ? entry.id : "";
          if (!id) return [];
          const name = String(entry.model_name || entry.name || id);
          return [{ id, name }];
        });
        const defaults = (readLive("ai.default_models") ?? {}) as Record<string, unknown>;
        const approvalModels: Array<Record<string, unknown>> = [];
        for (const role of ["fast", "primary"]) {
          const stored = typeof defaults[role] === "string" ? String(defaults[role]) : "";
          if (!stored) continue;
          const match = configured.find(entry => entry.id === stored);
          approvalModels.push({ value: role, role, modelId: stored, modelName: match?.name ?? null, available: Boolean(match) });
        }
        for (const model of configured) {
          approvalModels.push({ value: model.id, modelId: model.id, modelName: model.name, available: true });
        }
        return {
          ...view,
          approvalModels,
          showPermissionModeControl: readLive("app.flow_chat.show_permission_mode_control") === true,
        };
      }
      case "get_settings_schema": {
        const paths = Array.isArray(payload.paths) ? payload.paths.map(String) : Object.keys(SETTINGS_DESCRIPTOR);
        const fields: Record<string, unknown> = {};
        for (const path of paths) if (SETTINGS_DESCRIPTOR[path]) fields[path] = SETTINGS_DESCRIPTOR[path];
        return { catalogDigest: "test", fields };
      }
      case "resolve_ai_model_request_url": {
        const provider = String(payload.provider ?? "").trim().toLowerCase().replace(/^response$/, "responses") || "openai";
        const requestUrl = storedRequestUrl(String(payload.baseUrl ?? ""), provider);
        const model = String(payload.modelName ?? "").trim();
        const previewUrl =
          provider === "gemini" && requestUrl && !String(payload.baseUrl ?? "").trim().endsWith("#")
            ? `${requestUrl}/v1beta/models/${model ? encodeURIComponent(model) : "{model}"}:streamGenerateContent?alt=sse`
            : requestUrl;
        return { provider, requestUrl, previewUrl };
      }
      case "ai_model_upsert": {
        const models = JSON.parse(JSON.stringify(readLive("ai.models") ?? [])) as Array<Record<string, unknown>>;
        const ids: string[] = [];
        const clampedIds: string[] = [];
        for (const intent of (payload.models ?? []) as Array<Record<string, unknown>>) {
          let entry = intent.id ? models.find(model => model.id === intent.id) : undefined;
          if (intent.id && !entry) throw new Error(`Model '${String(intent.id)}' was removed while it was being edited; reload`);
          const created = !entry;
          if (!entry) {
            mintedModels += 1;
            entry = { id: `model_minted_${mintedModels}`, enabled: true, category: "general_chat", capabilities: [] };
            models.push(entry);
          }
          const routing = [entry.base_url, entry.provider, entry.model_name].join("|");
          const pick = (key: string, field: string, transform: (value: unknown) => unknown = value => value) => {
            if (Object.prototype.hasOwnProperty.call(intent, key)) entry![field] = transform(intent[key]);
          };
          pick("name", "name", value => String(value ?? "").trim());
          pick("provider", "provider", value => {
            const text = String(value ?? "").trim().toLowerCase();
            return text === "response" ? "responses" : text || "openai";
          });
          pick("modelName", "model_name", value => String(value ?? "").trim());
          pick("baseUrl", "base_url", value => String(value ?? "").trim());
          pick("apiKey", "api_key", value => String(value ?? "").trim());
          pick("enabled", "enabled");
          pick("skipSslVerify", "skip_ssl_verify");
          pick("customHeaders", "custom_headers");
          pick("customHeadersMode", "custom_headers_mode");
          pick("contextWindow", "context_window", value => (value ? value : null));
          pick("maxTokens", "max_tokens", value => (value ? value : null));
          if (created && entry.provider === undefined) entry.provider = "openai";
          for (const [field, label] of [["name", "a name"], ["model_name", "a model name"], ["base_url", "a base URL"]]) {
            if (!String(entry[field] ?? "").trim()) throw new Error(`A model needs ${label}`);
          }
          const previousCategory = entry.category;
          pick("category", "category");
          if (Array.isArray(intent.capabilities)) entry.capabilities = intent.capabilities;
          else if (created || previousCategory !== entry.category || !Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
            entry.capabilities = capabilitiesOf(String(entry.category ?? "general_chat"));
          }
          const window = typeof entry.context_window === "number" ? entry.context_window : 128128;
          const ceiling = Math.floor((window * 40) / 100);
          if (typeof entry.max_tokens === "number" && entry.max_tokens > ceiling) {
            entry.max_tokens = ceiling;
            clampedIds.push(String(entry.id));
          }
          if (created || routing !== [entry.base_url, entry.provider, entry.model_name].join("|") || !entry.request_url) {
            entry.request_url = storedRequestUrl(String(entry.base_url ?? ""), String(entry.provider ?? ""));
          }
          ids.push(String(entry.id));
        }
        writeLive("ai.models", models);
        return { models, ids, clampedIds };
      }
      case "ai_model_delete": {
        const id = String(payload.id ?? "");
        const models = (readLive("ai.models") ?? []) as Array<Record<string, unknown>>;
        if (!models.some(model => model.id === id)) throw new Error(`Model '${id}' is not stored; reload`);
        const next = models.filter(model => model.id !== id);
        writeLive("ai.models", next);
        // The host's model reconciliation clears the slots that named it.
        const slots = readLive("ai.default_models");
        let defaultModels = slots;
        if (slots && typeof slots === "object" && Object.values(slots).includes(id)) {
          defaultModels = Object.fromEntries(
            Object.entries(slots as Record<string, unknown>).map(([slot, value]) => [slot, value === id ? null : value]),
          );
          writeLive("ai.default_models", defaultModels);
        }
        return { models: next, defaultModels };
      }
      case "set_task_model": {
        const task = String(payload.task ?? "");
        if (task !== "session_title" && task !== "git_commit") throw new Error(`Unknown task '${task}'`);
        const read = (value: unknown): unknown => {
          if (value === "Inherit" || value === "inherit") return { kind: "inherit" };
          const record = (value ?? {}) as Record<string, unknown>;
          if (record.kind === "inherit") return { kind: "inherit" };
          if (record.kind === "fixed" && record.model_id) return { kind: "fixed", model_id: record.model_id };
          const fixed = record.Fixed as Record<string, unknown> | undefined;
          if (fixed?.model_id) return { kind: "fixed", model_id: fixed.model_id };
          return { kind: "fixed", model_id: "fast" };
        };
        const stored = (readLive("ai.task_models") ?? {}) as Record<string, unknown>;
        const document: Record<string, unknown> = { ...stored };
        for (const known of ["session_title", "git_commit"]) document[known] = read(stored[known]);
        document[task] = read(payload.selection);
        writeLive("ai.task_models", document);
        return { taskModels: { session_title: document.session_title, git_commit: document.git_commit } };
      }
      case "set_permission_mode": {
        const raw = String(payload.mode ?? "");
        const mode = raw === "auto" ? "auto_approve" : raw;
        if (!["ask", "auto_approve", "full_access"].includes(mode)) throw new Error(`Unknown permission mode '${raw}'`);
        const document = permissionDocument();
        const approval = { ...((document.approval ?? {}) as Record<string, unknown>) };
        (document.policy as Record<string, unknown>).preset = mode === "full_access" ? "full_access" : "ask";
        (document.interaction as Record<string, unknown>).auto_approve_ask = mode === "auto_approve";
        approval.strategy = mode === "auto_approve" ? "model" : "interactive";
        if (mode === "auto_approve" && (approval.model_kind ?? "chat") === "chat" && !String(approval.chat_model_id ?? "").trim()) {
          approval.chat_model_id = "fast";
        }
        document.approval = approval;
        writeLive("tool_permissions", document);
        return permissionView(document);
      }
      case "upsert_permission_rule":
      case "delete_permission_rule": {
        const document = permissionDocument();
        const rules = ((document.policy as Record<string, unknown>).rules ?? []) as unknown[];
        const index = typeof payload.index === "number" ? payload.index : null;
        if (index !== null && (index >= rules.length || (payload.expected && !sameRule(rules[index], payload.expected)))) {
          throw new Error("The rule list changed while it was being edited; reload");
        }
        if (action === "delete_permission_rule") {
          if (index === null) throw new Error("A rule index is required");
          rules.splice(index, 1);
        } else {
          let position = index;
          if (index === null) {
            rules.push(checkedRule(payload.rule));
            position = rules.length - 1;
          } else if (payload.rule) {
            rules[index] = checkedRule(payload.rule);
          }
          if (typeof payload.moveTo === "number" && position !== null) {
            const [moved] = rules.splice(position, 1);
            rules.splice(payload.moveTo, 0, moved);
          }
        }
        (document.policy as Record<string, unknown>).rules = rules;
        writeLive("tool_permissions", document);
        return permissionView(document);
      }
      case "set_approval_settings": {
        const document = permissionDocument();
        const approval: Record<string, unknown> = {
          strategy: "interactive",
          model_kind: "chat",
          chat_model_id: "fast",
          timeout_ms: 30000,
          on_ask: "user",
          on_error: "ask",
          ...((document.approval ?? {}) as Record<string, unknown>),
        };
        if (payload.modelKind !== undefined) approval.model_kind = payload.modelKind;
        if (payload.chatModelId !== undefined) approval.chat_model_id = String(payload.chatModelId).trim();
        const timeout =
          typeof payload.timeoutMs === "number"
            ? payload.timeoutMs
            : typeof payload.timeoutSeconds === "number"
              ? payload.timeoutSeconds * 1000
              : undefined;
        if (timeout !== undefined) approval.timeout_ms = Math.min(300000, Math.max(1, timeout));
        if (payload.onAsk !== undefined) approval.on_ask = payload.onAsk;
        if (payload.onError !== undefined) approval.on_error = payload.onError;
        if (approval.strategy === "model" && approval.model_kind === "chat" && !approval.chat_model_id) {
          throw new Error("chat approval strategy requires a chat_model_id");
        }
        document.approval = approval;
        writeLive("tool_permissions", document);
        return permissionView(document);
      }
      case "set_web_search_provider": {
        const document = JSON.parse(JSON.stringify(readLive("ai.web_search") ?? {})) as Record<string, unknown>;
        const providers = { ...((document.providers ?? {}) as Record<string, Record<string, unknown>>) };
        if (payload.provider !== undefined) {
          const provider = String(payload.provider);
          if (!["exa_mcp_free", "exa_search_api", "tavily", "deepseek", "keenable", "openbitfun_search_http"].includes(provider)) {
            throw new Error(`Unknown web search provider '${provider}'`);
          }
          document.provider = provider;
        }
        if (payload.credentialId !== undefined) {
          const target = String(payload.credentialProvider ?? document.provider ?? "");
          if (target === "openbitfun_search_http") {
            const http = { ...(providers.openbitfun_search_http ?? {}) };
            http.auth = { ...((http.auth ?? {}) as object), credentialId: payload.credentialId };
            providers.openbitfun_search_http = http;
          } else {
            providers[target] = { ...(providers[target] ?? {}), credentialId: payload.credentialId };
          }
        }
        const http = { ...(providers.openbitfun_search_http ?? {}) } as Record<string, unknown>;
        const auth: Record<string, unknown> = { mode: "none", ...((http.auth ?? {}) as Record<string, unknown>) };
        if (payload.endpoint !== undefined) http.endpoint = String(payload.endpoint).trim();
        if (payload.authMode !== undefined) auth.mode = payload.authMode;
        if (payload.authCredentialId !== undefined) auth.credentialId = payload.authCredentialId;
        if (payload.authHeaderName !== undefined) auth.headerName = payload.authHeaderName;
        if (payload.endpoint !== undefined || payload.authMode !== undefined || payload.authCredentialId !== undefined || payload.authHeaderName !== undefined) {
          http.auth = auth;
          providers.openbitfun_search_http = http;
        }
        document.providers = providers;
        writeLive("ai.web_search", document);
        return document;
      }
      case "set_acp_client_permission_mode": {
        const clientId = String(payload.clientId ?? "");
        const mode = String(payload.permissionMode ?? "");
        if (!["ask", "allow_once", "reject_once"].includes(mode)) throw new Error(`Unknown ACP permission mode '${mode}'`);
        if (!acpRows.some(row => row.id === clientId)) throw new Error(`ACP client is not configured: ${clientId}`);
        acpRows = acpRows.map(row => (row.id === clientId ? { ...row, permissionMode: mode } : row));
        return acpRows;
      }
    }
    throw new Error(`the simulated backend has no answer for ${action}`);
  }

  function answer(action: string, request: unknown, positional = false): unknown {
    const payload = (request ?? {}) as Record<string, unknown>;
    switch (action) {
      // account records (wave24-replica)
      case "device_records_overview": {
        if (!options.accountRecords) throw new Error(`Command ${action} not found`);
        return JSON.parse(JSON.stringify(options.accountRecords));
      }
      // account settings sync (wave 21)
      case "account_settings_sync_status":
      case "account_settings_sync_set": {
        if (accountSyncStatus === null) throw new Error(`Command ${action} not found`);
        if (action === "account_settings_sync_set") {
          const enabled = payload.enabled === true;
          accountSyncStatus = { ...accountSyncStatus, enabled, phase: enabled ? "synced" : "off", active: enabled };
        }
        return { ...accountSyncStatus };
      }
      // settings mutations (wave 3 config)
      case "ai_model_upsert":
      case "ai_model_delete":
      case "resolve_ai_model_request_url":
      case "set_task_model":
      case "set_permission_mode":
      case "upsert_permission_rule":
      case "delete_permission_rule":
      case "set_approval_settings":
      case "set_web_search_provider":
      case "set_acp_client_permission_mode":
      case "get_settings_schema":
      // permission page view (wave 4)
      case "get_permission_settings":
        return answerSettingsMutation(action, payload);
      // view models (wave 4)
      case "get_workspace_navigator":
        if (options.workspaceNavigator === false) {
          throw new Error("Command not found: get_workspace_navigator");
        }
        return projectWorkspaceNavigator(
          answer("get_opened_workspaces", {}),
          answer("get_recent_workspaces", {}),
          currentWorkspaceId,
          typeof payload.selectedId === "string" ? payload.selectedId : null,
        );
      case "get_opened_workspaces":
        return openedWorkspaces.map(record => ({ ...record }));
      case "get_recent_workspaces":
        return [
          { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
          { id: "workspace-2", name: "remote-host", rootPath: "/srv/app", workspaceKind: "remote" },
          ...recentOnlyWorkspaces.map(record => ({ ...record })),
        ];
      case "get_current_workspace":
        return openedWorkspaces.find(record => record.id === currentWorkspaceId) ?? null;
      case "set_active_workspace": {
        const id = String(payload.workspaceId ?? "");
        if (!openedWorkspaces.some(record => record.id === id)) {
          throw new Error(`Workspace is not opened: ${id}`);
        }
        currentWorkspaceId = id;
        return null;
      }
      case "open_workspace": {
        // Reopening a recent workspace names it by id, as the desktop's switch does.
        const id = String(payload.workspaceId ?? "");
        const record = [
          ...recentOnlyWorkspaces,
          { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
          { id: "workspace-2", name: "remote-host", rootPath: "/srv/app", workspaceKind: "remote" },
        ].find(item => item.id === id && !openedWorkspaces.some(open => open.id === id));
        if (!record) throw new Error(`the simulated backend cannot open ${id || String(payload.path ?? "")}`);
        recentOnlyWorkspaces = recentOnlyWorkspaces.filter(item => item.id !== id);
        openedWorkspaces = [record, ...openedWorkspaces];
        currentWorkspaceId = id;
        return { ...record };
      }
      case "remove_recent_workspace": {
        const id = String(payload.workspaceId ?? "");
        recentOnlyWorkspaces = recentOnlyWorkspaces.filter(item => item.id !== id);
        return null;
      }
      case "update_workspace_info": {
        const id = String(payload.workspaceId ?? "");
        const name = typeof payload.name === "string" ? payload.name : undefined;
        openedWorkspaces = openedWorkspaces.map(item => (item.id === id && name ? { ...item, name } : item));
        const record = openedWorkspaces.find(item => item.id === id);
        if (!record) throw new Error(`Workspace not found: ${id}`);
        return { ...record };
      }
      case "list_persisted_sessions_page": {
        const reqWorkspaceId = String((request as { workspace_id?: string })?.workspace_id ?? "workspace-1");
        const scoped = sessions.filter(
          session => !session.workspaceId || String(session.workspaceId) === reqWorkspaceId,
        );
        return {
          // Rows belong to the workspace the list was asked for, as on the host.
          sessions: scoped.map(session => ({
            ...session,
            workspaceId: String(session.workspaceId ?? reqWorkspaceId),
          })),
          totalTopLevelCount: scoped.length,
          loadedTopLevelCount: scoped.length,
          hasMore: false,
          // The host derives each row's read state from its unread receipt.
          activities: scoped.map(session => ({
            sessionId: session.sessionId,
            execution: runningTurnsBySession[String(session.sessionId)] ? "running" : "idle",
            pendingApprovals: 0,
            pendingQuestions: 0,
            unread: typeof session.unreadCompletion === "string" && session.unreadCompletion !== "",
            failed: session.unreadCompletion === "error",
          })),
        };
      }
      case "load_session_turns": {
        const sessionId = (request as { session_id?: string })?.session_id ?? "";
        return TURNS[sessionId] ?? [];
      }
      case "get_configs":
        return options.configs ?? { appearance: { theme: "dark" }, editor: { fontSize: 13 } };
      case "set_config": {
        const path = String(payload.path ?? "");
        // The host's memory window rule applies to leaf writes too (wave 3 config).
        if (path === "memories.max_unused_days" || path === "memories.max_rollout_age_days") {
          const memories = { ...((liveConfigs.memories ?? {}) as Record<string, unknown>) };
          memories[path.slice("memories.".length)] = payload.value;
          if (Number(memories.max_rollout_age_days ?? 10) > Number(memories.max_unused_days ?? 30)) {
            throw new Error("Failed to set config: Memory rollout age must not exceed unused-memory retention");
          }
        }
        settingsWrites.push({ path, value: payload.value });
        {
          // Store the value where `get_config` will find it: the flat key when
          // the fixture keeps one, otherwise inside the document that holds it.
          const value = JSON.parse(JSON.stringify(payload.value ?? null)) as unknown;
          if (path in liveConfigs) {
            liveConfigs[path] = value;
          } else {
            const segments = path.split(".");
            let stored = false;
            for (let cut = segments.length - 1; cut > 0 && !stored; cut -= 1) {
              const parent = segments.slice(0, cut).join(".");
              const document = liveConfigs[parent];
              if (!document || typeof document !== "object" || Array.isArray(document)) continue;
              let node = document as Record<string, unknown>;
              for (const segment of segments.slice(cut, -1)) {
                const child = node[segment];
                if (!child || typeof child !== "object" || Array.isArray(child)) node[segment] = {};
                node = node[segment] as Record<string, unknown>;
              }
              node[segments[segments.length - 1]] = value;
              stored = true;
            }
            if (!stored) liveConfigs[path] = value;
          }
        }
        if (path === "app" && payload.value && typeof payload.value === "object") {
          const lang = (payload.value as Record<string, unknown>).language;
          if (typeof lang === "string" && lang.trim()) currentLanguage = lang;
        } else if (path === "app.language" && typeof payload.value === "string" && payload.value.trim()) {
          currentLanguage = payload.value;
        }
        return null;
      }
      case "i18n_get_current_language":
        return currentLanguage;
      case "i18n_set_language": {
        const lang = String(payload.language ?? "").trim();
        if (lang) currentLanguage = lang;
        return `Language switched to: ${currentLanguage}`;
      }
      case "get_web_search_credential_status": {
        const provider = String(payload.provider ?? "");
        return { provider, configured: credentialConfigured };
      }
      case "save_web_search_credential": {
        const provider = String(payload.provider ?? "");
        credentialWrites.push({ provider, secret: String(payload.secret ?? "") });
        credentialConfigured = true;
        return { provider, configured: true };
      }
      case "clear_web_search_credential": {
        const provider = String(payload.provider ?? "");
        clearedCredentials.push(provider);
        credentialConfigured = false;
        return { provider, configured: false };
      }
      case "get_decision_model_credential_status":
        return { configured: decisionKeyConfigured };
      case "save_decision_model_credential": {
        decisionKeyWrites.push(String(payload.secret ?? ""));
        decisionKeyConfigured = true;
        return { configured: true };
      }
      case "clear_decision_model_credential": {
        decisionKeyCleared += 1;
        decisionKeyConfigured = false;
        return { configured: false };
      }
      case "get_config": {
        const path = (request as { path?: string })?.path ?? "";
        if (path === "font" && options.fontPreference !== undefined) {
          if (options.fontPreference === null) {
            throw new Error(`Failed to get config: Not found: Config path 'font' not found`);
          }
          return options.fontPreference;
        }
        const configs = liveConfigs;
        if (options.absentConfigs?.includes(path)) {
          throw new Error(`Failed to get config: Not found: Config path '${path}' not found`);
        }
        if (!(path in configs)) {
          // The host resolves a dotted leaf inside the document that holds it
          // (`editor.font_size` inside `editor`), so the fixture does too.
          const segments = path.split(".");
          for (let cut = segments.length - 1; cut > 0; cut -= 1) {
            const parent = segments.slice(0, cut).join(".");
            if (!(parent in configs)) continue;
            let node: unknown = configs[parent];
            for (const segment of segments.slice(cut)) {
              node =
                node && typeof node === "object" && !Array.isArray(node)
                  ? (node as Record<string, unknown>)[segment]
                  : undefined;
            }
            if (node !== undefined) return node;
            break;
          }
          throw new Error(`Config path '${path}' not found`);
        }
        return configs[path];
      }
      case "browser_control_list_browsers":
        // Positional with no arguments on the host; the desktop's own list.
        return {
          options: [
            { value: "default", label: "Default browser", installed: true },
            { value: "chrome", label: "Google Chrome", installed: true },
            { value: "edge", label: "Microsoft Edge", installed: false },
          ],
        };
      case "get_file_tree":
        return files;
      case "explorer_get_children": {
        const path = String(payload.path ?? "");
        const entries = fs.get(path);
        if (!entries) throw new Error(`Directory does not exist: ${path}`);
        return [...entries].sort((left, right) => {
          if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      }
      case "create_file":
      case "create_directory": {
        const path = String(payload.path ?? "");
        const directory = parentDirectory(path);
        const list = fs.get(directory);
        if (!list) throw new Error(`Directory does not exist: ${directory}`);
        const isDirectory = action === "create_directory";
        list.push({ name: entryName(path), path, isDirectory });
        if (isDirectory) fs.set(path, []);
        return null;
      }
      case "delete_file":
      case "delete_directory": {
        const path = String(payload.path ?? "");
        const directory = parentDirectory(path);
        const list = fs.get(directory);
        if (list) fs.set(directory, list.filter(entry => entry.path !== path));
        fs.delete(path);
        return null;
      }
      case "rename_file": {
        const oldPath = String(payload.oldPath ?? "");
        const newPath = String(payload.newPath ?? "");
        const directory = parentDirectory(oldPath);
        const list = fs.get(directory) ?? [];
        for (const entry of list) {
          if (entry.path !== oldPath) continue;
          entry.path = newPath;
          entry.name = entryName(newPath);
        }
        const moved = fs.get(oldPath);
        if (moved) {
          fs.delete(oldPath);
          fs.set(newPath, moved);
        }
        return null;
      }
      case "search_files": {
        if (options.fileSearch === false) {
          throw new Error("Command not found: search_files");
        }
        const pattern = String(payload.pattern ?? "").toLowerCase();
        const matches: VirtualEntry[] = [];
        for (const entries of fs.values()) {
          for (const entry of entries) {
            if (entry.name.toLowerCase().includes(pattern)) matches.push(entry);
          }
        }
        if (payload.searchContent === true) {
          // Content mode reports one row per matching line, with its preview.
          const hits: Record<string, unknown>[] = [];
          for (const [path, body] of Object.entries(content)) {
            body.split("\n").forEach((line, index) => {
              if (!line.toLowerCase().includes(pattern)) return;
              hits.push({
                path,
                name: entryName(path),
                is_directory: false,
                match_type: "Content",
                line_number: index + 1,
                preview_inside: line,
              });
            });
          }
          return hits;
        }
        return matches.map(entry => ({ path: entry.path, name: entry.name }));
      }
      case "create_session": {
        const assistant = isAssistantWorkspace(payload.workspaceId, payload.workspacePath);
        const agentType = assistant ? "Claw" : String(payload.agentType ?? "Standard");
        const sessionId = createdSessionSeq === 0 ? "session-new" : `session-new-${createdSessionSeq + 1}`;
        createdSessionSeq += 1;
        // The new session is in the catalogue the surface reloads, with no turn yet.
        sessions = [
          {
            sessionId,
            sessionName: String(payload.sessionName ?? "New session"),
            lastUpdated: 1763100000000 + createdSessionSeq,
            messageCount: 0,
            agentType,
            ...(payload.workspaceId ? { workspaceId: String(payload.workspaceId) } : {}),
          },
          ...sessions,
        ];
        return { sessionId, sessionName: String(payload.sessionName ?? "New session"), agentType };
      }
      case "get_available_modes": {
        if (options.agentModes === null) {
          throw new Error("Command not found: get_available_modes");
        }
        return options.agentModes ?? DEFAULT_AGENT_MODES;
      }
      case "update_session_mode": {
        // The host rebinds the session and reports the new binding on the next read.
        const sessionId = String(payload.sessionId ?? "");
        const modeId = String(payload.modeId ?? "");
        if (!modeId.trim()) throw new Error("session mode must not be empty");
        // The host refuses to rebind a session that already ran a turn, and
        // assistant workspaces / Claw sessions accept only Claw.
        const bound = sessions.find(row => row.sessionId === sessionId);
        const assistant = isAssistantWorkspace(payload.workspaceId ?? bound?.workspaceId, payload.workspacePath);
        if (
          (assistant || String(bound?.agentType ?? "").toLowerCase() === "claw") &&
          modeId.trim().toLowerCase() !== "claw"
        ) {
          throw new Error(`session_mode_locked: assistant workspaces only support Claw; cannot switch to ${modeId}`);
        }
        if (bound && Number(bound.messageCount ?? 0) > 0
          && String(bound.agentType ?? "Standard").toLowerCase() !== modeId.toLowerCase()) {
          throw new Error(`session_mode_locked: this session already started as ${String(bound.agentType ?? "Standard")}`);
        }
        const canonicalMode = modeId.trim().toLowerCase() === "claw" ? "Claw" : modeId;
        sessionModeWrites.push({
          sessionId,
          modeId: canonicalMode,
          ...(payload.workspaceId ? { workspaceId: String(payload.workspaceId) } : {}),
        });
        sessions = sessions.map(row => (row.sessionId === sessionId ? { ...row, agentType: canonicalMode } : row));
        // The host records the explicit pick as the next default, as the desktop does (excluding Claw).
        if (payload.includeInternal !== true && !assistant && canonicalMode.toLowerCase() !== "claw") {
          liveConfigs["app.flow_chat"] = {
            ...((liveConfigs["app.flow_chat"] ?? {}) as Record<string, unknown>),
            last_mode_id: canonicalMode,
          };
        }
        return null;
      }
      case "copy_session": {
        // The copy shows up in the next catalog read, as the host would list it.
        sessions = [
          { sessionId: "session-copy", sessionName: "NSH skeleton (copy)", lastUpdated: 1763100000000, messageCount: 4 },
          ...sessions,
        ];
        // The real host answers `SessionLineageCopyResult` in camelCase.
        return { sessionId: "session-copy", sessionName: "NSH skeleton (copy)", agentType: "Standard" };
      }
      case "fork_session": {
        const sourceTurn = String((payload as { source_turn_id?: string }).source_turn_id ?? "");
        sessions = [
          { sessionId: "session-fork", sessionName: `Fork of ${sourceTurn}`, lastUpdated: 1763100000000, messageCount: 2 },
          ...sessions,
        ];
        return { sessionId: "session-fork", sessionName: `Fork of ${sourceTurn}`, agentType: "Standard" };
      }
      case "start_dialog_turn":
        return { success: true, message: "started" };
      case "interrupt_dialog_turn":
      case "cancel_dialog_turn":
        return null;
      case "steer_dialog_turn":
        return { success: true, steeringId: "steering-1" };
      case "manage_dialog_queue":
        return options.hostQueue ? answerHostQueue(request) : unsupported("manage_dialog_queue");
      // session policy (wave 3): the host decides steer / queue / start.
      case "submit_user_message": {
        const sessionId = String(payload.sessionId ?? "");
        const text = String(payload.text ?? "");
        if (!sessionId || (!text.trim() && !(payload.attachments as unknown[] | undefined)?.length)) {
          throw new Error("A message or an attachment is required");
        }
        const running = runningTurnsBySession[sessionId];
        const stored = liveConfigs["app.flow_chat.send_during_turn"];
        const policy = String(payload.sendDuringTurn ?? stored ?? "queue");
        const workspaceId = payload.workspaceId ? String(payload.workspaceId) : undefined;
        if (running && policy !== "queue") {
          userMessages.push({ sessionId, text, outcome: "steered", turnId: running, ...(workspaceId ? { workspaceId } : {}) });
          return { outcome: "steered", turnId: running, steeringId: "steering-1" };
        }
        const turnId = String(payload.turnId ?? `turn-submitted-${++submittedTurns}`);
        if (running) {
          // The real host admits it through its own queue, so every panel lists it.
          hostQueue.push({ sessionId, turnId, content: text, status: "queued" });
          queueRevision += 1;
          userMessages.push({ sessionId, text, outcome: "queued", turnId, ...(workspaceId ? { workspaceId } : {}) });
          return { outcome: "queued", turnId, queueItemId: turnId };
        }
        // A test marks the turn running itself (`setRunningTurn`) when it emits the
        // host's turn-started event, so the fixture never guesses when it settles.
        userMessages.push({ sessionId, text, outcome: "started", turnId, ...(workspaceId ? { workspaceId } : {}) });
        return { outcome: "started", turnId };
      }
      case "stop_dialog_turn": {
        const sessionId = String(payload.sessionId ?? "");
        const turnId = String(payload.dialogTurnId ?? runningTurnsBySession[sessionId] ?? "");
        if (!turnId) throw new Error(`No running turn to stop for session: ${sessionId}`);
        delete runningTurnsBySession[sessionId];
        return { turnId, method: "interrupted" };
      }
      case "get_session_mode_catalog": {
        if (options.agentModes === null) throw new Error("Command not found: get_session_mode_catalog");
        return answerModeCatalog(payload);
      }
      case "list_session_commands": {
        const sessionId = String(payload.sessionId ?? "");
        const busy = Boolean(runningTurnsBySession[sessionId]);
        return [
          { id: "compact", command: "/compact", labelKey: "chat.slash.compact", description: "Summarize the conversation to free context", idleOnly: true, available: !busy },
          { id: "init", command: "/init", labelKey: "chat.slash.init", description: "Generate or update AGENTS.md for this workspace", idleOnly: true, available: !busy },
          { id: "reload", command: "/reload", labelKey: "chat.slash.reload", description: "Reload skills and project instructions", idleOnly: false, available: true, args: ["skills", "instructions"] },
        ];
      }
      case "execute_session_command": {
        const id = String(payload.id ?? "");
        const arg = payload.arg === undefined ? undefined : String(payload.arg);
        if (id === "reload" && arg !== undefined && !["skills", "instructions"].includes(arg)) {
          throw new Error(`unknown variant \`${arg}\``);
        }
        const outcome = { compact: "compaction_started", init: "init_started", reload: "reloaded" }[id];
        if (!outcome) throw new Error(`unknown_session_command: ${id}`);
        return { id, outcome, ...(id === "reload" ? {} : { turnId: `${id}-turn` }) };
      }
      case "mark_session_seen": {
        const sessionId = String(payload.sessionId ?? "");
        const seenThroughMs = typeof payload.seenThroughMs === "number" ? payload.seenThroughMs : undefined;
        seenMarks.push({ sessionId, ...(seenThroughMs !== undefined ? { seenThroughMs } : {}) });
        let changed = false;
        sessions = sessions.map(row => {
          if (row.sessionId !== sessionId || !row.unreadCompletion) return row;
          changed = true;
          const next = { ...row };
          delete next.unreadCompletion;
          return next;
        });
        return { changed };
      }
      case "get_model_pools":
      case "save_model_pool":
      case "delete_model_pool":
      case "get_model_pool_status":
        return answerPools(action, request);
      case "get_mcp_servers":
      case "load_mcp_json_config":
      case "save_mcp_json_config":
      case "start_mcp_server":
      case "stop_mcp_server":
      case "restart_mcp_server":
      case "delete_mcp_server":
      case "get_mcp_server_status":
      case "start_mcp_remote_oauth":
      case "get_mcp_remote_oauth_session":
      case "cancel_mcp_remote_oauth":
      case "update_mcp_remote_auth":
      case "clear_mcp_remote_auth":
      case "list_mcp_resources":
      case "read_mcp_resource":
        return answerMcp(action, request, positional);
      case "dispatch_list_targets":
        return [
          { kind: "local", displayName: "Local" },
          {
            kind: "ssh",
            connectionId: "conn-1",
            displayName: "build-box",
            description: "/srv/api",
            online: true,
          },
          { kind: "ssh", connectionId: "conn-2", displayName: "old-box", online: false },
        ];
      case "dispatch_list_jobs":
        // The controller's own index: the state is the last observed one.
        return [options.dispatchJob].filter(Boolean);
      case "dispatch_probe_target": {
        // conn-1 runs a current CLI; any other target has none installed.
        const probeTarget = (payload.target ?? {}) as Record<string, unknown>;
        if (probeTarget.connectionId !== "conn-1") {
          return {
            cliInstalled: false,
            os: "linux",
            arch: "x86_64",
            installSupported: true,
            // The controller host's readiness verdict (wave 3 config).
            ready: false,
            reason: "cli_missing",
            missingCapabilities: [],
            expectedProtocolVersion: 6,
          };
        }
        return {
          ready: true,
          missingCapabilities: [],
          expectedProtocolVersion: 6,
          cliInstalled: true,
          os: "linux",
          arch: "x86_64",
          installSupported: true,
          protocol: {
            productId: "openbitfun",
            dataNamespace: "openbitfun",
            protocolVersion: 6,
            cliVersion: "0.0.0-test",
            os: "linux",
            arch: "x86_64",
            capabilities: [
              "product_identity", "persistent_jobs", "cursor_events", "detached_worker",
              "frontend_event_projection", "append_message", "event_log_completeness",
              "approval_auto", "approval_reject_and_report", "approval_remote",
              "workspace_serialization", "workspace_git_worktree", "workspace_git_bundle_upload",
              "workspace_git_sync", "dispatch_worker_cli_profile", "per_turn_options",
              "session_query", "inline_attachments", "reasoning_presets",
            ],
            modelConfigured: true,
            availableModels: ["claude-sonnet", "gpt-5-mini"],
            defaultModel: "claude-sonnet",
          },
        };
      }
      case "dispatch_submit":
        submitted = request;
        return { jobId: payload.jobId, sessionId: payload.sessionId, state: "queued" };
      case "dispatch_cancel":
        cancelledJobs.push(String(payload.jobId));
        return { cancelled: true };
      case "dispatch_status":
        return answerDispatchStatus(payload);
      case "dispatch_answer": {
        const requestId = String(payload.requestId ?? "");
        dispatchAnswers.push({
          jobId: String(payload.jobId ?? ""),
          requestId,
          reply: String(payload.reply ?? ""),
        });
        // Answering resolves the mailbox entry, as the target does.
        if (options.dispatchPermissions) {
          options.dispatchPermissions = options.dispatchPermissions.filter(
            request => String(request.requestId ?? "") !== requestId,
          );
        }
        return { resolved: true };
      }
      case "dispatch_append":
        dispatchAppends.push({ jobId: String(payload.jobId ?? ""), content: String(payload.content ?? "") });
        return { accepted: true, messageId: String(payload.messageId ?? "") };
      case "dispatch_continue":
        dispatchContinues.push({
          jobId: String(payload.jobId ?? ""),
          turnId: String(payload.turnId ?? ""),
          prompt: String(payload.prompt ?? ""),
        });
        return {
          accepted: true,
          jobId: String(payload.jobId ?? ""),
          sessionId: "session-1",
          turnId: String(payload.turnId ?? ""),
          state: "running",
        };
      case "dispatch_sync_result":
        dispatchSyncs.push(String(payload.jobId ?? ""));
        return { jobId: String(payload.jobId ?? ""), synced: true, headCommit: "0123456789abcdef" };
      case "get_acp_clients":
        if (options.acpClients === null) throw new Error("ACP client service not initialized");
        return acpRows;
      case "probe_acp_client_requirements":
        return options.acpProbes ?? DEFAULT_ACP_PROBES;
      case "load_acp_json_config":
        return acpJsonText;
      case "save_acp_json_config": {
        // Positional: the text arrives at the top level, not inside `request`.
        if (!positional) throw new Error("save_acp_json_config takes positional arguments");
        const text = String(payload.jsonConfig ?? "");
        acpSaves.push(text);
        acpJsonText = text;
        return null;
      }
      case "install_acp_client_cli":
        acpInstalls.push(String(payload.clientId ?? ""));
        return null;
      case "stop_acp_client":
        acpRows = acpRows.map(row =>
          row.id === String(payload.clientId ?? "") ? { ...row, status: "stopped" } : row,
        );
        return null;
      // view models (wave 4)
      case "get_personal_overview":
        if (options.personalOverview === false) {
          throw new Error("Command not found: get_personal_overview");
        }
        return composePersonalOverview((command, request, raw) => answer(command, request, raw));
      case "get_token_usage_activity": {
        usageRequests.push({ ...payload, command: "get_token_usage_activity" });
        if (options.usage === null) {
          throw new Error(
            "token_usage_statistics_unsupported: The connected Peer host does not support usage statistics",
          );
        }
        if (options.usageActivityCommand === false) {
          throw new Error("Command not found: get_token_usage_activity");
        }
        if (options.usageActivity === null) {
          throw new Error("the host answered the range but not the activity window");
        }
        return options.usageActivity ?? fixtureUsageActivity();
      }
      case "get_token_usage_statistics": {
        usageRequests.push(payload);
        if (options.usage === null) {
          // An older Peer host refuses the command with its own marker.
          throw new Error(
            "token_usage_statistics_unsupported: The connected Peer host does not support usage statistics",
          );
        }
        return options.usage ?? DEFAULT_USAGE;
      }
      case "get_session_interaction_mailbox": {
        if (pendingQuestions === null) throw new Error("Command not found: get_session_interaction_mailbox");
        const sessionId = String(payload.sessionId ?? "");
        return {
          sessionId,
          userQuestions: { revision: 1, questions: pendingQuestions },
          permissions: { requests: [] },
        };
      }
      case "start_user_question_interaction": {
        questionStarts.push({
          sessionId: String(payload.sessionId ?? ""),
          toolId: String(payload.toolId ?? ""),
        });
        return null;
      }
      case "submit_user_answers": {
        // Positional: tool id and answers are separate arguments, not one request.
        if (!positional) throw new Error("submit_user_answers takes positional arguments");
        const toolId = String(payload.toolId ?? "");
        const answers = (payload.answers ?? {}) as Record<string, unknown>;
        userAnswers.push({ toolId, answers, sessionId: String(payload.sessionId ?? "") });
        // An answered question leaves the mailbox, as the Runtime drops its channel.
        pendingQuestions = (pendingQuestions ?? []).filter(entry => String(entry.toolId) !== toolId);
        return null;
      }
      case "get_runtime_logging_info":
        if (runtimeLogging === null) throw new Error("Command not found: get_runtime_logging_info");
        return runtimeLogging ?? DEFAULT_RUNTIME_LOGGING;
      case "reveal_in_explorer":
        // Structured request: the path is the only field.
        reveals.push(String(payload.path ?? ""));
        return null;
      case "export_diagnostics_bundle":
        // The surface reveals the returned path itself, so it lands in `reveals`
        // through `reveal_in_explorer` rather than from here.
        return { bundlePath: "/tmp/openbitfun/logs/diagnostics/openbitfun-diagnostics.zip" };
      case "subscribe_permission_requests":
        return null;
      case "list_pending_permission_requests":
        return [
          {
            requestId: "perm-1",
            action: "run_command",
            resources: ["cargo test -p openbitfun-desktop"],
            sessionId: "session-1",
            agentId: "standard",
          },
        ];
      case "respond_permission":
        return null;
      case "archive_session":
      case "unarchive_session":
      case "delete_persisted_session":
      case "account_update_device_alias":
        return null;
      // P-UI parity (wave 17): session and workspace row actions on any device.
      case "update_session_title":
        return String(payload.title ?? "");
      case "delete_all_archived_sessions":
        return 1;
      case "close_workspace":
      case "reset_assistant_workspace":
      case "delete_assistant_workspace":
        return null;
      // The desktop window's own commands (tray, close, notifications, reveal),
      // which a native window answers with nothing to report.
      case "initialize_tray_after_startup":
      case "set_tray_unread_count":
      case "minimize_to_tray":
      case "quit_app":
      case "hide_main_window_after_close_request":
      case "send_system_notification":
      case "reveal_in_explorer":
      case "reveal_session_storage_directory":
      case "toggle_main_window_fullscreen":
        return null;
      case "get_pending_update":
        return null;
      // Native shell channel (wave 4 native): the backend records the ops and settles requests.
      case "host_shell_attach":
        return { ops: Array.isArray(payload.ops) ? [...(payload.ops as string[])].sort() : [] };
      case "host_shell_respond":
        return null;
      // A Space opened in its own window: the desktop answers with the instance/view ticket.
      case "miniapp_presentation":
        if (payload.operation === "open") {
          return {
            instance: { instanceId: `instance-${String(payload.appId ?? "")}`, appId: payload.appId },
            view: { viewId: "view-1", kind: payload.kind },
          };
        }
        return { hostEpoch: 1, revision: 1, instances: [] };
      case "export_session_transcript":
        return {
          sessionId: String(payload.session_id ?? ""),
          transcriptPath: `/tmp/exports/${String(payload.session_id ?? "session")}.md`,
          generatedAt: 1763200000000,
        };
      case "save_session_metadata": {
        // The host deserializes a whole `SessionMetadata` before it merges `fields`.
        const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
        for (const field of ["sessionId", "sessionName", "agentType", "modelName", "createdAt", "lastActiveAt", "turnCount", "messageCount", "toolCallCount", "status"]) {
          if (!(field in metadata)) throw new Error(`missing field \`${field}\``);
        }
        return null;
      }
      case "get_session_permission_mode":
      case "update_session_permission_mode":
      case "update_active_turn_permission_mode": {
        const sessionId = String(payload.sessionId ?? "");
        if (action !== "get_session_permission_mode") {
          const mode = typeof payload.mode === "string" ? (payload.mode === "auto" ? "auto_approve" : payload.mode) : null;
          if (action === "update_active_turn_permission_mode") turnPermissionModes[sessionId] = mode;
          else sessionPermissionModes[sessionId] = mode;
        }
        return {
          mode: sessionPermissionModes[sessionId] ?? null,
          turnMode: turnPermissionModes[sessionId] ?? null,
          activeTurnId: payload.turnId ?? null,
        };
      }
      case "compact_session":
        return { success: true };
      case "run_init_agents_md":
        return { success: true, message: "started" };
      case "reload_session_context":
        if (!["all", "skills", "instructions"].includes(String(payload.target ?? ""))) {
          throw new Error(`unknown variant \`${String(payload.target)}\``);
        }
        return null;
      case "rollback_session_to_turn":
        return { status: "completed", retiredTurnIds: [String(payload.targetTurnId ?? "")], restoredFiles: [] };
      case "get_local_models_dev_catalogs":
        if (modelCatalogFixture === null) throw new Error("Command not found: get_local_models_dev_catalogs");
        return modelCatalogFixture;
      case "search_session_content": {
        if (options.sessionSearch === null) throw new Error("Command not found: search_session_content");
        const query = String(payload.query ?? "").toLowerCase();
        const hits = (options.sessionSearch ?? DEFAULT_SESSION_HITS).filter(hit =>
          `${String(hit.sessionTitle ?? "")} ${String(hit.snippet ?? "")}`.toLowerCase().includes(query),
        );
        return { hits, truncated: false };
      }
      case "get_ai_model_catalog":
        return {
          version: 1,
          models: [
            {
              id: "cfg-primary",
              name: "Primary model",
              provider: "openai",
              // The same model `ai.models` stores, because the reasoning catalog is
              // projected from that entry's endpoint and reasoning block.
              model_name: "gpt-4.1-mini",
              enabled: true,
              capabilities: ["chat", "tool_call"],
            },
            {
              id: "cfg-fast",
              name: "Fast model",
              provider: "openai",
              model_name: "fast-small",
              enabled: true,
              capabilities: ["chat"],
            },
            {
              id: "cfg-image",
              name: "Image model",
              provider: "openai",
              model_name: "image-only",
              enabled: true,
              capabilities: ["image_generation"],
            },
          ],
          default_models: { primary: "gpt-4.1-mini" },
        };
      case "update_session_model": {
        // The host validates the pair, so a preset that arrives without its model
        // is refused there; here the write is only remembered for the next read.
        const sid = String(payload.sessionId ?? "");
        const nextModel = typeof payload.modelName === "string" ? payload.modelName.trim() : "";
        if (sid && nextModel) {
          sessions = sessions.map(item =>
            String(item.sessionId) === sid ? { ...item, modelName: nextModel } : item,
          );
        }
        if (Object.prototype.hasOwnProperty.call(payload, "reasoningPreset")) {
          sessionReasoningPreset = (payload.reasoningPreset as string | null) ?? null;
        }
        return null;
      }
      case "update_session_model_target": {
        const sid = String(payload.sessionId ?? "");
        const selection = payload.selection as { kind?: string; model_ref?: string; pool_id?: string } | undefined;
        const nextModel =
          selection?.kind === "model" && typeof selection.model_ref === "string"
            ? selection.model_ref.trim()
            : "";
        if (sid && nextModel) {
          sessions = sessions.map(item =>
            String(item.sessionId) === sid ? { ...item, modelName: nextModel } : item,
          );
        }
        return {
          sessionId: sid,
          selection: selection ?? { kind: "model", model_ref: "gpt-4.1-mini" },
          ...(sessionReasoningPreset === undefined ? {} : { reasoningPreset: sessionReasoningPreset }),
        };
      }
      case "get_session_model_target": {
        const sid = String(payload.sessionId ?? "");
        const row = sessions.find(item => String(item.sessionId) === sid);
        const modelRef =
          typeof row?.modelName === "string" && row.modelName.trim() ? row.modelName.trim() : "gpt-4.1-mini";
        return {
          sessionId: sid,
          selection: { kind: "model", model_ref: modelRef },
          ...(sessionReasoningPreset === undefined ? {} : { reasoningPreset: sessionReasoningPreset }),
        };
      }
      case "project_ai_model_reasoning_catalog": {
        if (reasoningCatalogFixture === null) {
          throw new Error("Command not found: project_ai_model_reasoning_catalog");
        }
        return reasoningCatalogFixture ?? DEFAULT_REASONING_CATALOG;
      }
      case "paste_files": {        const sources = (payload.sourcePaths as string[] | undefined) ?? [];
        const target = String(payload.targetDirectory ?? "");
        const list = fs.get(target);
        if (!list) throw new Error(`Target directory does not exist: ${target}`);
        for (const source of sources) {
          const name = entryName(source);
          const path = `${target}/${name}`;
          if (!list.some(entry => entry.path === path)) {
            list.push({ name, path, isDirectory: false });
          }
        }
        return { successCount: sources.length, directoryCount: 0, failedFiles: [] };
      }
      case "git_get_status":
        return {
          staged: [{ path: "/repo/main.rs", status: "M", index_status: "M", workdir_status: null }],
          unstaged: [
            { path: "/repo/docs/guide.md", status: "M", index_status: null, workdir_status: "M" },
          ],
          untracked: ["/repo/logo.png"],
          conflicts: [],
          current_branch: "main",
          ahead: 0,
          behind: 0,
        };
      // git liveness (wave 4): a current host leases live status; nothing is pushed in fixtures.
      case "git_watch_status":
        return {
          workspaceId: payload.workspaceId,
          repositoryPath: payload.repositoryPath,
          revision: 0,
          status: null,
          mode: "watch",
          event: "git://status-changed",
        };
      case "git_unwatch_status":
        return true;
      case "git_get_diff": {
        const files = (payload.params as { files?: string[] })?.files ?? [];
        return [
          `diff --git a${files[0] ?? ""} b${files[0] ?? ""}`,
          `--- a${files[0] ?? ""}`,
          `+++ b${files[0] ?? ""}`,
          "@@ -1,3 +1,4 @@",
          " fn main() {",
          "-    println!(\"hello\");",
          "+    println!(\"hello, diff\");",
          "+    // reviewed",
          " }",
          "",
        ].join("\n");
      }
      case "read_file_content": {
        const path = (request as { filePath?: string })?.filePath ?? "";
        const body = content[path];
        if (body === undefined) throw new Error(`no fixture content for ${path}`);
        return body;
      }
      // Workbench (round 4): disk identity and the host file watcher.
      case "get_file_metadata": {
        const path = String(payload.path ?? "");
        const body = content[path];
        if (body === undefined) throw new Error(`no fixture content for ${path}`);
        return { path, modified: 1_700_000_000_000, size: body.length, isFile: true, isDir: false };
      }
      case "start_file_watch":
      case "stop_file_watch":
      case "retry_file_watch":
        return null;
      case "get_file_watch_status":
        return { healthy: true, watchedPaths: [], failure: null };
      case "terminal_create": {
        // Each call is a new shell, the way the host numbers them.
        terminalCount += 1;
        return { id: `terminal-${terminalCount}`, name: "zsh", workspaceId: "workspace-1" };
      }
      case "terminal_get_history": {
        if (!positional) {
          throw new Error("terminal_get_history takes positional arguments (sessionId, afterOffset), not { request }");
        }
        const id = String((request as { sessionId?: string })?.sessionId ?? "");
        return { data: `${id} % `, cursor: 7, nextOffset: 7, truncated: false, cols: 120, rows: 32 };
      }
      case "terminal_get_shells":
        return [
          { shellType: "Zsh", id: "shell-zsh", name: "zsh", path: "/bin/zsh", version: "5.9", available: true },
          { shellType: "Bash", id: "shell-bash", name: "bash", path: "/bin/bash", version: "3.2", available: true },
          { shellType: "Fish", id: "shell-fish", name: "fish", path: "/opt/fish", available: false },
        ];
      // remote link + terminal profiles (wave 4): the host keeps the list and its rules.
      case "get_terminal_profiles":
      case "upsert_terminal_profile":
      case "delete_terminal_profile":
      case "import_terminal_profiles": {
        if (options.terminalProfilesUnsupported) {
          throw new Error(`the simulated backend has no answer for ${action}`);
        }
        const workspaceId = String(payload.workspaceId ?? "").trim();
        if (!workspaceId) throw new Error("workspace_id is required");
        const rows = [...(hostTerminalProfiles[workspaceId] ?? [])];
        const reply = (extra: Record<string, unknown> = {}) => {
          if (rows.length) hostTerminalProfiles[workspaceId] = rows;
          else delete hostTerminalProfiles[workspaceId];
          return { workspaceId, profiles: rows.map(row => ({ ...row })), maxProfiles: 20, ...extra };
        };
        type Row = { id: string; name: string; shellId: string; shellType: string; startupCommand: string };
        const rowOf = (raw: Record<string, unknown>, id: string): Row => ({
          id,
          name: String(raw.name ?? "").trim(),
          shellId: String(raw.shellId ?? ""),
          shellType: String(raw.shellType ?? ""),
          startupCommand: String(raw.startupCommand ?? "").trim(),
        });
        if (action === "get_terminal_profiles") return reply();
        if (action === "delete_terminal_profile") {
          const kept = rows.filter(row => row.id !== String(payload.profileId ?? ""));
          rows.splice(0, rows.length, ...kept);
          return reply();
        }
        if (action === "import_terminal_profiles") {
          let imported = 0;
          let skipped = 0;
          for (const raw of (payload.profiles as Array<Record<string, unknown>>) ?? []) {
            const name = String(raw.name ?? "").trim();
            if (!name || rows.some(row => row.name === name) || rows.length >= 20) {
              skipped += 1;
              continue;
            }
            const wanted = String(raw.id ?? "");
            const id = wanted && !rows.some(row => row.id === wanted) ? wanted : `tp_${++terminalProfileSeq}`;
            rows.push(rowOf(raw, id));
            imported += 1;
          }
          return reply({ imported, skipped });
        }
        const profile = (payload.profile ?? {}) as Record<string, unknown>;
        const name = String(profile.name ?? "").trim();
        if (!name) throw new Error("terminal_profile_name_required: a profile needs a name");
        const editing = typeof profile.id === "string" && profile.id ? profile.id : null;
        if (rows.some(row => row.name === name && row.id !== editing)) {
          throw new Error(`terminal_profile_name_taken: a profile named ${name} already exists`);
        }
        if (editing) {
          const index = rows.findIndex(row => row.id === editing);
          if (index < 0) throw new Error(`terminal_profile_not_found: no profile ${editing} in this workspace`);
          rows[index] = rowOf(profile, editing);
          return reply({ id: editing });
        }
        if (rows.length >= 20) throw new Error("terminal_profile_limit: 20 profiles per workspace");
        const id = `tp_${++terminalProfileSeq}`;
        rows.push(rowOf(profile, id));
        return reply({ id });
      }
      case "remote_workspace_ensure_connected": {
        const connectionId = String(payload.connectionId ?? "");
        return { link: { connectionId, state: "connected", revision: 1 }, activated: false };
      }
      case "remote_workspace_link_states":
        return [];
      case "terminal_write":
      case "terminal_resize":
      case "terminal_close":
        return null;
      // features (wave 5): the OpenBitFunControl presentation surface.
      case "mark_openbitfun_control_surface_ready":
      case "mark_openbitfun_control_surface_unready":
        return null;
      case "report_openbitfun_control_result":
        controlReports.push(payload as Record<string, unknown>);
        return null;
      default:
        throw new Error(`the simulated backend has no answer for ${action}`);
    }
  }

  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown; internal?: boolean };
      const action = args.action ?? "";
      const raw = Object.prototype.hasOwnProperty.call(args, "raw");
      // A read the fake host makes of itself is not a command the client sent.
      if (!args.internal) calls.push({ action, request: raw ? args.raw : args.request, raw });
      if (action === "get_session_transcript_view" && !options.transcriptViewUnsupported) {
        // The view projects the persisted turns, so a test that answers
        // `load_session_turns` itself feeds the view the same turns.
        const request = (args.request ?? {}) as Record<string, unknown>;
        const persisted = handlers["openbitfun.invoke"]({ action: "load_session_turns", request, internal: true }) as {
          ok: boolean;
          value?: unknown;
          error?: string;
        };
        if (!persisted?.ok) return persisted;
        const sessionId = String(request.session_id ?? request.sessionId ?? "");
        return {
          ok: true,
          value: fakeTranscriptView(sessionId, Array.isArray(persisted.value) ? persisted.value : [], request),
          transport: "dev",
        };
      }
      try {
        const value = answer(action, raw ? args.raw : args.request, raw);
        return { ok: true, value, transport: "dev" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    "openbitfun.listen": () => ({ ok: true, transport: "dev" }),
    "openbitfun.unlisten": () => ({ ok: true, transport: "dev" }),
  };

  return {
    calls,
    controlReports,
    actions: () => calls.map(call => call.action),
    settingsWrites,
    credentialWrites,
    decisionKeyWrites,
    decisionKeyClears: () => decisionKeyCleared,
    clearedCredentials,
    mcpSaves,
    mcpDocument: () => JSON.parse(mcpDocumentText),
    changeMcpDocumentElsewhere: () => {
      mcpFingerprint += 1;
    },
    setMcpOAuthSession: (session: Record<string, unknown> | null) => {
      mcpOAuthSession = session;
    },
    mcpAuthWrites,
    mcpAuthClears,
    submittedDispatch: () => submitted,
    cancelledJobs,
    dispatchAnswers,
    dispatchAppends,
    dispatchContinues,
    dispatchSyncs,
    usageRequests,
    sessionModeWrites,
    acpSaves,
    acpInstalls,
    reveals,
    questionStarts,
    userAnswers,
    queueReorders,
    userMessages,
    setRunningTurn: (sessionId: string, turnId: string | null) => {
      if (turnId) runningTurnsBySession[sessionId] = turnId;
      else delete runningTurnsBySession[sessionId];
    },
    seenMarks,
    handlers,
  };
}

/** The device commands are answered outside `request`, like their Tauri signature. */
export function createDeviceBackend(options: BackendOptions = {}): Backend {
  const backend = createBackend(options);
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; raw?: unknown };
    if (args.action === "account_list_devices") {
      const listed: Array<Record<string, unknown>> =
        options.devices ??
        [
          { deviceId: "device-mac", deviceName: "studio", platform: "macos", alias: "Studio" },
          { deviceId: "device-linux", deviceName: "builder", platform: "linux" },
        ];
      // The 2.0 directory: `presence` is `directory` or `offline` (no live relay presence).
      return {
        ok: true,
        value: listed.map(device => {
          const id = String(device.deviceId ?? "");
          const online = id === "device-mac" || device.online === true;
          return { ...device, online, presence: online ? "directory" : "offline", is_local: id === "device-mac" };
        }),
        transport: "dev",
      };
    }
    if (args.action === "remote_connect_get_device_info") {
      // The default order puts this machine first; "device-mac" is it in the fixtures.
      return { ok: true, value: { device_id: "device-mac", device_name: "studio" }, transport: "dev" };
    }
    if (args.action === "account_update_device_alias") {
      return invoke(data);
    }
    return invoke(data);
  };
  return backend;
}

// use on phone (wave 4)
export interface PhoneFixtureOptions {
  /** `mesh_phone_join_info` fails with this text (signed out, older host, ...). */
  meshError?: string;
}

/**
 * Answers the Devices › Use on phone commands (`obp_get_status`,
 * `obp_create_pairing` with `via`, `mesh_phone_join_info`) in front of
 * `backend`, and records them. The LAN listener is retired, as on a current
 * backend: `obp_set_lan_enabled` and `via: "lan"` are refused.
 */
export function withPhoneFixtures(
  backend: Backend,
  options: PhoneFixtureOptions = {},
): { backend: Backend; phoneCalls: Array<{ command: string; request: Record<string, unknown> }> } {
  const phoneCalls: Array<{ command: string; request: Record<string, unknown> }> = [];
  let codes = 0;
  const status = () => ({
    available: true,
    protocol: 1,
    webUi: true,
    loopbackUrl: "http://127.0.0.1:47610/",
    ownerUrl: "http://127.0.0.1:47610/?token=t",
    pairedClients: [],
    ownerConnections: 1,
    pairedConnections: 0,
    accountDeviceConnections: 0,
    meshPort: 47612,
  });
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> | null };
    const request = args.request ?? {};
    const answer = (value: unknown) => ({ ok: true, value, transport: "dev" });
    switch (args.action) {
      case "obp_get_status":
        return answer(status());
      case "obp_set_lan_enabled":
        phoneCalls.push({ command: args.action, request });
        return { ok: false, error: "unsupported_in_native_host: obp_set_lan_enabled (retired: the device mesh connects devices on one network directly)" };
      case "obp_create_pairing": {
        phoneCalls.push({ command: args.action, request });
        if (request.via === "lan") return { ok: false, error: "obp_lan_retired: pair over the device mesh" };
        codes += 1;
        const fingerprint = "sha256:meshfp";
        const url = `https://10.126.126.3:47612/pair?code=code${codes}`;
        return answer({ qrPayload: `${url}#fp=${fingerprint}`, url, fingerprint, expiresAtMs: Date.now() + 300000 });
      }
      case "mesh_phone_join_info":
        phoneCalls.push({ command: args.action, request });
        if (options.meshError) return { ok: false, error: options.meshError };
        return answer({
          networkName: "obf-0123456789abcdef",
          networkSecret: "fixture-mesh-secret-0123456789",
          peers: ["wss://super.openbitfun.com:443/mesh/et/"],
          easytierVersion: "2.6.4",
          deviceId: "device-mac",
          virtualIp: "10.126.126.3",
          obpPort: 47612,
          webUi: true,
        });
      default:
        return invoke(data);
    }
  };
  return { backend, phoneCalls };
}

// OpenBitFun Link device list (wave 4)
/**
 * Answers `mesh_list_devices` with `rows` in front of `backend` (the device
 * list the Use on phone panel reads for signed-in phones and browsers).
 */
export function withMeshDevices(backend: Backend, rows: ReadonlyArray<object>): void {
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> | null };
    if (args.action !== "mesh_list_devices") return invoke(data);
    backend.calls.push({ action: args.action, request: args.request, raw: false });
    return { ok: true, value: rows, transport: "dev" };
  };
}

// miniapp market (wave 5) ────────────────────────────────────────────────────

export interface MiniAppMarketFixtureOptions {
  /** `account_identity` answers a signed-in user (default true). */
  signedIn?: boolean;
  /** The host has no `miniapp_market_*` commands (an older backend). */
  marketMissing?: boolean;
  /** Installed origins, keyed by local app id. */
  origins?: Record<string, { listingId: string; releaseId: string; releaseNumber: number; packageSha256: string }>;
  /** App ids whose installed copy carries local customizations. */
  localOverrides?: string[];
  /** Listings beyond the first page (`nextCursor: "page-2"`). */
  secondPage?: boolean;
  /** `miniapp_market_set_favorite` answers the market's 401 envelope. */
  favoriteUnauthorized?: boolean;
}

export interface MiniAppMarketBackend extends Backend {
  /** Every `miniapp_market_install` request, in order. */
  marketInstalls: Array<Record<string, unknown>>;
}

const MARKET_OWNER = { githubId: 7, login: "octo", avatarUrl: "" };

function marketRelease(listingId: string, releaseNumber: number, yanked = false) {
  return {
    releaseId: `${listingId}-r${releaseNumber}`,
    listingId,
    releaseNumber,
    minOpenBitFunVersion: "1.0.0",
    changelog: "",
    packageSha256: `sha-${listingId}-${releaseNumber}`,
    packageSize: 2048,
    reviewBundleHash: "",
    permissions: {},
    publishedAt: 1760000000000 - releaseNumber,
    yanked,
  };
}

export function marketListingsFixture(): Array<Record<string, unknown>> {
  return [
    {
      listingId: "lst-standup",
      slug: "standup-board",
      name: "Standup Board",
      description: "Drafts your daily update from yesterday's commits.",
      icon: "layout-grid",
      category: "productivity",
      tags: ["team"],
      owner: MARKET_OWNER,
      latestRelease: 4,
      minOpenBitFunVersion: "1.0.0",
      permissions: { fs: { read: ["{workspace}"] }, ai: { enabled: true } },
      screenshotUrls: [],
      ratingAverage: 4.6,
      ratingCount: 18,
      favoriteCount: 42,
      downloadCount: 1280,
      publishedAt: 1760000000000,
      isFavorited: false,
      changelog: "Groups commits by author.",
      license: { spdxExpression: "MIT" },
      repositoryUrl: "https://github.com/octo/standup-board",
      releases: [
        marketRelease("lst-standup", 1),
        marketRelease("lst-standup", 4),
        marketRelease("lst-standup", 2, true),
        marketRelease("lst-standup", 3),
      ],
    },
    {
      listingId: "lst-weather",
      slug: "weather-glance",
      name: "Weather Glance",
      description: "Today's forecast for your cities.",
      icon: "globe",
      category: "utilities",
      tags: [],
      owner: MARKET_OWNER,
      latestRelease: 1,
      minOpenBitFunVersion: "1.0.0",
      permissions: { net: { allow: ["api.open-meteo.com"] } },
      screenshotUrls: [],
      ratingAverage: 4.1,
      ratingCount: 7,
      favoriteCount: 12,
      downloadCount: 310,
      publishedAt: 1758000000000,
      changelog: "First release.",
      license: { spdxExpression: "Apache-2.0" },
      releases: [marketRelease("lst-weather", 1)],
    },
  ];
}

/**
 * `createBackend` plus the MiniApp market, answered the way
 * `miniapp_market_api.rs` answers: every command but the two list reads takes
 * a `request`, client errors come back as the market's JSON envelope, and the
 * install refuses until the permission / overwrite confirmation it needs.
 */
export function createMiniAppMarketBackend(
  options: BackendOptions = {},
  market: MiniAppMarketFixtureOptions = {},
): MiniAppMarketBackend {
  const base = createBackend(options);
  const invoke = base.handlers["openbitfun.invoke"];
  const listings = marketListingsFixture();
  const origins = { ...(market.origins ?? {}) };
  const localOverrides = new Set(market.localOverrides ?? []);
  const installed: Array<Record<string, unknown>> = [];
  const marketInstalls: Array<Record<string, unknown>> = [];
  const submissionRows: Array<Record<string, unknown>> = [
    { submissionId: "sub-1", slug: "focus-timer", name: "Focus Timer", icon: "box", releaseNumber: 2, status: "submitted", createdAt: 1761000000000, updatedAt: 1761000000000 },
    { submissionId: "sub-2", slug: "regex-lab", name: "Regex Lab", icon: "regex", releaseNumber: 1, status: "rejected", rejectionReason: "Asks for shell access it does not use.", createdAt: 1759000000000, updatedAt: 1759500000000 },
  ];
  const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });
  const fail = (error: string) => ({ ok: false, error });
  const summary = (item: Record<string, unknown>) => {
    const { releases: _r, changelog: _c, license: _l, repositoryUrl: _u, ...rest } = item;
    return rest;
  };
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    const isRaw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = ((isRaw ? args.raw : args.request) ?? {}) as Record<string, unknown>;
    if (action === "account_status") {
      base.calls.push({ action, request: payload, raw: isRaw });
      return ok({ logged_in: market.signedIn !== false, user_id: market.signedIn !== false ? "u-7" : null });
    }
    if (action === "account_identity") {
      base.calls.push({ action, request: payload, raw: isRaw });
      return ok(
        market.signedIn !== false
          ? { provider: "github", accountId: String(MARKET_OWNER.githubId), displayName: MARKET_OWNER.login, initial: "O" }
          : null,
      );
    }
    if (action === "list_miniapps" && installed.length > 0) {
      const reply = invoke(data) as { ok: boolean; value?: unknown };
      return ok([...(Array.isArray(reply.value) ? reply.value : []), ...installed]);
    }
    if (!action.startsWith("miniapp_market_")) return invoke(data);
    base.calls.push({ action, request: payload, raw: isRaw });
    if (market.marketMissing) return fail(`command ${action} not found`);
    const structured = !["miniapp_market_list_submissions", "miniapp_market_installed_origins"].includes(action);
    if (structured && isRaw) return fail(`${action} takes a request struct`);
    switch (action) {
      case "miniapp_market_browse": {
        const query = String(payload.query ?? "").toLowerCase();
        const category = String(payload.category ?? "all");
        const rows = listings
          .filter(item => category === "all" || item.category === category)
          .filter(item => !query || String(item.name).toLowerCase().includes(query))
          .map(summary);
        if (market.secondPage && !payload.cursor) return ok({ items: rows, nextCursor: "page-2" });
        if (payload.cursor === "page-2") {
          return ok({
            items: [{ ...summary(listings[1]), listingId: "lst-more", slug: "more-space", name: "Later Space" }],
          });
        }
        return ok({ items: rows });
      }
      case "miniapp_market_get_listing": {
        const found = listings.find(item => item.slug === payload.slug);
        if (!found) return fail(JSON.stringify({ code: "not_found", message: "Listing not found.", request_id: null }));
        return ok(found);
      }
      case "miniapp_market_installed_status": {
        const appId = Object.keys(origins).find(id => origins[id].listingId === payload.listingId);
        if (!appId) return ok(null);
        return ok({ appId, appVersion: 1, permissions: {}, origin: origins[appId], localOverride: localOverrides.has(appId) });
      }
      case "miniapp_market_installed_origins":
        return ok({ ...origins });
      case "miniapp_market_set_favorite": {
        if (market.favoriteUnauthorized) {
          return fail(JSON.stringify({ code: "unauthorized", message: "Sign in required.", request_id: null }));
        }
        const found = listings.find(item => item.slug === payload.slug)!;
        found.isFavorited = Boolean(payload.enabled);
        found.favoriteCount = Number(found.favoriteCount) + (payload.enabled ? 1 : -1);
        return ok({ count: found.favoriteCount, isFavorited: found.isFavorited });
      }
      case "miniapp_market_set_rating": {
        const found = listings.find(item => item.slug === payload.slug)!;
        found.myRating = payload.value ?? undefined;
        return ok({ average: 4.5, count: 19, myRating: payload.value ?? null });
      }
      case "miniapp_market_list_submissions":
        return ok(submissionRows.map(row => ({ ...row })));
      case "miniapp_market_withdraw_submission": {
        const row = submissionRows.find(item => item.submissionId === payload.submissionId);
        if (!row) return fail("Submission not found.");
        row.status = "withdrawn";
        return ok({ ...row });
      }
      case "miniapp_market_install": {
        marketInstalls.push({ ...payload });
        const found = listings.find(item => item.slug === payload.slug)!;
        const existing = payload.existingAppId ? String(payload.existingAppId) : "";
        if (existing && localOverrides.has(existing) && !payload.confirmOverwrite) {
          return fail("This MiniApp has local customizations. Confirm overwrite to create a snapshot and continue.");
        }
        const perms = found.permissions as { net?: { allow?: string[] } };
        if ((perms.net?.allow?.length ?? 0) > 0 && !payload.confirmPermissions) {
          return fail(`Permission confirmation required: net.allow:${perms.net!.allow!.join(",")}`);
        }
        const appId = existing || `market-${found.slug}`;
        const release = (found.releases as Array<Record<string, unknown>>).find(
          item => item.releaseNumber === payload.releaseNumber,
        )!;
        origins[appId] = {
          listingId: String(found.listingId),
          releaseId: String(release.releaseId),
          releaseNumber: Number(release.releaseNumber),
          packageSha256: String(release.packageSha256),
        };
        localOverrides.delete(appId);
        const app = {
          id: appId,
          name: found.name,
          description: found.description,
          icon: found.icon,
          category: found.category,
          tags: [],
          version: 1,
          created_at: 1,
          updated_at: 1,
          permissions: found.permissions,
          runtime_profile: "compatibility",
        };
        if (!existing) installed.push(app);
        return ok({ app, origin: origins[appId], updated: Boolean(existing), permissionDiff: { added: [], expanded: [] } });
      }
      case "miniapp_market_inspect_package": {
        if (!String(payload.path ?? "").endsWith(".bfminiapp")) return fail("Select a .bfminiapp package.");
        return ok({
          name: "Pocket Notes",
          description: "Notes in a pocket.",
          packageSha256: "0123456789abcdef0123456789abcdef",
          permissions: { notifications: { system: true } },
          permissionDiff: { added: ["notifications.system"], expanded: [] },
        });
      }
      case "miniapp_market_import_package":
        return ok({ id: "imported-pocket", name: "Pocket Notes" });
      default:
        return fail(`the simulated backend has no answer for ${action}`);
    }
  };
  return { ...base, marketInstalls };
}

// review launcher (wave 5): `launch_review` as the host answers it. The host
// owns the target, the plan and the child session; the fixture only mirrors the
// answer shapes (dry-run reading, refusals with their codes, a started child).
export interface ReviewLaunchFixtureOptions {
  /** The workspace changes the host reports, in its order. */
  files?: Array<{ path: string; status: string; previousPath?: string }>;
  /** A host older than the command. */
  missing?: boolean;
  /** The first launch's start is not acknowledged. */
  uncertain?: boolean;
}

export interface ReviewLaunchBackend extends Backend {
  reviewRequests: Array<Record<string, unknown>>;
}

export function withReviewLaunchFixtures(
  backend: Backend,
  options: ReviewLaunchFixtureOptions = {},
): ReviewLaunchBackend {
  const invoke = backend.handlers["openbitfun.invoke"];
  const reviewRequests: Array<Record<string, unknown>> = [];
  const files = options.files ?? [
    { path: "src/lib.rs", status: "modified" },
    { path: "src/review.rs", status: "added" },
    { path: "src/new_name.rs", status: "renamed", previousPath: "src/old_name.rs" },
  ];
  const children: Array<Record<string, unknown>> = [];
  const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });
  const fail = (error: string) => ({ ok: false, error });
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    if (action === "list_persisted_sessions_page" && children.length > 0) {
      const reply = invoke(data) as { ok: boolean; value?: Record<string, unknown> };
      const page = (reply.value ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(page.sessions) ? page.sessions : [];
      return ok({ ...page, sessions: [...children, ...rows] });
    }
    if (action !== "launch_review") return invoke(data);
    const request = (args.request ?? {}) as Record<string, unknown>;
    backend.calls.push({ action, request, raw: false });
    reviewRequests.push(request);
    if (options.missing) return fail("command launch_review not found");
    if (Object.prototype.hasOwnProperty.call(args, "raw")) return fail("launch_review takes a request struct");
    const command = String(request.commandText ?? "");
    const intent =
      /^\/review\s+strict\b|^\/deepreview\b/i.test(command) || (!command && request.intent === "strict")
        ? "strict"
        : "review";
    if (request.workspaceId === "workspace-2") {
      return ok({
        status: "refused",
        code: "review_remote_workspace_unsupported",
        message: "Remote workspace Review is not supported until bounded exact diff evidence is available.",
        intent,
        fileCount: 0,
        limitations: [],
        files: [],
      });
    }
    const wanted = Array.isArray(request.files) ? (request.files as string[]) : [];
    const scoped = wanted.length ? files.filter(file => wanted.includes(file.path)) : files;
    if (intent === "review" && scoped.length > 80) {
      return ok({
        status: "refused",
        code: "review_target_too_large",
        message: `This change touches ${scoped.length} files.`,
        intent,
        fileCount: scoped.length,
        limitations: [],
        files: scoped,
      });
    }
    const summary = {
      intent,
      mode: intent === "strict" ? "strict" : "standard",
      agentType: intent === "strict" ? "DeepReview" : "CodeReview",
      fileCount: scoped.length,
      changedLineCount: scoped.length * 7,
      completeness: "complete",
      limitations: ["mutable_workspace_evidence"],
      files: scoped,
    };
    if (request.dryRun) return ok({ status: "prepared", ...summary });
    const requestId = String(request.requestId ?? "r");
    const childSessionId = `review_child_${requestId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const childSessionName = String(request.childSessionName ?? "Review");
    if (!children.some(row => row.sessionId === childSessionId)) {
      children.push({
        sessionId: childSessionId,
        sessionName: childSessionName,
        agentType: summary.agentType,
        lastActiveAt: 1763000005000,
        messageCount: 1,
      });
    }
    return ok({
      status: options.uncertain ? "uncertain" : "started",
      ...(options.uncertain ? { message: "Failed to start dialog turn: timeout" } : {}),
      ...summary,
      requestId,
      childSessionId,
      childSessionName,
    });
  };
  return Object.assign(backend, { reviewRequests });
}

// ── fleet (wave 13 UI-0) ─────────────────────────────────────────────────────
//
// A fleet entry behind the OBP socket of `fixtures/obpApp.tsx`: the hello
// answers `fleet` (or not, for an older entry), `fleet_navigator` and
// `fleet_prompts` answer from the test's rows, and `fleet_call` runs the
// wrapped command on the simulated backend, recording the target it named.

export interface FleetObpHostOptions {
  /** The hello's `fleet` answer; `null` makes the backend an older entry without the fleet layer. */
  fleet: Record<string, unknown> | null;
  /** The `fleet_navigator` answer. */
  navigator?: Record<string, unknown>;
  /** The `fleet_prompts` answer. */
  prompts?: Record<string, unknown>;
  /**
   * The `fleet_recent_sessions` answer (P-UI, wave 17). Unset projects the
   * navigator's rows in the order it lists them, with their device and
   * workspace labels (the UI never sorts); `false` makes the entry older than
   * the command.
   */
  recentSessions?: Record<string, unknown> | false;
  /**
   * `fleet_device_detail` answers by device id (P-UI, wave 17). A device
   * without one is projected from its navigator row (no running work, its
   * capabilities as user-facing ids); `false` makes the entry older than the
   * command.
   */
  deviceDetails?: Record<string, Record<string, unknown>> | false;
  /**
   * The `fleet_models` answer (wave 21): every device's models grouped by
   * device, keyed by the request's `deviceId` (`""` for the entry). Unset
   * makes the entry older than the command.
   */
  fleetModels?: Record<string, Record<string, unknown>>;
}

/** The user-facing capability ids `fleet_device_detail` sends, from a navigator row's host capabilities. */
const FLEET_DETAIL_CAPABILITIES: Record<string, string> = {
  terminal: "terminal",
  git: "git",
  browser: "browser",
  browser_control: "browser",
  desktop: "desktop",
  desktop_control: "desktop",
  computer_use: "desktop",
  jobs: "jobs",
  superagent_jobs: "jobs",
  dispatch: "jobs",
};

type FleetFixtureDevice = Record<string, unknown> & {
  deviceId?: string;
  name?: string;
  hostKind?: string;
  state?: string;
  isClientDevice?: boolean;
  hostCapabilities?: string[];
  workspaces?: Array<Record<string, unknown> & { workspaceId?: string; name?: string; sessions?: Array<Record<string, unknown>> }>;
};

function fixtureDevices(navigator: Record<string, unknown> | undefined): FleetFixtureDevice[] {
  return Array.isArray(navigator?.devices) ? (navigator!.devices as FleetFixtureDevice[]) : [];
}

/** `fleet_recent_sessions` projected from a navigator: runtime devices, top-level sessions, navigator order. */
export function fleetRecentSessionsFrom(navigator: Record<string, unknown> | undefined): Record<string, unknown> {
  const sessions: Array<Record<string, unknown>> = [];
  for (const device of fixtureDevices(navigator)) {
    if (device.hostKind === "cloud") continue;
    for (const workspace of device.workspaces ?? []) {
      for (const session of workspace.sessions ?? []) {
        if (session.parentSessionId) continue;
        sessions.push({
          ...session,
          deviceId: device.deviceId,
          workspaceId: workspace.workspaceId,
          deviceName: device.name ?? "",
          hostKind: device.hostKind ?? "desktop",
          deviceState: device.state ?? "online",
          isClientDevice: device.isClientDevice === true,
          workspaceName: workspace.name ?? "",
        });
      }
    }
  }
  return { revision: Number(navigator?.revision ?? 1), sessions, truncated: false };
}

/** `fleet_device_detail` projected from a navigator row: nothing running, its capabilities as ids. */
export function fleetDeviceDetailFrom(device: FleetFixtureDevice, revision = 1): Record<string, unknown> {
  const capabilities: string[] = [];
  for (const id of device.hostCapabilities ?? []) {
    const mapped = FLEET_DETAIL_CAPABILITIES[id];
    if (mapped && !capabilities.includes(mapped)) capabilities.push(mapped);
  }
  return {
    revision,
    device,
    runningSessions: 0,
    runningJobs: 0,
    waitingJobs: 0,
    running: { sessions: [], jobs: [] },
    waiting: { jobs: [] },
    capabilities,
    ...(device.state === "update_required" ? { update: { available: true, canUpdateRemotely: false } } : {}),
  };
}

export interface FleetObpHost {
  handlers: Record<string, (data: unknown) => unknown>;
  /** Every call frame, as sent (`fleet_call` stays wrapped). */
  calls: Array<{ command: string; args: Record<string, unknown> }>;
  /** Every `fleet_call`, unwrapped. */
  fleetCalls: Array<{ target: string | null; command: string; args: Record<string, unknown> }>;
  /** Every hello's params. */
  hellos: Array<Record<string, unknown>>;
  /** Calls that reached the page host's fixtures (must stay empty). */
  pageHostCalls: unknown[];
}

export function fleetObpHost(backend: Backend, options: FleetObpHostOptions): FleetObpHost {
  const calls: FleetObpHost["calls"] = [];
  const fleetCalls: FleetObpHost["fleetCalls"] = [];
  const hellos: FleetObpHost["hellos"] = [];
  const pageHostCalls: unknown[] = [];
  const reply = (id: unknown, body: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id, ...body });
  const runOnBackend = (command: string, args: Record<string, unknown>): Record<string, unknown> => {
    const keys = Object.keys(args);
    const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
    const answer = backend.handlers["openbitfun.invoke"](
      requestShape ? { action: command, request: args.request ?? null } : { action: command, raw: args },
    ) as { ok: boolean; value?: unknown; error?: string };
    return answer.ok
      ? { result: answer.value ?? null }
      : { error: { code: -32000, message: answer.error ?? `${command} failed` } };
  };
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.obpSend": (data: unknown) => {
      const frame = JSON.parse((data as { frame: string }).frame) as Record<string, unknown>;
      if (frame.method === "hello") {
        hellos.push((frame.params ?? {}) as Record<string, unknown>);
        return [
          reply(0, {
            result: {
              protocol: 1,
              scope: "account-device",
              capabilities: ["obp_v1", "resume", "credit_ack"],
              registryDigest: "fnv1a64:test",
              lastSeq: 0,
              creditBytes: 1048576,
              backend: { version: "9.9.9", platform: "linux", instanceId: "entry-a", dataDir: "/data" },
              ...(options.fleet ? { fleet: options.fleet } : {}),
            },
          }),
        ];
      }
      if (frame.method !== "call") return [];
      const params = frame.params as { command: string; args: Record<string, unknown> };
      calls.push(params);
      if (options.fleet && params.command === "fleet_navigator") {
        return [reply(frame.id, { result: options.navigator ?? { revision: 1, full: true, devices: [], removedDeviceIds: [], totals: { running: 0, waiting: 0, unread: 0 } } })];
      }
      if (options.fleet && params.command === "fleet_subscribe") {
        return [reply(frame.id, { result: { applied: true } })];
      }
      if (options.fleet && params.command === "fleet_prompts") {
        return [reply(frame.id, { result: options.prompts ?? { revision: 1, prompts: [] } })];
      }
      if (
        options.fleet &&
        ((params.command === "fleet_recent_sessions" && options.recentSessions === false) ||
          (params.command === "fleet_device_detail" && options.deviceDetails === false))
      ) {
        return [reply(frame.id, { error: { code: -32601, message: `unknown command: ${params.command}` } })];
      }
      if (options.fleet && params.command === "fleet_recent_sessions" && options.recentSessions !== false) {
        return [reply(frame.id, { result: options.recentSessions ?? fleetRecentSessionsFrom(options.navigator) })];
      }
      if (options.fleet && params.command === "fleet_device_detail" && options.deviceDetails !== false) {
        const request = (params.args.request ?? {}) as { deviceId?: string };
        const deviceId = String(request.deviceId ?? "") || String((options.fleet as { deviceId?: string }).deviceId ?? "");
        const served = options.deviceDetails ? options.deviceDetails[deviceId] : undefined;
        const row = fixtureDevices(options.navigator).find(device => device.deviceId === deviceId);
        if (served) return [reply(frame.id, { result: served })];
        if (row) return [reply(frame.id, { result: fleetDeviceDetailFrom(row, Number(options.navigator?.revision ?? 1)) })];
        return [reply(frame.id, { error: { code: -32000, message: `fleet_device_unknown: ${deviceId}` } })];
      }
      if (options.fleet && params.command === "fleet_models") {
        const request = (params.args.request ?? {}) as { deviceId?: string };
        const served = options.fleetModels?.[String(request.deviceId ?? "")];
        if (served) return [reply(frame.id, { result: served })];
        return [reply(frame.id, { error: { code: -32601, message: `unknown command: ${params.command}` } })];
      }
      if (options.fleet && params.command === "fleet_call") {
        const request = (params.args.request ?? {}) as { target?: string; command?: string; args?: Record<string, unknown> };
        const command = String(request.command ?? "");
        const args = (request.args ?? {}) as Record<string, unknown>;
        fleetCalls.push({ target: typeof request.target === "string" ? request.target : null, command, args });
        return [reply(frame.id, runOnBackend(command, args))];
      }
      if (!options.fleet && params.command.startsWith("fleet_")) {
        return [reply(frame.id, { error: { code: -32601, message: `unknown command: ${params.command}` } })];
      }
      return [reply(frame.id, runOnBackend(params.command, params.args))];
    },
    "openbitfun.invoke": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: false, error: "the page host must not be used" };
    },
    "openbitfun.listen": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: true };
    },
  };
  return { handlers, calls, fleetCalls, hellos, pageHostCalls };
}

/** A fleet session row, with the fields the navigator always carries. */
export function fleetSessionRow(
  deviceId: string,
  workspaceId: string,
  sessionId: string,
  title: string,
  lastActivityMs = 1763000000000,
): Record<string, unknown> {
  return {
    deviceId,
    workspaceId,
    sessionId,
    title,
    agentType: "Standard",
    status: "idle",
    unread: false,
    needsAttention: false,
    lastActivityMs,
  };
}

/** A fleet device row with one workspace per entry of `workspaces`. */
export function fleetDeviceRow(
  deviceId: string,
  name: string,
  workspaces: Array<{
    workspaceId: string;
    name: string;
    rootPath: string;
    kind?: string;
    sshHost?: string;
    sessions: Array<Record<string, unknown>>;
    isHostCurrent?: boolean;
  }>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    deviceId,
    name,
    hostKind: "desktop",
    isClientDevice: false,
    state: "online",
    asOfMs: 1763000000000,
    version: "9.9.9",
    fleetProtocol: 1,
    hostCapabilities: ["fleet_v1"],
    actions: { createWorkspace: { allowed: true } },
    sessionsTruncated: false,
    workspaces: workspaces.map(workspace => ({
      deviceId,
      kind: "local",
      isHostCurrent: workspace.isHostCurrent ?? false,
      sessionTotal: workspace.sessions.length,
      hasMore: false,
      ...workspace,
    })),
    ...extra,
  };
}

// ── shell navigation (wave 15 UI-A) ──────────────────────────────────────────
//
// A session opens from All sessions (Recent lists the host's rows by title).
// The sidebar's device tree shows the same titles (wave 23), so the helpers
// press the row inside the All sessions page. They walk that path so a test
// reads the way a user gets there.

/** The part of `nsh/test`'s app handle the helpers press. */
export interface ShellNavigator {
  press(target: string): Promise<unknown>;
  waitFor(target: string, options?: unknown): Promise<unknown>;
  shows(target: string): boolean;
}

/** Navigates to All sessions (sidebar on Super Agent layout, tab bar on phone, or ⌘K command on streamlined desktop). */
async function openAllSessionsScene(app: ShellNavigator): Promise<void> {
  if (app.shows("nav-all-sessions")) {
    await app.press("nav-all-sessions");
    return;
  }
  if (app.shows("phone-tab-all-sessions")) {
    await app.press("phone-tab-all-sessions");
    return;
  }
  await app.waitFor("global-search-trigger");
  await app.press("global-search-trigger");
  await app.waitFor("label:global-search-item-command:sessions");
  await app.press("label:global-search-item-command:sessions");
}

/** Opens All sessions › Recent and waits for `title` (a session row) to show. */
export async function showAllSessions(app: ShellNavigator, title?: string): Promise<void> {
  await openAllSessionsScene(app);
  await app.press("all-sessions-tab-recent");
  if (title) await app.waitFor(title);
}

/** Opens a session by its row title through All sessions (`"Title >> nth=0"` works too). */
export async function openSessionRow(app: ShellNavigator, title: string): Promise<void> {
  await showAllSessions(app);
  await app.press(`label:all-sessions-scene >> ${title}`);
}
/**
 * Opens a session the way a user does: All sessions › Recent › its row (the
 * first row with that title; `"Title >> nth=1"` picks another). `deviceId` is
 * accepted for call sites that name the device; Recent rows are matched by
 * title, so keep titles unique across devices in a fixture.
 */
export async function openSession(app: ShellNavigator, title: string, _options: { deviceId?: string } = {}): Promise<void> {
  const base = title.split(" >> ")[0]!;
  await showAllSessions(app, base);
  await app.press(`label:all-sessions-scene >> ${title.includes(" >> ") ? title : `${title} >> nth=0`}`);
}

/** Opens All sessions › By device: the account's devices (and, on an older backend, the way into one). */
export async function showDevices(app: ShellNavigator): Promise<void> {
  await openAllSessionsScene(app);
  await app.press("all-sessions-tab-by-device");
}

/** Opens a workspace tool full width through ⌘K's commands (Files, Git, Terminal, Browser). */
export async function openToolScene(
  app: ShellNavigator & { type(target: string, text: string): Promise<unknown> },
  tool: "files" | "git" | "terminal" | "browser",
): Promise<void> {
  await app.press("global-search-trigger");
  await app.type("global-search-input", `>${tool}`);
  await app.press(`label:global-search-item-command:${tool}`);
}
// end shell navigation (wave 15 UI-A)

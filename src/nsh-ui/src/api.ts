// Typed access to the desktop backend.
//
// Wire shapes follow the existing Web UI service API: every command receives one
// `request` object, sessions use `workspace_id`, workspace and file commands use
// `workspaceId`. Keep those names as they are; they are the host contract.

import { invokeCommand, invokeRawCommand } from "./bridge";

export interface WorkspaceRecord {
  id: string;
  name?: string;
  rootPath: string;
  workspaceKind?: string;
  connectionId?: string;
  sshHost?: string;
  lastAccessed?: number;
}

export interface SessionSummary {
  sessionId: string;
  sessionName: string;
  createdAt?: number;
  /** Real Rust `SessionMetadata.lastActiveAt` timestamp (ms). */
  lastActiveAt?: number;
  /** Normalized / legacy activity timestamp (ms). */
  lastUpdated?: number;
  messageCount?: number;
  workspaceId?: string;
  /** Real Rust `SessionMetadata.status` (`"active" | "archived" | "completed"`). */
  status?: string;
  /** Normalized archive status (`"archived"` or `"active"`). */
  persistedStatus?: string;
  /** The model the session is bound to, as the catalog names it. */
  modelName?: string;
  /**
   * The agent this session runs as. A session keeps the agent it started with, so
   * this is also the proof that the binding can no longer change.
   */
  agentType?: string;
  /** The host's unread receipt (`completed` / `error` / `interrupted`). */
  unreadCompletion?: string;
  /** Host-derived: the session holds a result nobody has looked at yet. */
  unread?: boolean;
  /** Host-derived: that unread result is a failed turn. */
  failed?: boolean;
  /** The device that owns the session (fleet index rows); absent from a single host's catalogue. */
  deviceId?: string;
}

/**
 * Normalizes a `SessionMetadata` row from either the real Rust backend
 * (`status`, `lastActiveAt`) or legacy/test fixtures (`persistedStatus`,
 * `lastUpdated`) so every surface reads consistent fields.
 */
export function normalizeSessionSummary(raw: SessionSummary): SessionSummary {
  const status = typeof raw.status === "string" ? raw.status : undefined;
  const persistedStatus =
    typeof raw.persistedStatus === "string"
      ? raw.persistedStatus
      : status === "archived"
        ? "archived"
        : status
          ? "active"
          : undefined;
  const lastActiveAt =
    typeof raw.lastActiveAt === "number" && Number.isFinite(raw.lastActiveAt)
      ? raw.lastActiveAt
      : typeof raw.lastUpdated === "number" && Number.isFinite(raw.lastUpdated)
        ? raw.lastUpdated
        : undefined;
  return {
    ...raw,
    ...(persistedStatus !== undefined ? { persistedStatus } : {}),
    ...(lastActiveAt !== undefined
      ? {
          lastActiveAt,
          lastUpdated:
            typeof raw.lastUpdated === "number" && Number.isFinite(raw.lastUpdated)
              ? raw.lastUpdated
              : lastActiveAt,
        }
      : {}),
  };
}

export interface SessionPage {
  sessions: SessionSummary[];
  totalTopLevelCount: number;
  loadedTopLevelCount: number;
  nextCursor?: string;
  hasMore: boolean;
  /** Per-session activity facts; `unread` / `failed` are absent on older hosts. */
  activities?: Array<{ sessionId?: string; unread?: boolean; failed?: boolean }>;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: WorkspaceEntry[];
}

export interface TerminalSession {
  id: string;
  name?: string;
  workspaceId?: string;
}

export const getOpenedWorkspaces = () => invokeCommand<WorkspaceRecord[]>("get_opened_workspaces");

export const getRecentWorkspaces = () => invokeCommand<WorkspaceRecord[]>("get_recent_workspaces");

/**
 * The host's workspace navigator (view models, wave 4): opened and recent lists
 * already deduplicated, and the workspace a surface should show. `selection`
 * says why: the caller's own (`kept`), the host's current (`host_current`), the
 * first opened one that the caller should make active (`first_opened`), or
 * nothing opened (`none`, with the recent workspace to reopen).
 */
export interface WorkspaceNavigatorView {
  opened: WorkspaceRecord[];
  recent: WorkspaceRecord[];
  selectedId: string | null;
  selection: "kept" | "host_current" | "first_opened" | "none";
  reopenCandidateId?: string;
}

export const getWorkspaceNavigator = (selectedId: string | null) =>
  invokeCommand<WorkspaceNavigatorView>("get_workspace_navigator", selectedId ? { selectedId } : {});

export const openWorkspace = (rootPath: string) =>
  invokeCommand<WorkspaceRecord>("open_workspace", { path: rootPath });

export const setActiveWorkspace = (workspaceId: string) =>
  invokeCommand<unknown>("set_active_workspace", { workspaceId });

/** The workspace the host has active now, or `null` when none is. */
export const getCurrentWorkspace = () =>
  invokeCommand<WorkspaceRecord | null>("get_current_workspace", {});

/** Reopens a recent workspace by its id, as the desktop's `switchWorkspace` does. */
export const openWorkspaceById = (record: { id: string }) =>
  invokeCommand<WorkspaceRecord>("open_workspace", { workspaceId: record.id });

export const removeRecentWorkspace = (workspaceId: string) =>
  invokeCommand<unknown>("remove_recent_workspace", { workspaceId });

export const updateWorkspaceInfo = (workspaceId: string, name: string) =>
  invokeCommand<WorkspaceRecord>("update_workspace_info", { workspaceId, name });

export const revealInExplorer = (path: string, workspaceId?: string) =>
  invokeCommand<unknown>("reveal_in_explorer", {
    path,
    ...(workspaceId ? { workspaceId } : {}),
  });

export const listSessions = async (
  workspaceId: string,
  limit: number,
  cursor?: string,
): Promise<SessionPage> => {
  const page = await invokeCommand<SessionPage>("list_persisted_sessions_page", {
    workspace_id: workspaceId,
    limit,
    ...(cursor ? { cursor } : {}),
  });
  // The host derives each row's read state; an older host only has the raw
  // receipt on the row, which says the same thing without the split.
  const attention = new Map<string, { unread?: boolean; failed?: boolean }>();
  for (const activity of Array.isArray(page?.activities) ? page.activities : []) {
    if (activity?.sessionId) attention.set(activity.sessionId, activity);
  }
  return {
    ...page,
    sessions: Array.isArray(page?.sessions)
      ? page.sessions.map(raw => {
          const row = normalizeSessionSummary(raw);
          const host = attention.get(row.sessionId);
          const receipt = typeof row.unreadCompletion === "string" && row.unreadCompletion ? row.unreadCompletion : "";
          return {
            ...row,
            unread: typeof host?.unread === "boolean" ? host.unread : Boolean(receipt),
            failed: typeof host?.failed === "boolean" ? host.failed : receipt === "error",
          };
        })
      : [],
  };
};

/** `limit` keeps the newest N turns, the tail window the desktop opens a session with. */
// Transcript view (logic batch 4): the host projects persisted turns once for
// every client (`get_session_transcript_view`); mobile and bots read the same
// projection as `ChatMessage`. Field names are the wire's.
export interface TranscriptImage {
  name: string;
  dataUrl?: string;
  /** Host path of an attachment recorded without pixels; only this host can read it. */
  imagePath?: string;
}

export interface TranscriptToolView {
  id: string;
  name: string;
  input?: unknown;
  inputPreview?: string;
  status: string;
  success?: boolean;
  error?: string;
  result?: unknown;
  resultForAssistant?: string;
  durationMs?: number;
  startMs?: number;
  plan?: { filePath: string; name: string; overview?: string };
  /** What a subagent this call started did; never the parent's own answer. */
  subagentItems?: TranscriptItemView[];
}

export type TranscriptItemView =
  | { kind: "text"; id: string; roundIndex: number; text: string }
  | { kind: "thinking"; id: string; roundIndex: number; text: string; reasoningKind?: "reasoning" | "summary" }
  | { kind: "tool"; roundIndex: number; tool: TranscriptToolView };

export interface TranscriptTurnView {
  turnId: string;
  turnIndex: number;
  /** `user_dialog` or `manual_compaction`. */
  kind: string;
  /** `active`, `done`, `failed` or `cancelled`. */
  status: string;
  /** The host persisted a terminal status; the live stream may give way to this record. */
  settled: boolean;
  user: { id: string; text: string; timestampMs: number; images?: TranscriptImage[] };
  items: TranscriptItemView[];
  error?: string;
  errorDetail?: Record<string, unknown>;
  effectiveModel?: string;
  durationMs?: number;
  startTimeMs: number;
  assistantTimestampMs: number;
  tokenUsage?: { inputTokens: number; outputTokens?: number; cachedTokens?: number; totalTokens: number };
  recovery?: { status: string; executionGeneration: number };
}

export interface SessionTranscriptView {
  sessionId: string;
  /** `full` replaces the held turns; `after` keeps them through `keptThroughIndex` and appends. */
  mode: "full" | "after";
  keptThroughIndex?: number;
  turns: TranscriptTurnView[];
  cursor?: string;
  hasEarlier: boolean;
  /**
   * The turn running right now, as the host's runtime journal projected it: the
   * live `agentic://*` events so far and the delivery position they reached. A
   * host older than this field omits it, and so does one with nothing running.
   */
  runningTurn?: RunningTurnSnapshot;
}

/** A running turn's replayable events (`get_session_transcript_view` `runningTurn`). */
export interface RunningTurnSnapshot {
  sessionId: string;
  streamId: string;
  cursor: number;
  activeTurnId?: string | null;
  events: Array<{ eventName: string; payload: unknown }>;
}

export const getSessionTranscriptView = (
  sessionId: string,
  workspaceId: string,
  limit?: number,
  cursor?: string,
) =>
  invokeCommand<SessionTranscriptView>("get_session_transcript_view", {
    session_id: sessionId,
    workspace_id: workspaceId,
    ...(limit ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
  });

export const getConfigs = (paths: string[]) => invokeCommand<Record<string, unknown>>("get_configs", { paths });

/** One config path; `optional` tolerates a path an older or newer host lacks. */
export const getConfig = (path: string, optional = false) =>
  invokeCommand<unknown>("get_config", {
    path,
    ...(optional ? { skipRetryOnNotFound: true } : {}),
  });

export const setConfig = (path: string, value: unknown) =>
  invokeCommand<unknown>("set_config", { path, value });

export const getFileTree = (workspaceId: string, path: string, maxDepth: number) =>
  invokeCommand<WorkspaceEntry[]>("get_file_tree", { workspaceId, path, max_depth: maxDepth });

/** One directory's children, the call the file explorer makes while the tree grows. */
export const getDirectoryChildren = (workspaceId: string, path: string) =>
  invokeCommand<WorkspaceEntry[]>("explorer_get_children", { workspaceId, path });

export const createWorkspaceFile = (workspaceId: string, path: string) =>
  invokeCommand<unknown>("create_file", { workspaceId, path });

export const createWorkspaceDirectory = (workspaceId: string, path: string) =>
  invokeCommand<unknown>("create_directory", { workspaceId, path });

export const deleteWorkspaceFile = (workspaceId: string, path: string) =>
  invokeCommand<unknown>("delete_file", { workspaceId, path });

export const deleteWorkspaceDirectory = (workspaceId: string, path: string, recursive = true) =>
  invokeCommand<unknown>("delete_directory", { workspaceId, path, recursive });

export const renameWorkspaceFile = (workspaceId: string, oldPath: string, newPath: string) =>
  invokeCommand<unknown>("rename_file", { workspaceId, oldPath, newPath });

/** Copies files that already sit on this machine into a workspace directory. */
export const pasteWorkspaceFiles = (workspaceId: string, sourcePaths: string[], targetDirectory: string) =>
  invokeCommand<{ successCount: number; directoryCount?: number; failedFiles?: Array<{ path: string; error: string }> }>(
    "paste_files",
    { sourcePaths, targetDirectory, isCut: false, workspaceId, controllerLocal: false },
  );

/**
 * Workspace search. `search_files` streams its progress through events and
 * returns the rows this call already has; the scene renders those and does not
 * wait for a completion event it has no index lifecycle for. With
 * `searchContent` the same command also matches inside files and reports the
 * line and its surrounding preview.
 */
export const searchWorkspaceFiles = (
  workspaceId: string,
  pattern: string,
  options: {
    searchContent?: boolean;
    caseSensitive?: boolean;
    useRegex?: boolean;
    wholeWord?: boolean;
    maxResults?: number;
  } = {},
) =>
  invokeCommand<unknown[]>("search_files", {
    workspaceId,
    pattern,
    searchContent: options.searchContent === true,
    searchId: `nsh-files-${Date.now()}`,
    caseSensitive: options.caseSensitive === true,
    useRegex: options.useRegex === true,
    wholeWord: options.wholeWord === true,
    ...(options.maxResults ? { maxResults: options.maxResults } : {}),
  });


export const readFileContent = (workspaceId: string, filePath: string, encoding?: string) =>
  invokeCommand<string>("read_file_content", {
    workspaceId,
    filePath,
    ...(encoding ? { encoding } : {}),
  });

export interface GitFileStatus {
  path: string;
  status: string;
  index_status?: string | null;
  workdir_status?: string | null;
}

export interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
  conflicts?: string[];
  current_branch: string;
  ahead: number;
  behind: number;
}

/** The repository state under the workspace root; a plain directory answers `null`. */
export const getGitStatus = (workspaceId: string, repositoryPath: string) =>
  invokeCommand<GitStatus | null>("git_get_status", { workspaceId, repositoryPath });

/** A unified diff for one file (or the whole tree when `files` is absent). */
export const getGitDiff = (
  workspaceId: string,
  repositoryPath: string,
  params: { files?: string[]; staged?: boolean; reviewSafe?: boolean },
) => invokeCommand<string>("git_get_diff", { workspaceId, repositoryPath, params });

/**
 * A shell the host discovered. `type` is the host's debug name for its shell enum
 * (`Zsh`, or `Custom("nushell")`), and `id` is the stable id a session is created
 * from, which is why `terminal_create` is given the id.
 */
export interface TerminalShell {
  id: string;
  name: string;
  type: string;
  path: string;
  version?: string | null;
  available?: boolean;
}

export const listTerminalShells = async (): Promise<TerminalShell[]> => {
  const rows = await invokeCommand<Array<Record<string, unknown>>>("terminal_get_shells");
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: String(row?.id ?? row?.shellId ?? row?.shell_id ?? ""),
    name: String(row?.name ?? ""),
    type: String(row?.shellType ?? row?.shell_type ?? row?.type ?? ""),
    path: String(row?.path ?? ""),
    version: (row?.version as string | null | undefined) ?? null,
    available: row?.available !== false,
  })).filter(shell => shell.id || shell.name || shell.path).map((shell, index) => ({
    ...shell,
    id: shell.id || `${shell.type || "shell"}-${index}`,
  }));
};

export const createTerminal = (request: {
  workspaceId?: string;
  workingDirectory?: string;
  shellId?: string;
  shellType?: string;
  cols?: number;
  rows?: number;
}) => invokeCommand<TerminalSession>("terminal_create", request);

export const writeTerminal = (sessionId: string, data: string) =>
  invokeCommand<unknown>("terminal_write", { sessionId, data });

export const resizeTerminal = (sessionId: string, cols: number, rows: number) =>
  invokeCommand<unknown>("terminal_resize", { sessionId, cols, rows });

export const closeTerminal = (sessionId: string) => invokeCommand<unknown>("terminal_close", { sessionId });

export interface TerminalHistory {
  data: string;
  cursor: number;
  nextOffset: number;
  truncated: boolean;
  cols: number;
  rows: number;
}

/** Replays what a shell already printed, so a reattached view starts in context. */
export const getTerminalHistory = (sessionId: string, afterOffset?: number) =>
  invokeRawCommand<TerminalHistory>(
    "terminal_get_history",
    afterOffset !== undefined ? { sessionId, afterOffset } : { sessionId },
  );

/** A model the host has configured, as the catalog reports it. */
export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  base_url?: string;
  context_window?: number;
  enabled?: boolean;
  capabilities?: string[];
  /** Embedded reasoning catalog projection from real Rust `RemoteModelConfig`. */
  reasoning?: ReasoningCatalogProjection | null;
  /** What every list shows first (the model); absent from an older host. */
  label?: string;
  /** The secondary text beside `label` (the provider). */
  detail?: string;
}

export interface ModelCatalog {
  version?: number;
  models: ModelCatalogEntry[];
  default_models?: {
    primary?: string | null;
    fast?: string | null;
    [role: string]: string | null | undefined;
  };
  /** Concrete configured model ID resolved from `ai.agent_model_selections.mode`. */
  mode_default_model_id?: string | null;
  session_model_id?: string;
  session_reasoning_preset?: string | null;
}

export const getModelCatalog = () => invokeCommand<ModelCatalog>("get_ai_model_catalog");

/**
 * One agent the host can run a session as: a built-in execution profile
 * (`Minimal`, `Standard`, `Ultimate`, `Creative`) or an agent the host configured
 * itself, including external ACP agents.
 */
export interface AgentMode {
  id: string;
  name: string;
  description: string;
  source?: string;
  isReadonly?: boolean;
  toolCount?: number;
  model?: string | null;
}

/** The agents this workspace can run, as the host resolves them for it. */
export const getAvailableModes = (workspaceId: string, workspacePath?: string) =>
  invokeCommand<AgentMode[]>("get_available_modes", {
    workspaceId,
    ...(workspacePath ? { workspacePath } : {}),
  });

/**
 * Rebinds a session that has not started yet to another agent. The host also
 * accepts it on a started session, but the desktop refuses that in the UI, so
 * this surface keeps a started session on the agent it ran as.
 */
export const updateSessionMode = (request: {
  sessionId: string;
  modeId: string;
  workspaceId?: string;
  workspacePath?: string;
  includeInternal?: boolean;
}) => invokeCommand<unknown>("update_session_mode", request);

/** Binds a session to another model; the next turn runs on it. */
export const updateSessionModel = (request: {
  sessionId: string;
  modelName: string;
  /**
   * The reasoning setting the next turn runs at, written together with the model
   * because the host validates the pair. `null` is the model's own default, and
   * leaving it out keeps whatever the session already had.
   */
  reasoningPreset?: string | null;
  workspaceId?: string;
  workspacePath?: string;
  includeInternal?: boolean;
}) => invokeCommand<unknown>("update_session_model", request);

/** One reasoning setting a model can run at, as the host's catalog describes it. */
export interface ReasoningPresetDescriptor {
  id: string;
  label: string;
  order: number;
  actions: Array<{ type: string; value?: unknown; enabled?: boolean }>;
  source: string;
  effective_effort?: string;
}

/** The presets a model offers, projected from its provider and its own config. */
export interface ReasoningCatalogProjection {
  status: string;
  default_preset?: string;
  presets: ReasoningPresetDescriptor[];
  unavailable_presets?: ReasoningPresetDescriptor[];
}

/**
 * Asks the host what a model can be set to. The request carries the model's own
 * facts (`reasoning` is its `ai.models` entry's block, forwarded unchanged)
 * because the answer depends on the provider the model runs behind.
 */
export const projectAiModelReasoningCatalog = (request: {
  provider: string;
  modelName: string;
  baseUrl: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: Record<string, unknown>;
}) => invokeCommand<ReasoningCatalogProjection>("project_ai_model_reasoning_catalog", request);

export interface SessionModelTargetResponse {
  sessionId?: string;
  /** Legacy dev-host shape; real Rust hosts return `selection`. */
  modelId?: string;
  selection?: { kind: string; model_ref?: string; pool_id?: string };
  /** Absent on a host older than this field, which is not the same as `null`. */
  reasoningPreset?: string | null;
  binding?: { poolId?: string; modelId?: string } | null;
}

/** What a session's next turn is bound to, including its reasoning setting. */
export const getSessionModelTarget = (request: {
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
}) => invokeCommand<SessionModelTargetResponse>("get_session_model_target", request);

/** Updates a session's explicit model/pool target (required when switching out of a model pool). */
export const updateSessionModelTarget = (request: {
  sessionId: string;
  selection: { kind: "model"; model_ref: string } | { kind: "pool"; pool_id: string };
  workspaceId?: string;
  workspacePath?: string;
  includeInternal?: boolean;
}) => invokeCommand<SessionModelTargetResponse>("update_session_model_target", request);

/** Session lifecycle and row actions; sessions address a workspace by `workspace_id`. */
export const createSession = (request: {
  sessionId?: string;
  sessionName: string;
  agentType: string;
  workspacePath?: string;
  workspaceId?: string;
}) =>
  invokeCommand<{
    sessionId: string;
    sessionName: string;
    agentType: string;
    modelId?: string | null;
    modelName?: string | null;
  }>("create_session", request);

export const startDialogTurn = (request: {
  sessionId: string;
  userInput: string;
  agentType: string;
  workspaceId?: string;
  workspacePath?: string;
  turnId?: string;
  imageContexts?: Array<{
    id: string;
    image_path?: string;
    data_url?: string;
    mime_type: string;
    image_name: string;
    file_size: number;
    width?: number;
    height?: number;
    source: string;
  }>;
}) => invokeCommand<{ success: boolean; message: string }>("start_dialog_turn", request);

/**
 * Stops a running turn. `interrupt_dialog_turn` asks the runtime to stop at a
 * safe point; `cancel_dialog_turn` is the hard stop the React surface falls back
 * to when the runtime has no interruption surface for this session.
 */
export const interruptDialogTurn = (sessionId: string, dialogTurnId: string) =>
  invokeCommand<unknown>("interrupt_dialog_turn", { sessionId, dialogTurnId });

export const cancelDialogTurn = (sessionId: string, dialogTurnId: string) =>
  invokeCommand<unknown>("cancel_dialog_turn", { sessionId, dialogTurnId });

/**
 * Injects a message into the turn that is already running instead of waiting for
 * it to finish, which is the desktop surface's default mid-turn policy.
 */
export const steerDialogTurn = (request: {
  sessionId: string;
  dialogTurnId: string;
  content: string;
  displayContent?: string;
  imageContexts?: Array<{
    id: string;
    image_path?: string;
    data_url?: string;
    mime_type: string;
    image_name: string;
    file_size: number;
    width?: number;
    height?: number;
    source: string;
  }>;
}) => invokeCommand<{ success: boolean; steeringId?: string }>("steer_dialog_turn", request);

/** Registers this window as a permission surface; the host then emits `permission://event`. */
export const subscribePermissionRequests = () => invokeCommand<unknown>("subscribe_permission_requests");

export const listPendingPermissionRequests = () => invokeCommand<unknown[]>("list_pending_permission_requests");

export const respondPermission = (request: {
  requestId: string;
  reply: "once" | "always" | "reject";
  feedback?: string;
}) => invokeCommand<unknown>("respond_permission", request);

export const archiveSession = (sessionId: string, workspaceId: string) =>
  invokeCommand<unknown>("archive_session", { session_id: sessionId, workspace_id: workspaceId });

export const unarchiveSession = (sessionId: string, workspaceId: string) =>
  invokeCommand<unknown>("unarchive_session", { session_id: sessionId, workspace_id: workspaceId });

export const deletePersistedSession = (sessionId: string, workspaceId: string) =>
  invokeCommand<unknown>("delete_persisted_session", { session_id: sessionId, workspace_id: workspaceId });

export const forkSession = (sourceSessionId: string, sourceTurnId: string, workspaceId: string) =>
  invokeCommand<unknown>("fork_session", {
    source_session_id: sourceSessionId,
    source_turn_id: sourceTurnId,
    workspace_id: workspaceId,
  });

/**
 * The whole `SessionMetadata` a `save_session_metadata` request carries, built
 * from the catalogue row with every field the host stored kept as it was (the
 * desktop sends its full record too). A row this surface only knows from an event
 * may lack required fields; those get neutral values, which the host never
 * writes because it merges only the named `fields`.
 */
export function sessionMetadataForSave(
  row: (SessionSummary & Record<string, unknown>) | null | undefined,
  patch: { sessionId: string; sessionName: string; agentType?: string },
): Record<string, unknown> {
  const now = Date.now();
  const source: Record<string, unknown> = { ...(row ?? {}) };
  // Fields this surface adds while normalizing are not part of the host record.
  delete source.persistedStatus;
  delete source.lastUpdated;
  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const status = source.status === "archived" || source.status === "completed" ? source.status : "active";
  return {
    ...source,
    sessionId: patch.sessionId,
    sessionName: patch.sessionName,
    agentType:
      typeof source.agentType === "string" && source.agentType ? source.agentType : patch.agentType ?? "Standard",
    modelName: typeof source.modelName === "string" ? source.modelName : "",
    createdAt: num(source.createdAt, now),
    lastActiveAt: num(source.lastActiveAt, num(row?.lastUpdated, now)),
    turnCount: num(source.turnCount, 0),
    messageCount: num(source.messageCount, 0),
    toolCallCount: num(source.toolCallCount, 0),
    status,
  };
}

/** `copy_session` answers `SessionLineageCopyResult` in camelCase; older builds used snake_case. */
export interface CopiedSession {
  sessionId?: string;
  sessionName?: string;
  agentType?: string;
  session_id?: string;
  session_name?: string;
  agent_type?: string;
}

/** Copies a session with its transcript into a new one, without changing the original. */
export const copySession = (sourceSessionId: string, workspaceId: string) =>
  invokeCommand<CopiedSession>("copy_session", {
    source_session_id: sourceSessionId,
    workspace_id: workspaceId,
  });

/**
 * Persists the display name; the host merges the fields it is told changed.
 * `metadata` must deserialize as a whole Rust `SessionMetadata` (agentType,
 * modelName, createdAt, lastActiveAt, turnCount, messageCount, toolCallCount and
 * status are required), even though only `fields` are merged — use
 * `sessionMetadataForSave` to build it from the catalogue row.
 */
export const saveSessionName = (metadata: Record<string, unknown>, workspaceId: string) =>
  invokeCommand<unknown>("save_session_metadata", {
    metadata,
    fields: ["sessionName"],
    workspace_id: workspaceId,
  });

/**
 * Drops `targetTurnId` and every turn after it (and restores the files those
 * turns changed), which is the first half of the desktop's edit-and-rerun.
 * `requireIdle` asks the host to refuse while a turn runs instead of cancelling
 * it; `workspacePath` is the path older hosts resolve the workspace from.
 */
export const rollbackSessionToTurn = (request: {
  sessionId: string;
  targetTurnId: string;
  workspaceId: string;
  workspacePath?: string;
}) =>
  invokeCommand<{ status?: string; retiredTurnIds?: string[]; restoredFiles?: string[] }>(
    "rollback_session_to_turn",
    {
      sessionId: request.sessionId,
      targetTurnId: request.targetTurnId,
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath ?? "",
      requireIdle: true,
    },
  );

/**
 * Resumes a turn the runtime interrupted (`DialogTurnData.recovery.status ==
 * "interrupted"`). `executionGeneration` is the one the persisted record names,
 * so a resume another surface already started is refused instead of doubled.
 */
export const recoverInterruptedDialogTurn = (request: {
  sessionId: string;
  dialogTurnId: string;
  executionGeneration: number;
  workspaceId?: string;
  workspacePath?: string;
}) => invokeCommand<unknown>("recover_interrupted_dialog_turn", request);

// Turn and session policy (wave 3 session). The host decides what a message
// written during a turn does, which modes a session may switch to, which slash
// commands exist, how a turn stops and which sessions are unread.

export interface SubmitUserMessageResult {
  outcome: "started" | "steered" | "queued";
  turnId: string;
  queueItemId?: string;
  steeringId?: string;
}

export const submitUserMessage = (request: {
  sessionId: string;
  workspaceId?: string;
  text: string;
  displayText?: string;
  agentType?: string;
  attachments?: Array<Record<string, unknown>>;
  turnId?: string;
  /** An explicit choice for this message; omitted, the host's stored policy applies. */
  sendDuringTurn?: "immediate" | "queue";
}) => invokeCommand<SubmitUserMessageResult>("submit_user_message", request);

export interface SessionModeCatalogEntry {
  id: string;
  label: string;
  description: string;
  profile: boolean;
  switchable: boolean;
}

export interface SessionModeCatalog {
  entries: SessionModeCatalogEntry[];
  defaultModeId: string;
  sessionModeId?: string;
  sessionStarted?: boolean;
}

export const getSessionModeCatalog = (request: {
  workspaceId?: string;
  workspacePath?: string;
  sessionId?: string;
}) => invokeCommand<SessionModeCatalog>("get_session_mode_catalog", request);

export interface SessionCommandDescriptor {
  id: string;
  command: string;
  labelKey: string;
  description: string;
  idleOnly: boolean;
  available: boolean;
  args?: string[];
}

export const listSessionCommands = (sessionId: string | null) =>
  invokeCommand<SessionCommandDescriptor[]>("list_session_commands", sessionId ? { sessionId } : {});

export const executeSessionCommand = (request: {
  sessionId: string;
  id: string;
  arg?: string;
  workspaceId?: string;
}) => invokeCommand<{ id: string; outcome: string; turnId?: string }>("execute_session_command", request);

export const stopDialogTurn = (sessionId: string, dialogTurnId?: string) =>
  invokeCommand<{ turnId: string; method: string }>("stop_dialog_turn", {
    sessionId,
    ...(dialogTurnId ? { dialogTurnId } : {}),
  });

export const markSessionSeenOnHost = (request: {
  sessionId: string;
  workspaceId?: string;
  seenThroughMs?: number;
}) => invokeCommand<{ changed: boolean }>("mark_session_seen", request);

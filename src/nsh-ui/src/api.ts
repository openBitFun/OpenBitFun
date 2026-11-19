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

export const openWorkspace = (rootPath: string) =>
  invokeCommand<WorkspaceRecord>("open_workspace", { path: rootPath });

export const setActiveWorkspace = (workspaceId: string) =>
  invokeCommand<unknown>("set_active_workspace", { workspaceId });

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
  return {
    ...page,
    sessions: Array.isArray(page?.sessions) ? page.sessions.map(normalizeSessionSummary) : [],
  };
};

export const loadSessionTurns = (sessionId: string, workspaceId: string) =>
  invokeCommand<unknown[]>("load_session_turns", {
    session_id: sessionId,
    workspace_id: workspaceId,
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
  options: { searchContent?: boolean } = {},
) =>
  invokeCommand<unknown[]>("search_files", {
    workspaceId,
    pattern,
    searchContent: options.searchContent === true,
    searchId: `nsh-files-${Date.now()}`,
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
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
}

export interface ModelCatalog {
  version?: number;
  models: ModelCatalogEntry[];
  default_models?: {
    primary?: string | null;
    fast?: string | null;
    [role: string]: string | null | undefined;
  };
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

/** What a session's next turn is bound to, including its reasoning setting. */
export const getSessionModelTarget = (request: {
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
}) =>
  invokeCommand<{
    sessionId: string;
    selection: { kind: string; model_ref?: string; pool_id?: string };
    /** Absent on a host older than this field, which is not the same as `null`. */
    reasoningPreset?: string | null;
  }>("get_session_model_target", request);

/** Session lifecycle and row actions; sessions address a workspace by `workspace_id`. */
export const createSession = (request: {
  sessionId?: string;
  sessionName: string;
  agentType: string;
  workspacePath?: string;
  workspaceId?: string;
}) => invokeCommand<{ sessionId: string; sessionName: string; agentType: string }>("create_session", request);

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

export interface CopiedSession {
  session_id: string;
  session_name: string;
  agent_type: string;
}

/** Copies a session with its transcript into a new one, without changing the original. */
export const copySession = (sourceSessionId: string, workspaceId: string) =>
  invokeCommand<CopiedSession>("copy_session", {
    source_session_id: sourceSessionId,
    workspace_id: workspaceId,
  });

/** Persists the display name; the host merges the fields it is told changed. */
export const saveSessionName = (metadata: Record<string, unknown>, workspaceId: string) =>
  invokeCommand<unknown>("save_session_metadata", {
    metadata,
    fields: ["sessionName"],
    workspace_id: workspaceId,
  });

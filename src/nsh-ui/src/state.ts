// Application state. NSH components run once, so the store is plain signals and
// the loaders below; a change re-runs only the bindings that read that signal.

import { computed, signal } from "nsh";
import { attachmentContexts, clearAttachments } from "./attachmentStore";
import { invokeCommand, listenEvent } from "./bridge";
import {
  currentLocale,
  loadAppLocale,
  setAppLocale,
  syncLocaleFromHost,
  type AppLocale,
} from "./i18n";
import { resetPermissions } from "./permissionStore";
import { markSessionSeen } from "./sessionStatusStore";
import { loadQuestionMailbox, resetQuestionPrompts } from "./userQuestionStore";
import {
  archiveSession,
  cancelDialogTurn,
  copySession,
  createSession,
  deletePersistedSession,
  forkSession,
  getOpenedWorkspaces,
  getRecentWorkspaces,
  interruptDialogTurn,
  listSessions,
  loadSessionTurns,
  normalizeSessionSummary,
  openWorkspace,
  saveSessionName,
  setActiveWorkspace,
  startDialogTurn,
  steerDialogTurn,
  unarchiveSession,
  updateSessionMode,
  type SessionSummary,
  type WorkspaceRecord,
} from "./api";

export type SceneId =
  | "home"
  | "sessions"
  | "assistants"
  | "agents"
  | "skills"
  | "routines"
  | "files"
  | "git"
  | "terminal"
  | "spaces"
  | "devices"
  | "settings";

export type AuxPaneTab = "files" | "git" | "terminal";
export type AuxPaneSide = "right" | "left";
export type SessionGrouping = "grouped" | "flat";

export const activeScene = signal<SceneId>("sessions");
export const drawerOpen = signal(true);

export function toggleDrawer(): void {
  drawerOpen.update(v => !v);
}

/** Navigation history across scenes (`NavBar` back/forward). */
export const navHistory = signal<SceneId[]>(["sessions"]);
export const navIndex = signal(0);
export const canGoBack = computed(() => navIndex() > 0);
export const canGoForward = computed(() => navIndex() < navHistory().length - 1);

/** Open scene tabs shown in `SceneBar`. */
export const openSceneTabs = signal<SceneId[]>(["sessions"]);

export function openSceneTab(scene: SceneId): void {
  if (!openSceneTabs().includes(scene)) {
    openSceneTabs.update(tabs => [...tabs, scene]);
  }
  activeScene.set(scene);
}

export function closeSceneTab(scene: SceneId): void {
  const currentTabs = openSceneTabs();
  if (currentTabs.length <= 1) return;
  const idx = currentTabs.indexOf(scene);
  const remaining = currentTabs.filter(tab => tab !== scene);
  openSceneTabs.set(remaining);
  if (activeScene() === scene) {
    const nextScene = remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? "sessions";
    navigateScene(nextScene);
  }
}

export function navigateScene(scene: SceneId): void {
  openSceneTab(scene);
  const history = navHistory();
  const idx = navIndex();
  if (history[idx] === scene) return;
  const next = [...history.slice(0, idx + 1), scene];
  navHistory.set(next);
  navIndex.set(next.length - 1);
}

export function goBackScene(): void {
  const idx = navIndex();
  if (idx <= 0) return;
  const nextIdx = idx - 1;
  const target = navHistory()[nextIdx];
  if (!target) return;
  navIndex.set(nextIdx);
  openSceneTab(target);
}

export function goForwardScene(): void {
  const history = navHistory();
  const idx = navIndex();
  if (idx >= history.length - 1) return;
  const nextIdx = idx + 1;
  const target = history[nextIdx];
  if (!target) return;
  navIndex.set(nextIdx);
  openSceneTab(target);
}

/** Right/left auxiliary workbench pane state (`WorkbenchLayout` / `AuxPane`). */
export const AUX_MIN_WIDTH = 280;
export const AUX_MAX_WIDTH = 760;
export const auxPaneOpen = signal(false);
export const auxPaneTab = signal<AuxPaneTab>("files");
export const auxPaneWidth = signal(460);
export const auxPaneMaximized = signal(false);
export const auxPaneSide = signal<AuxPaneSide>("right");
export const auxSelectedFilePath = signal<string | null>(null);

export function setAuxPaneWidth(width: number): void {
  const clamped = Math.max(AUX_MIN_WIDTH, Math.min(AUX_MAX_WIDTH, Math.round(width)));
  auxPaneWidth.set(clamped);
}

export function openInAuxPane(tab: AuxPaneTab, filePath?: string | null): void {
  auxPaneTab.set(tab);
  if (filePath !== undefined) {
    auxSelectedFilePath.set(filePath);
  }
  auxPaneOpen.set(true);
}

export function toggleAuxPane(): void {
  const next = !auxPaneOpen();
  auxPaneOpen.set(next);
  if (!next) auxPaneMaximized.set(false);
}

export function setAuxPaneMaximized(maximized?: boolean): void {
  const next = typeof maximized === "boolean" ? maximized : !auxPaneMaximized();
  auxPaneMaximized.set(next);
  if (next && !auxPaneOpen()) {
    auxPaneOpen.set(true);
  }
}

export function swapAuxPanes(): void {
  auxPaneSide.update(side => (side === "right" ? "left" : "right"));
}

/** Left NavPanel width & session tree grouping. */
export const NAV_MIN_WIDTH = 216;
export const NAV_MAX_WIDTH = 420;
export const navWidth = signal(272);
export const sessionGrouping = signal<SessionGrouping>("grouped");

export function setNavWidth(width: number): void {
  const clamped = Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, Math.round(width)));
  navWidth.set(clamped);
}

export const workspaces = signal<WorkspaceRecord[]>([]);
export const activeWorkspaceId = signal<string | null>(null);
export const sessions = signal<SessionSummary[]>([]);
export const sessionTotal = signal(0);
export const activeSessionId = signal<string | null>(null);
export const sessionTurns = signal<unknown[]>([]);
export const busy = signal(false);
export const lastError = signal<string | null>(null);

export const activeWorkspace = computed(
  () => workspaces().find(item => item.id === activeWorkspaceId()) ?? null,
);

export const activeWorkspaceRoot = computed(() => activeWorkspace()?.rootPath ?? "");

export const activeSession = computed(
  () => sessions().find(item => item.sessionId === activeSessionId()) ?? null,
);

function reportError(error: unknown): void {
  lastError.set(error instanceof Error ? error.message : String(error));
}

export function clearError(): void {
  lastError.set(null);
}

export { reportError };

const workspaceChangedHandlers = new Set<() => void>();

/**
 * Lets any store that depends on the active workspace drop its cache.
 * Supports multiple independent listeners and returns an unsubscribe handle.
 */
export function onWorkspaceChanged(handler: () => void): () => void {
  workspaceChangedHandlers.add(handler);
  return () => {
    workspaceChangedHandlers.delete(handler);
  };
}

function notifyWorkspaceChanged(): void {
  for (const handler of [...workspaceChangedHandlers]) {
    try {
      handler();
    } catch {
      // One store's cleanup must not block others.
    }
  }
}

const streamClearedHandlers = new Set<() => void>();

/** Lets `agentEvents` reset live round/tool state whenever streamed text is cleared. */
export function onStreamCleared(handler: () => void): () => void {
  streamClearedHandlers.add(handler);
  return () => {
    streamClearedHandlers.delete(handler);
  };
}

/** True when a session metadata row is archived (supports both Rust `status` and fixture `persistedStatus`). */
export function isSessionArchived(meta: SessionSummary | null | undefined): boolean {
  if (!meta) return false;
  return meta.persistedStatus === "archived" || meta.status === "archived";
}

/** Most recent activity timestamp in ms (supports Rust `lastActiveAt` and fixture `lastUpdated`). */
export function sessionLastActivityMs(meta: SessionSummary | null | undefined): number | undefined {
  if (!meta) return undefined;
  if (typeof meta.lastActiveAt === "number" && Number.isFinite(meta.lastActiveAt)) return meta.lastActiveAt;
  if (typeof meta.lastUpdated === "number" && Number.isFinite(meta.lastUpdated)) return meta.lastUpdated;
  if (typeof meta.createdAt === "number" && Number.isFinite(meta.createdAt)) return meta.createdAt;
  return undefined;
}

/** Patches one session's display title in-place (used by live `session_title_generated` events). */
export function patchSessionTitle(sessionId: string, title: string): void {
  const next = title.trim();
  if (!sessionId || !next) return;
  sessions.update(current => {
    let changed = false;
    const updated = current.map(item => {
      if (item.sessionId !== sessionId || item.sessionName === next) return item;
      changed = true;
      return { ...item, sessionName: next };
    });
    return changed ? updated : current;
  });
}

/** Upserts a session reported by `agentic://session-created` without reloading the catalog. */
export function upsertSessionFromEvent(summary: SessionSummary): void {
  if (!summary.sessionId) return;
  const normalized = normalizeSessionSummary(summary);
  sessions.update(current => {
    const idx = current.findIndex(item => item.sessionId === normalized.sessionId);
    if (idx >= 0) {
      const next = [...current];
      next[idx] = { ...next[idx], ...normalized };
      return next;
    }
    sessionTotal.update(total => total + 1);
    return [normalized, ...current];
  });
}

/** Removes a session reported by `agentic://session-deleted`. */
export function removeSessionFromEvent(sessionId: string): void {
  if (!sessionId) return;
  const existed = sessions().some(item => item.sessionId === sessionId);
  if (existed) {
    sessions.update(current => current.filter(item => item.sessionId !== sessionId));
    sessionTotal.update(total => Math.max(0, total - 1));
  }
  openSessionIds.set(openSessionIds().filter(id => id !== sessionId));
  if (activeSessionId() === sessionId) {
    activeSessionId.set(null);
    sessionTurns.set([]);
    clearPendingTurn(sessionId);
    clearStreamedText();
  }
}

let activeStepCount = 0;

/**
 * Runs an async step with a ref-counted busy flag and error surface so
 * concurrent or background IPCs never clobber `busy` or wipe active errors.
 */
export async function runStep(
  step: () => Promise<void>,
  options?: { trackBusy?: boolean; clearError?: boolean },
): Promise<void> {
  const trackBusy = options?.trackBusy !== false;
  if (trackBusy) {
    activeStepCount += 1;
    busy.set(true);
  }
  if (options?.clearError !== false && activeStepCount <= 1) {
    lastError.set(null);
  }
  try {
    await step();
  } catch (error) {
    reportError(error);
  } finally {
    if (trackBusy) {
      activeStepCount = Math.max(0, activeStepCount - 1);
      if (activeStepCount === 0) busy.set(false);
    }
  }
}

export async function loadWorkspaces(): Promise<void> {
  await runStep(async () => {
    const [opened, recent] = await Promise.all([
      getOpenedWorkspaces().catch(() => [] as WorkspaceRecord[]),
      getRecentWorkspaces(),
    ]);
    const merged: WorkspaceRecord[] = [];
    for (const record of [...opened, ...recent]) {
      if (!record?.id || merged.some(item => item.id === record.id)) continue;
      merged.push(record);
    }
    workspaces.set(merged);
    const current = activeWorkspaceId();
    if (!current && merged.length > 0) {
      selectWorkspace(merged[0].id);
    }
  });
}

/**
 * Drops every cached fact about the machine this surface was reading, then
 * reloads the workspace list from the host it now reads. Peer Device Mode calls
 * this on the way in and out so a peer's sessions are never drawn from the other
 * machine's records.
 */
export async function resetForDeviceChange(): Promise<void> {
  activeWorkspaceId.set(null);
  activeSessionId.set(null);
  openSessionIds.set([]);
  sessions.set([]);
  sessionTurns.set([]);
  sessionCursor.set(null);
  sessionHasMore.set(false);
  sessionTotal.set(0);
  runningTurnId.set(null);
  runningTurns.set({});
  clearStreamedText();
  clearPendingTurn();
  turnError.set("");
  workspaces.set([]);
  // The agents this surface bound belong to the sessions of the machine it left.
  sessionAgentTypes.set({});
  resetPermissions();
  resetQuestionPrompts();
  notifyWorkspaceChanged();
  await loadWorkspaces();
}

export function selectWorkspace(workspaceId: string): void {
  if (activeWorkspaceId() === workspaceId) return;
  activeWorkspaceId.set(workspaceId);
  activeSessionId.set(null);
  sessionTurns.set([]);
  sessions.set([]);
  sessionCursor.set(null);
  runningTurnId.set(null);
  clearPendingTurn();
  clearStreamedText();
  notifyWorkspaceChanged();
  void setActiveWorkspace(workspaceId).catch(() => undefined);
  void loadSessions();
}

export async function openPathWorkspace(rootPath: string): Promise<void> {
  const trimmed = rootPath.trim();
  if (!trimmed) return;
  await runStep(async () => {
    const record = await openWorkspace(trimmed);
    await loadWorkspaces();
    if (record?.id) {
      if (!workspaces().some(item => item.id === record.id)) {
        workspaces.update(current => [record, ...current]);
      }
      selectWorkspace(record.id);
    }
  });
}

export async function closeWorkspace(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  await runStep(async () => {
    await invokeCommand<unknown>("close_workspace", { workspaceId });
    const remaining = workspaces().filter(item => item.id !== workspaceId);
    workspaces.set(remaining);
    if (activeWorkspaceId() === workspaceId) {
      const next = remaining[0] ?? null;
      activeWorkspaceId.set(null);
      activeSessionId.set(null);
      sessionTurns.set([]);
      sessions.set([]);
      sessionCursor.set(null);
      runningTurnId.set(null);
      clearPendingTurn();
      clearStreamedText();
      notifyWorkspaceChanged();
      if (next) {
        selectWorkspace(next.id);
      }
    }
  });
}

export const sessionCursor = signal<string | null>(null);
export const sessionHasMore = signal(false);

export async function loadSessions(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    const page = await listSessions(workspaceId, 50);
    if (activeWorkspaceId() !== workspaceId) return;
    sessions.set(page.sessions ?? []);
    sessionTotal.set(page.totalTopLevelCount ?? page.sessions?.length ?? 0);
    sessionCursor.set(page.nextCursor ?? null);
    sessionHasMore.set(page.hasMore === true);
    if (!activeSessionId() && page.sessions?.length) {
      selectSession(page.sessions[0].sessionId);
    }
  });
}

/**
 * Silently refreshes session metadata (titles, message counts, timestamps)
 * after turns settle without toggling global `busy` or clearing visible errors.
 */
export async function refreshSessionsSilently(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  try {
    const limit = Math.max(50, sessions().length);
    const page = await listSessions(workspaceId, limit);
    if (activeWorkspaceId() !== workspaceId) return;
    const incoming = page.sessions ?? [];
    if (!incoming.length && sessions().length > 0 && page.totalTopLevelCount === undefined) return;
    sessions.set(incoming);
    if (typeof page.totalTopLevelCount === "number") {
      sessionTotal.set(page.totalTopLevelCount);
    }
    sessionCursor.set(page.nextCursor ?? null);
    sessionHasMore.set(page.hasMore === true);
  } catch {
    // Silent background metadata refresh never interrupts active chat.
  }
}

/** Appends the next catalogue page; the cursor is the host's, not a row offset. */
export async function loadMoreSessions(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const cursor = sessionCursor();
  if (!workspaceId || !cursor) return;
  await runStep(async () => {
    const page = await listSessions(workspaceId, 50, cursor);
    const known = new Set(sessions().map(item => item.sessionId));
    const extra = (page.sessions ?? []).filter(item => !known.has(item.sessionId));
    sessions.set([...sessions(), ...extra]);
    sessionCursor.set(page.nextCursor ?? null);
    sessionHasMore.set(page.hasMore === true);
    sessionTotal.set(page.totalTopLevelCount ?? sessions().length);
  });
}

/** Sessions the user opened, in the order the tab strip shows them. */
export const openSessionIds = signal<string[]>([]);

export function selectSession(sessionId: string): void {
  const previous = activeSessionId();
  activeSessionId.set(sessionId);
  if (!openSessionIds().includes(sessionId)) openSessionIds.update(ids => [...ids, sessionId]);
  if (previous !== sessionId) {
    sessionTurns.set([]);
    clearPendingTurn();
    clearStreamedText();
    turnError.set("");
  }
  runningTurnId.set(runningTurns()[sessionId] ?? null);
  // Opening a session is what makes it read; its row compares against this stamp.
  const row = sessions().find(item => item.sessionId === sessionId);
  markSessionSeen(sessionId, sessionLastActivityMs(row));
  void loadTurns(sessionId);
  // A question asked before this surface looked at the session has no event left
  // to replay, so the host's mailbox is read on every open.
  void loadQuestionMailbox(sessionId);
}

/** Closes one tab; the neighbour takes over when the closed tab was on screen. */
export function closeSessionTab(sessionId: string): void {
  const remaining = openSessionIds().filter(id => id !== sessionId);
  openSessionIds.set(remaining);
  if (activeSessionId() !== sessionId) return;
  const fallback = remaining[remaining.length - 1];
  activeSessionId.set(null);
  sessionTurns.set([]);
  runningTurnId.set(null);
  clearPendingTurn();
  clearStreamedText();
  if (fallback) selectSession(fallback);
}

export async function loadTurns(
  sessionId: string,
  options?: { silent?: boolean },
): Promise<unknown[] | null> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  let loaded: unknown[] | null = null;
  await runStep(
    async () => {
      const turns = await loadSessionTurns(sessionId, workspaceId);
      if (activeSessionId() !== sessionId) return;
      const list = Array.isArray(turns) ? turns : [];
      sessionTurns.set(list);
      reconcilePendingTurnWithPersisted(sessionId, list);
      loaded = list;
    },
    options?.silent ? { trackBusy: false, clearError: false } : undefined,
  );
  return loaded;
}

export interface PendingTurnState {
  sessionId: string;
  turnId?: string;
  userText: string;
  createdAt: number;
  baselineTurnCount: number;
}

/** Structured optimistic turn kept alive from send until persisted turns replace it. */
export const pendingTurnState = signal<PendingTurnState | null>(null);
/** The user's in-flight turn text, shown under the transcript while it streams. */
export const pendingTurn = signal<string>("");
export const turnError = signal<string>("");
/** Assistant text streamed by the running turn, cleared once persisted turns settle. */
export const streamText = signal<string>("");
/**
 * The reasoning a model streams before its answer. The host sends it on the same
 * `agentic://text-chunk` event with `contentType: "thinking"`, so it is kept apart
 * here: drawing it as the reply would put the model's notes where its answer goes.
 */
export const thinkingText = signal<string>("");

export function setPendingTurn(sessionId: string, userText: string, turnId?: string): void {
  const trimmed = userText.trim();
  if (!sessionId || !trimmed) return;
  pendingTurnState.set({
    sessionId,
    ...(turnId ? { turnId } : {}),
    userText: trimmed,
    createdAt: Date.now(),
    baselineTurnCount: sessionTurns().length,
  });
  if (activeSessionId() === sessionId) {
    pendingTurn.set(trimmed);
  }
}

export function bindPendingTurnId(sessionId: string, turnId: string, userText?: string): void {
  const current = pendingTurnState();
  if (current && current.sessionId === sessionId) {
    pendingTurnState.set({
      ...current,
      turnId,
      ...(userText && !current.userText ? { userText } : {}),
    });
    if (activeSessionId() === sessionId && pendingTurn() !== (current.userText || userText || "")) {
      pendingTurn.set(current.userText || userText || "");
    }
    return;
  }
  if (userText && userText.trim()) {
    setPendingTurn(sessionId, userText, turnId);
  }
}

export function clearPendingTurn(sessionId?: string): void {
  const current = pendingTurnState();
  if (sessionId && current && current.sessionId !== sessionId) return;
  pendingTurnState.set(null);
  if (!sessionId || activeSessionId() === sessionId) {
    pendingTurn.set("");
  }
}

function reconcilePendingTurnWithPersisted(sessionId: string, turns: unknown[]): void {
  const pending = pendingTurnState();
  if (!pending || pending.sessionId !== sessionId) return;
  if (pending.turnId) {
    const matched = turns.some(entry => {
      if (!entry || typeof entry !== "object") return false;
      const rec = entry as Record<string, unknown>;
      return rec.turnId === pending.turnId || rec.turn_id === pending.turnId || rec.id === pending.turnId;
    });
    if (matched) {
      clearPendingTurn(sessionId);
    }
    return;
  }
  // When `turnId` was not yet received (e.g. hosts that don't emit
  // `dialog-turn-started` before persisting), clear once a new turn with the
  // matching user prompt lands on disk.
  if (turns.length > pending.baselineTurnCount) {
    const newest = turns[turns.length - 1];
    const rec = newest && typeof newest === "object" ? (newest as Record<string, unknown>) : null;
    const userMsg = (rec?.userMessage ?? rec?.user_message) as Record<string, unknown> | undefined;
    const content = typeof userMsg?.content === "string" ? userMsg.content.trim() : "";
    if (!content || content === pending.userText) {
      clearPendingTurn(sessionId);
    }
  }
}

/** Forgets what the running turn streamed; the persisted turns are the record after it. */
export function clearStreamedText(): void {
  streamText.set("");
  thinkingText.set("");
  for (const handler of [...streamClearedHandlers]) {
    try {
      handler();
    } catch {
      // Never block stream cleanup.
    }
  }
}
/** The turn the host reported as running, so the composer can stop it. */
export const runningTurnId = signal<string | null>(null);
/**
 * Session id → the turn running in it. The rows need this for every session, not
 * only the selected one, because a workspace can run several at a time.
 */
export const runningTurns = signal<Record<string, string>>({});
/** The composer's current text. */
export const composerText = signal<string>("");

/**
 * Starts a dialog turn on the selected session. The reply is not awaited here:
 * `start_dialog_turn` returns immediately once Rust spawns the task, so the
 * optimistic `pendingTurn` stays visible across TTFT and streaming until
 * persisted turns settle (never flashing back to the empty Welcome Studio!).
 */
export async function sendTurn(text: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const sessionId = activeSessionId();
  const body = text.trim();
  if (!workspaceId || !sessionId || !body) return;
  turnError.set("");
  const attachments = attachmentContexts();
  const runningTurn = runningTurnId();
  if (runningTurn) {
    await steerTurn(sessionId, runningTurn, body, attachments);
    return;
  }
  clearStreamedText();
  setPendingTurn(sessionId, body);
  await runStep(async () => {
    try {
      await startDialogTurn({
        sessionId,
        userInput: body,
        agentType: agentTypeOf(sessionId),
        workspaceId,
        ...(activeWorkspaceRoot() ? { workspacePath: activeWorkspaceRoot() } : {}),
        ...(attachments.length ? { imageContexts: attachments } : {}),
      });
      composerText.set("");
      clearAttachments();
      // Keep `pendingTurn` & `pendingTurnState` alive until `loadTurns()`
      // reconciles the persisted turn (eliminates Welcome Studio flash on send).
    } catch (error) {
      clearPendingTurn(sessionId);
      turnError.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/**
 * Injects the composer's text into the running turn. The transcript is reloaded
 * afterwards so the steering message appears where the host recorded it.
 */
async function steerTurn(
  sessionId: string,
  dialogTurnId: string,
  body: string,
  attachments: Array<ReturnType<typeof attachmentContexts>[number]>,
): Promise<void> {
  await runStep(async () => {
    try {
      await steerDialogTurn({
        sessionId,
        dialogTurnId,
        content: body,
        displayContent: body,
        ...(attachments.length ? { imageContexts: attachments } : {}),
      });
      composerText.set("");
      clearAttachments();
      await loadTurns(sessionId);
    } catch (error) {
      turnError.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/**
 * Stops the turn the host reported as running. Interruption is asked for first
 * and hard cancellation is the fallback, mirroring the React surface: a runtime
 * without an interruption surface for this session must still stop.
 */
export async function stopRunningTurn(): Promise<void> {
  const sessionId = activeSessionId();
  const turnId = runningTurnId();
  if (!sessionId || !turnId) return;
  await runStep(async () => {
    try {
      await interruptDialogTurn(sessionId, turnId);
    } catch {
      await cancelDialogTurn(sessionId, turnId);
    }
    runningTurnId.set(null);
    runningTurns.update(current => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    await loadTurns(sessionId, { silent: true });
    clearStreamedText();
    clearPendingTurn(sessionId);
  });
}

/** The agent a new session starts as when nothing else was chosen here. */
export const DEFAULT_AGENT_TYPE = "Standard";

/** The agent a session created from this surface starts as. */
export const chosenAgentType = signal<string>(DEFAULT_AGENT_TYPE);

/** Session id → the agent this surface bound, ahead of the host's next catalogue read. */
export const sessionAgentTypes = signal<Record<string, string>>({});

/**
 * The agent a session runs as: what this surface bound, else the agent the host
 * recorded for it, else the one the composer is on. Reading the host's own record
 * is what keeps a session created on the desktop on the agent it ran as there.
 */
export function agentTypeOf(sessionId: string | null): string {
  if (!sessionId) return chosenAgentType();
  const bound = sessionAgentTypes()[sessionId];
  if (bound) return bound;
  const stored = sessions().find(row => row.sessionId === sessionId)?.agentType;
  return stored && stored.trim() ? stored.trim() : chosenAgentType();
}

/**
 * Whether a session already ran a turn, from the only proof the host gives: its
 * message count. A row without one counts as started, the same caution the desktop
 * applies to a metadata-only projection — an empty session is never assumed.
 */
export function sessionStarted(sessionId: string | null): boolean {
  if (!sessionId) return false;
  const row = sessions().find(item => item.sessionId === sessionId);
  if (!row) return true;
  return row.messageCount === undefined || row.messageCount > 0;
}

export async function createSessionInWorkspace(
  name: string,
  agentType: string = chosenAgentType(),
): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    const created = await createSession({
      sessionName: name,
      agentType,
      workspaceId,
      ...(activeWorkspaceRoot() ? { workspacePath: activeWorkspaceRoot() } : {}),
    });
    // The row the catalogue returns carries the binding too, but the composer has
    // to agree with the answer that created the session before that read lands.
    if (created?.sessionId) {
      const bound = created.agentType || agentType;
      sessionAgentTypes.update(current => ({ ...current, [created.sessionId]: bound }));
    }
    await loadSessions();
    if (created?.sessionId) selectSession(created.sessionId);
  });
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    await saveSessionName({ sessionId, sessionName: name }, workspaceId);
    sessions.update(current =>
      current.map(item => (item.sessionId === sessionId ? { ...item, sessionName: name } : item)),
    );
  });
}

export async function archiveSessionRow(sessionId: string, archived: boolean): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    if (archived) {
      await archiveSession(sessionId, workspaceId);
    } else {
      await unarchiveSession(sessionId, workspaceId);
    }
    // An archived session keeps its row so the archived list can restore it.
    const nextStatus = archived ? "archived" : "active";
    sessions.update(current =>
      current.map(item =>
        item.sessionId === sessionId
          ? { ...item, status: nextStatus, persistedStatus: nextStatus }
          : item,
      ),
    );
    if (archived) {
      // An archived session leaves the tab strip with its header actions.
      openSessionIds.set(openSessionIds().filter(id => id !== sessionId));
    }
    if (archived && activeSessionId() === sessionId) {
      activeSessionId.set(null);
      sessionTurns.set([]);
    }
  });
}

export async function deleteSessionRow(sessionId: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    await deletePersistedSession(sessionId, workspaceId);
    sessions.update(current => current.filter(item => item.sessionId !== sessionId));
    // The header counts the whole catalog, so a deleted row lowers it here rather
    // than waiting for a reload the user did not ask for.
    sessionTotal.update(total => Math.max(0, total - 1));
    openSessionIds.set(openSessionIds().filter(id => id !== sessionId));
    if (activeSessionId() === sessionId) {
      activeSessionId.set(null);
      sessionTurns.set([]);
    }
  });
}

/** Forks from the last loaded turn of the session, which is what the row menu offers. */
export async function forkActiveSession(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const sessionId = activeSessionId();
  if (!workspaceId || !sessionId) return;
  const turns = sessionTurns();
  const last = turns[turns.length - 1] as Record<string, unknown> | undefined;
  const turnId = typeof last?.turnId === "string" ? last.turnId : undefined;
  if (!turnId) {
    reportError("This session has no loaded turn to fork from");
    return;
  }
  await runStep(async () => {
    await forkSession(sessionId, turnId, workspaceId);
    await loadSessions();
  });
}

/** Copies the active session and its transcript, then selects the copy. */
export async function copyActiveSession(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const sessionId = activeSessionId();
  if (!workspaceId || !sessionId) return;
  await runStep(async () => {
    const copied = await copySession(sessionId, workspaceId);
    await loadSessions();
    if (copied?.session_id) await selectSession(copied.session_id);
  });
}

/**
 * Switches to Sessions, ensures an active thread matching the requested agent,
 * populates the composer, and sends the turn when prompt text is non-empty.
 */
export async function startQuickPromptInSession(
  prompt: string,
  agentType?: string,
): Promise<void> {
  navigateScene("sessions");
  const requestedAgent = agentType?.trim() || undefined;
  if (requestedAgent) chosenAgentType.set(requestedAgent);

  const currentId = activeSessionId();
  const currentAgent = agentTypeOf(currentId);
  const agentDiffers = Boolean(
    requestedAgent && currentAgent.trim().toLowerCase() !== requestedAgent.toLowerCase(),
  );

  if (!currentId || (agentDiffers && sessionStarted(currentId))) {
    await createSessionInWorkspace("New thread", requestedAgent ?? chosenAgentType());
  } else if (agentDiffers && requestedAgent) {
    const workspaceId = activeWorkspaceId();
    const workspacePath = activeWorkspaceRoot();
    try {
      await updateSessionMode({
        sessionId: currentId,
        modeId: requestedAgent,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspacePath ? { workspacePath } : {}),
        includeInternal: false,
      });
      sessionAgentTypes.update(current => ({ ...current, [currentId]: requestedAgent }));
      sessions.update(current =>
        current.map(row => (row.sessionId === currentId ? { ...row, agentType: requestedAgent } : row)),
      );
    } catch {
      await createSessionInWorkspace("New thread", requestedAgent);
    }
  }

  composerText.set(prompt);
  if (prompt.trim()) {
    await sendTurn(prompt);
  }
}

let localeSyncSubscribed = false;

/**
 * Boots the active UI locale from URL `?lang=`, local `Storage`
 * (`openbitfun.nsh.locale.v1`), or host `app.language`, and subscribes once to
 * `account://settings-applied` so cloud-synced language updates apply live.
 */
export async function initAppLocale(): Promise<AppLocale> {
  if (!localeSyncSubscribed) {
    localeSyncSubscribed = true;
    listenEvent<unknown>("account://settings-applied", () => {
      void loadAppLocale({ forceHost: true });
    });
  }
  return loadAppLocale();
}

export { currentLocale, loadAppLocale, setAppLocale, syncLocaleFromHost, type AppLocale };

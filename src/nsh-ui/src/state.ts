// Application state. NSH components run once, so the store is plain signals and
// the loaders below; a change re-runs only the bindings that read that signal.

import { computed, effect, signal, Storage, untracked } from "nsh";
import {
  attachmentContexts,
  clearAttachments,
  imageAttachments,
  type ImageAttachment,
} from "./attachmentStore";
import {
  entryDeviceId,
  fleetActive,
  invokeCommand,
  listenEvent,
  fleetHandshakePending,
  setFleetDeviceContextReader,
  settleFleetHandshake,
} from "./bridge";
import {
  fleetDeviceById,
  fleetNavigator,
  fleetSessionOwner,
  fleetSessionRow,
  fleetWorkspaceByKey,
  refreshFleetNavigator,
  startFleetStore,
} from "./fleetStore";
import type { FleetSession, FleetWorkspace, WorkspaceKey } from "./fleetTypes";
import {
  currentLocale,
  loadAppLocale,
  setAppLocale,
  syncLocaleFromHost,
  tr,
  type AppLocale,
} from "./i18n";
import { markSessionSeen, reconcileSessionReadState } from "./sessionStatusStore";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";
import { loadQuestionMailbox } from "./userQuestionStore";
import { superAgentUi } from "./productGates";
import {
  archiveSession,
  cancelDialogTurn,
  copySession,
  createSession,
  deletePersistedSession,
  forkSession,
  getWorkspaceNavigator,
  interruptDialogTurn,
  getSessionTranscriptView,
  listSessions,
  normalizeSessionSummary,
  openWorkspace,
  openWorkspaceById,
  removeRecentWorkspace,
  saveSessionName,
  sessionMetadataForSave,
  setActiveWorkspace,
  startDialogTurn,
  stopDialogTurn,
  submitUserMessage,
  unarchiveSession,
  type SubmitUserMessageResult,
  updateSessionMode,
  updateWorkspaceInfo,
  type SessionSummary,
  type SessionTranscriptView,
  type RunningTurnSnapshot,
  type TranscriptTurnView,
  type WorkspaceRecord,
} from "./api";

/**
 * Routes. `openbitfun` (the conversation), `inbox`, `sessions` (one session),
 * `all-sessions`, `device`, `library` and `settings` are the destinations of the
 * shell; `files` / `git` / `terminal` / `browser` are the workspace tools. The
 * older ids stay valid as aliases (`navigateScene` resolves them): `home` is
 * OpenBitFun, the five studio ids are Library tabs and `devices` is All sessions
 * by device.
 */
export type SceneId =
  | "openbitfun"
  | "inbox"
  | "all-sessions"
  | "device"
  | "library"
  | "home"
  | "sessions"
  | "assistants"
  | "agents"
  | "skills"
  | "routines"
  | "files"
  | "git"
  | "terminal"
  | "browser"
  | "spaces"
  | "devices"
  | "settings";

export type AuxPaneTab = "files" | "git" | "terminal" | "browser";
export type AuxPaneSide = "right" | "left";
export type SessionGrouping = "grouped" | "flat";

/**
 * The scene the app opens on: the session view (the last session of the
 * selected workspace, else a new one), or the Super Agent conversation while
 * that gate is on (`productGates.ts`).
 */
export function landingScene(): SceneId {
  return superAgentUi() ? "openbitfun" : "sessions";
}

export const activeScene = signal<SceneId>(landingScene());
export const drawerOpen = signal(true);

export function toggleDrawer(): void {
  drawerOpen.update(v => !v);
}

/** Navigation history across scenes (`NavBar` back/forward). */
export const navHistory = signal<SceneId[]>([landingScene()]);
export const navIndex = signal(0);
export const canGoBack = computed(() => navIndex() > 0);
export const canGoForward = computed(() => navIndex() < navHistory().length - 1);

/** Open scene tabs shown in `SceneBar`. */
export const openSceneTabs = signal<SceneId[]>([landingScene()]);

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

/** The Library's tabs (visual spec §4.8). */
export type LibraryTab = "assistants" | "agents" | "skills" | "spaces" | "routines";
export const LIBRARY_TABS: ReadonlyArray<LibraryTab> = ["assistants", "agents", "skills", "spaces", "routines"];
export const libraryTab = signal<LibraryTab>("assistants");

/** All sessions' two views (visual spec §4.6). */
export type AllSessionsView = "recent" | "by-device";
export const allSessionsView = signal<AllSessionsView>("recent");

/** The device the device page shows (a fleet device id; `""` = this device). */
export const devicePageId = signal<string>("");

/**
 * Resolves the older scene ids onto the current routes: `home` is the
 * OpenBitFun conversation, the five studio ids open that Library tab, and
 * `devices` opens All sessions by device.
 */
export function resolveSceneAlias(scene: SceneId): SceneId {
  switch (scene) {
    case "openbitfun":
      // The Super Agent scene is gated off (`productGates.ts`): its links land on the session view.
      return superAgentUi() ? scene : "sessions";
    case "home":
      return superAgentUi() ? "openbitfun" : "sessions";
    case "assistants":
    case "agents":
    case "skills":
    case "spaces":
    case "routines":
      libraryTab.set(scene);
      return "library";
    case "devices":
      allSessionsView.set("by-device");
      return "all-sessions";
    default:
      return scene;
  }
}

export function openLibrary(tab?: LibraryTab): void {
  if (tab) libraryTab.set(tab);
  navigateScene("library");
}

export function openAllSessions(view?: AllSessionsView): void {
  if (view) allSessionsView.set(view);
  navigateScene("all-sessions");
}

/** Opens a device's page (from a device badge, a breadcrumb or All sessions). */
export function openDevicePage(deviceId: string): void {
  devicePageId.set(deviceId);
  navigateScene("device");
}

export function navigateScene(requested: SceneId): void {
  const scene = resolveSceneAlias(requested);
  openSceneTab(scene);
  const history = navHistory();
  const idx = navIndex();
  if (history[idx] === scene) return;
  const next = [...history.slice(0, idx + 1), scene];
  navHistory.set(next);
  navIndex.set(next.length - 1);
}

/** Starts the history over at `scene` (the phone's first screen replacing the landing scene). */
export function resetNavigation(scene: SceneId): void {
  const resolved = resolveSceneAlias(scene);
  openSceneTabs.set([resolved]);
  activeScene.set(resolved);
  navHistory.set([resolved]);
  navIndex.set(0);
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
export const AUX_MIN_WIDTH = 300;
export const AUX_MAX_WIDTH = 1200;
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
export const NAV_MIN_WIDTH = 232;
export const NAV_MAX_WIDTH = 360;
export const NAV_DEFAULT_WIDTH = 264;
/** A sidebar dragged narrower than this collapses, as the desktop's does. */
export const NAV_COLLAPSE_WIDTH = 64;
export const navWidth = signal(NAV_DEFAULT_WIDTH);
export const sessionGrouping = signal<SessionGrouping>("grouped");
/** Workspace rows the user folded in the sidebar, by workspace id. */
export const collapsedWorkspaces = signal<Record<string, boolean>>({});

export function setNavWidth(width: number): void {
  const clamped = Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, Math.round(width)));
  navWidth.set(clamped);
}

/**
 * The shell's own layout (sidebar open and width, aux pane width and side,
 * session grouping, folded workspaces), kept in this surface's storage. The
 * document is read tolerantly: a missing or malformed field keeps its default,
 * so an older or newer build's document never resets the others.
 */
export const SHELL_LAYOUT_STORAGE_KEY = "openbitfun.nsh.shell-layout.v1";
let shellLayoutLoaded = false;

export async function loadShellLayout(): Promise<void> {
  try {
    const raw = await Storage.getItem(SHELL_LAYOUT_STORAGE_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      if (typeof doc.drawerOpen === "boolean") drawerOpen.set(doc.drawerOpen);
      if (typeof doc.navWidth === "number" && Number.isFinite(doc.navWidth)) setNavWidth(doc.navWidth);
      if (typeof doc.auxPaneWidth === "number" && Number.isFinite(doc.auxPaneWidth)) {
        setAuxPaneWidth(doc.auxPaneWidth);
      }
      if (doc.auxPaneSide === "left" || doc.auxPaneSide === "right") auxPaneSide.set(doc.auxPaneSide);
      if (doc.sessionGrouping === "grouped" || doc.sessionGrouping === "flat") {
        sessionGrouping.set(doc.sessionGrouping);
      }
      if (doc.collapsedWorkspaces && typeof doc.collapsedWorkspaces === "object") {
        const folded: Record<string, boolean> = {};
        for (const [id, value] of Object.entries(doc.collapsedWorkspaces as Record<string, unknown>)) {
          if (value === true) folded[id] = true;
        }
        collapsedWorkspaces.set(folded);
      }
    }
  } catch {
    // An unreadable document keeps the defaults; it is overwritten on the next change.
  } finally {
    shellLayoutLoaded = true;
  }
}

/** Writes the current layout; called from an effect in the shell. */
export function persistShellLayout(): void {
  const doc = {
    drawerOpen: drawerOpen(),
    navWidth: navWidth(),
    auxPaneWidth: auxPaneWidth(),
    auxPaneSide: auxPaneSide(),
    sessionGrouping: sessionGrouping(),
    collapsedWorkspaces: collapsedWorkspaces(),
  };
  // Never write before the stored document was read, or launch defaults win.
  if (!shellLayoutLoaded) return;
  void Storage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify(doc)).catch(() => undefined);
}

export const workspaces = signal<WorkspaceRecord[]>([]);
/**
 * The selected workspace anywhere on the account. Workspace ids are unique per
 * device only, so the device is part of the key. On a connection without the
 * fleet layer the device is always `""` (one backend, one device).
 */
export const activeWorkspaceKey = signal<WorkspaceKey | null>(null);
/** The selected workspace's id (read-only; select through `selectWorkspace`). */
export const activeWorkspaceId = computed<string | null>(() => activeWorkspaceKey()?.workspaceId ?? null);
/**
 * The device context: the device of the selected workspace, else the entry the
 * UI is connected through. Settings, models, files, git, terminals and every
 * command without an owner run there. `""` without the fleet layer.
 */
/** A device picked with no workspace of it selected yet (fleet only). */
const selectedDevice = signal<string | null>(null);
export const deviceContext = computed<string>(() => {
  if (!fleetActive()) return "";
  return activeWorkspaceKey()?.deviceId || selectedDevice() || entryDeviceId() || "";
});
/** Same as `deviceContext`; the device the selected workspace belongs to. */
export const activeDeviceId = deviceContext;
setFleetDeviceContextReader(() => deviceContext() || null);
export const sessions = signal<SessionSummary[]>([]);
export const sessionTotal = signal(0);
export const activeSessionId = signal<string | null>(null);
/** The device of the open session (`""` without the fleet layer). */
export const activeSessionDevice = signal<string>("");

/** The key of a session anywhere on the account: `"<deviceId>/<sessionId>"`. */
export function sessionKey(sessionId: string, deviceId: string = deviceOfSession(sessionId)): string {
  return `${deviceId}/${sessionId}`;
}

/** The session id of a `sessionKey`. */
export function sessionIdOfKey(key: string): string {
  const slash = key.indexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}

/** The device id of a `sessionKey` (`""` without the fleet layer). */
export function deviceIdOfKey(key: string): string {
  const slash = key.indexOf("/");
  return slash >= 0 ? key.slice(0, slash) : "";
}

/**
 * The device a session id belongs to, as far as this surface knows: the open
 * session's device, else the fleet index's owner, else the device context.
 */
export function deviceOfSession(sessionId: string | null | undefined): string {
  if (!fleetActive()) return "";
  if (sessionId && sessionId === activeSessionId() && activeSessionDevice()) return activeSessionDevice();
  return (sessionId ? fleetSessionOwner(sessionId) : null) ?? deviceContext();
}

/** The open session's key, or `null`. */
export const activeSessionKey = computed<string | null>(() => {
  const sessionId = activeSessionId();
  return sessionId ? `${activeSessionDevice()}/${sessionId}` : null;
});

function setActiveSession(sessionId: string | null, deviceId?: string): void {
  activeSessionDevice.set(sessionId ? (deviceId ?? deviceOfSession(sessionId)) : "");
  activeSessionId.set(sessionId);
}

function setActiveWorkspaceKey(workspaceId: string | null, deviceId?: string): void {
  if (!workspaceId) {
    activeWorkspaceKey.set(null);
    return;
  }
  const device = fleetActive() ? (deviceId ?? deviceContext()) : "";
  const current = activeWorkspaceKey();
  if (current && current.workspaceId === workspaceId && current.deviceId === device) return;
  activeWorkspaceKey.set({ deviceId: device, workspaceId });
}
/** The open session's turns, as the host's transcript view projects them. */
export const sessionTurns = signal<TranscriptTurnView[]>([]);
/**
 * Why the transcript cannot be shown (the host predates the transcript view);
 * empty otherwise. There is no client-side projection to fall back to.
 */
export const transcriptNotice = signal("");
/** True from selecting a session until its first `load_session_turns` answer lands. */
export const turnsLoading = signal(false);
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

const runningTurnHandlers = new Set<(sessionId: string, snapshot: RunningTurnSnapshot) => void>();

/**
 * Called when a transcript read reports a turn running in the open session, so
 * the live layer can put it on screen even though this surface did not see it
 * start (a client that connected, reopened the session, or lost events mid-turn).
 */
export function onRunningTurnSnapshot(
  handler: (sessionId: string, snapshot: RunningTurnSnapshot) => void,
): () => void {
  runningTurnHandlers.add(handler);
  return () => {
    runningTurnHandlers.delete(handler);
  };
}

function notifyRunningTurn(sessionId: string, snapshot: RunningTurnSnapshot): void {
  for (const handler of [...runningTurnHandlers]) {
    try {
      handler(sessionId, snapshot);
    } catch (error) {
      console.warn(`Failed to hydrate the running turn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export type SessionSwitchPhase = "leave" | "enter" | "reset";
const sessionSwitchHandlers = new Set<
  (phase: SessionSwitchPhase, sessionId: string | null, key: string | null) => void
>();

/**
 * Lets `agentEvents` keep a running turn per session: `leave` fires before the
 * open session's stream is cleared, `enter` after the next one is selected, and
 * `reset` when the machine being read changes.
 */
export function onSessionSwitch(
  handler: (phase: SessionSwitchPhase, sessionId: string | null, key: string | null) => void,
): () => void {
  sessionSwitchHandlers.add(handler);
  return () => {
    sessionSwitchHandlers.delete(handler);
  };
}

function notifySessionSwitch(phase: SessionSwitchPhase, sessionId: string | null, key: string | null = null): void {
  for (const handler of [...sessionSwitchHandlers]) {
    try {
      handler(phase, sessionId, key);
    } catch {
      // A failed restore must not block selecting the session.
    }
  }
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
  const key = sessionKey(sessionId);
  openSessionKeys.set(openSessionKeys().filter(item => item !== key));
  if (activeSessionId() === sessionId) {
    setActiveSession(null);
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

/**
 * Workspaces the host remembers but has not opened. They are listed apart and
 * reopened through `open_workspace`; `set_active_workspace` only switches between
 * opened ones, so a recent row must never be selected as if it were open.
 */
export const recentWorkspaces = signal<WorkspaceRecord[]>([]);
/** False until the first workspace read answered, so the sidebar can say "loading". */
export const workspacesLoaded = signal(false);

/**
 * Set when the host is older than `get_workspace_navigator`: the sidebar says
 * the host needs an update instead of merging opened and recent lists here.
 */
export const workspaceNavigatorOutdated = signal(false);

/**
 * Reads the host's workspace navigator. The host deduplicates the opened and
 * recent lists and decides the selection: this surface's own while it is still
 * opened, else the host's current workspace, else the first opened one (made
 * active on the host); with nothing opened, `autoOpenRecent` reopens the
 * workspace the host names.
 */
export async function loadWorkspaces(options?: { autoOpenRecent?: boolean }): Promise<void> {
  if (fleetHandshakePending()) await settleFleetHandshake();
  if (fleetActive()) {
    await loadFleetWorkspaces();
    return;
  }
  let reopen: WorkspaceRecord | null = null;
  await runStep(async () => {
    try {
      let view;
      try {
        view = await getWorkspaceNavigator(activeWorkspaceId());
      } catch (error) {
        if (!isMissingCommand(error, "get_workspace_navigator")) throw error;
        workspaceNavigatorOutdated.set(true);
        workspaces.set([]);
        recentWorkspaces.set([]);
        throw new Error(tr("viewModels.workspaceNavigatorOutdated"));
      }
      workspaceNavigatorOutdated.set(false);
      const opened = Array.isArray(view?.opened) ? view.opened : [];
      const recent = Array.isArray(view?.recent) ? view.recent : [];
      workspaces.set(opened);
      recentWorkspaces.set(recent);
      const selectedId = view?.selectedId ?? null;
      switch (view?.selection) {
        case "kept":
          return;
        case "host_current":
          if (selectedId) selectWorkspace(selectedId, { syncHost: false });
          return;
        case "first_opened":
          if (selectedId) selectWorkspace(selectedId);
          return;
        default:
          if (activeWorkspaceId()) clearWorkspaceSelection();
          if (options?.autoOpenRecent && view?.reopenCandidateId) {
            reopen = recent.find(item => item.id === view.reopenCandidateId) ?? null;
          }
      }
    } finally {
      workspacesLoaded.set(true);
    }
  });
  if (reopen) await openRecentWorkspace(reopen);
}

function clearWorkspaceSelection(): void {
  setActiveWorkspaceKey(null);
  setActiveSession(null);
  sessionTurns.set([]);
  sessions.set([]);
  sessionCursor.set(null);
  sessionHasMore.set(false);
  sessionTotal.set(0);
  runningTurnId.set(null);
  clearPendingTurn();
  clearStreamedText();
  notifyWorkspaceChanged();
}

/**
 * Reopens a workspace from the recent list. The host makes it active as it opens
 * it, so the selection follows without a separate `set_active_workspace`.
 */
export async function openRecentWorkspace(record: WorkspaceRecord): Promise<void> {
  await runStep(async () => {
    const opened = await openWorkspaceById(record);
    await loadWorkspaces();
    const id = opened?.id || record.id;
    if (opened?.id && !workspaces().some(item => item.id === opened.id)) {
      workspaces.update(current => [opened, ...current]);
    }
    recentWorkspaces.update(current => current.filter(item => item.id !== id));
    selectWorkspace(id, { syncHost: false });
  });
}

/** Drops a workspace from the host's recent list (not a delete of its files). */
export async function forgetRecentWorkspace(workspaceId: string): Promise<void> {
  await runStep(async () => {
    await removeRecentWorkspace(workspaceId);
    recentWorkspaces.update(current => current.filter(item => item.id !== workspaceId));
  });
}

/** Renames an opened workspace through the host and keeps the row in place. */
export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  const next = name.trim();
  if (!workspaceId || !next) return;
  await runStep(async () => {
    const updated = await updateWorkspaceInfo(workspaceId, next);
    workspaces.update(current =>
      current.map(item =>
        item.id === workspaceId ? { ...item, ...(updated ?? {}), name: updated?.name ?? next } : item,
      ),
    );
  });
}

export function selectWorkspace(
  workspaceId: string,
  options?: { syncHost?: boolean; deviceId?: string; loadSessions?: boolean },
): void {
  const device = fleetActive() ? (options?.deviceId ?? deviceContext()) : "";
  const current = activeWorkspaceKey();
  if (current && current.workspaceId === workspaceId && current.deviceId === device) return;
  // A recent workspace is not open on the host: reopen it instead of pretending.
  if (!fleetActive() && !workspaces().some(item => item.id === workspaceId)) {
    const recent = recentWorkspaces().find(item => item.id === workspaceId);
    if (recent) {
      void openRecentWorkspace(recent);
      return;
    }
  }
  setActiveWorkspaceKey(workspaceId, device);
  setActiveSession(null);
  sessionTurns.set([]);
  sessions.set([]);
  sessionCursor.set(null);
  runningTurnId.set(null);
  clearPendingTurn();
  clearStreamedText();
  notifyWorkspaceChanged();
  if (fleetActive()) {
    // The host's own current workspace is that host's preference, not this view's.
    applyFleetWorkspaceRows();
    if (options?.loadSessions !== false) void loadSessions();
    return;
  }
  if (options?.syncHost !== false) {
    // A refused switch leaves the host on another workspace; say so.
    void setActiveWorkspace(workspaceId).catch(reportError);
  }
  if (options?.loadSessions !== false) void loadSessions();
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
    const closed = workspaces().find(item => item.id === workspaceId);
    const remaining = workspaces().filter(item => item.id !== workspaceId);
    workspaces.set(remaining);
    // The host keeps a closed workspace in its recent list; mirror it until the next read.
    if (closed && !recentWorkspaces().some(item => item.id === workspaceId)) {
      recentWorkspaces.update(current => [closed, ...current]);
    }
    if (activeWorkspaceId() === workspaceId) {
      const next = remaining[0] ?? null;
      setActiveWorkspaceKey(null);
      setActiveSession(null);
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
  if (fleetActive()) {
    await runStep(async () => {
      await refreshFleetNavigator();
      applyFleetWorkspaceRows();
      const first = sessions()[0];
      if (!activeSessionId() && first) selectSession(first.sessionId, deviceContext());
    });
    return;
  }
  await runStep(async () => {
    const page = await listSessions(workspaceId, 50);
    if (activeWorkspaceId() !== workspaceId) return;
    sessions.set(page.sessions ?? []);
    reconcileSessionReadState(page.sessions ?? []);
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
  if (fleetActive()) {
    await refreshFleetNavigator();
    applyFleetWorkspaceRows();
    return;
  }
  try {
    const limit = Math.max(50, sessions().length);
    const page = await listSessions(workspaceId, limit);
    if (activeWorkspaceId() !== workspaceId) return;
    const incoming = page.sessions ?? [];
    if (!incoming.length && sessions().length > 0 && page.totalTopLevelCount === undefined) return;
    sessions.set(incoming);
    reconcileSessionReadState(incoming);
    if (typeof page.totalTopLevelCount === "number") {
      sessionTotal.set(page.totalTopLevelCount);
    }
    sessionCursor.set(page.nextCursor ?? null);
    sessionHasMore.set(page.hasMore === true);
  } catch {
    // Silent background metadata refresh never interrupts active chat.
  }
}

/**
 * Appends the next catalogue page; the cursor is the host's, not a row offset.
 * The fleet index holds a workspace's newest sessions only, so on a fleet
 * connection the first extra page is read from the owner without a cursor and
 * the rows already shown are skipped.
 */
export async function loadMoreSessions(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const cursor = sessionCursor() ?? (fleetActive() && sessionHasMore() ? undefined : null);
  if (!workspaceId || cursor === null) return;
  await runStep(async () => {
    // On a fleet connection the page comes from the workspace's owner (`fleet_call`).
    const page = await listSessions(workspaceId, 50, cursor);
    if (activeWorkspaceId() !== workspaceId) return;
    const known = new Set(sessions().map(item => item.sessionId));
    const extra = (page.sessions ?? []).filter(item => !known.has(item.sessionId));
    sessions.set([...sessions(), ...extra]);
    reconcileSessionReadState(extra);
    sessionCursor.set(page.nextCursor ?? null);
    sessionHasMore.set(page.hasMore === true);
    sessionTotal.set(page.totalTopLevelCount ?? sessions().length);
  });
}

/** Sessions the user opened (`sessionKey`s), in the order the tab strip shows them. */
export const openSessionKeys = signal<string[]>([]);
/** The open sessions' ids, in tab order (read-only view of `openSessionKeys`). */
export const openSessionIds = computed<string[]>(() => openSessionKeys().map(sessionIdOfKey));

export function selectSession(sessionId: string, deviceId?: string, workspaceId?: string): void {
  const previous = activeSessionId();
  const previousKey = activeSessionKey();
  const device = fleetActive() ? (deviceId ?? deviceOfSession(sessionId)) : "";
  // A session belongs to one workspace on its device (a dispatch job's lives in
  // its own worktree workspace); its transcript and composer read that
  // workspace, so it is selected first when the session lives elsewhere.
  const owner = fleetActive() ? workspaceId || fleetSessionRow(device, sessionId)?.workspaceId || "" : "";
  const current = activeWorkspaceKey();
  if (owner && (current?.workspaceId !== owner || current?.deviceId !== device)) {
    selectWorkspace(owner, { deviceId: device });
  }
  const key = `${device}/${sessionId}`;
  setActiveSession(sessionId, device);
  if (!openSessionKeys().includes(key)) openSessionKeys.update(keys => [...keys, key]);
  if (previousKey !== key) {
    evictTurnWindow(previousKey);
    transcriptCursor = null;
    notifySessionSwitch("leave", previous, previousKey);
    swapComposerDraft(previousKey, key);
    sessionTurns.set([]);
    turnsLoading.set(true);
    clearPendingTurn();
    clearStreamedText();
    turnError.set("");
  }
  runningTurnId.set(runningTurns()[key] ?? null);
  if (previousKey !== key) notifySessionSwitch("enter", sessionId, key);
  // Opening a session is what makes it read; its row compares against this stamp.
  const row = sessions().find(item => item.sessionId === sessionId);
  markSessionSeen(sessionId, sessionLastActivityMs(row));
  void loadTurns(sessionId);
  // A question asked before this surface looked at the session has no event left
  // to replay, so the host's mailbox is read on every open.
  void loadQuestionMailbox(sessionId);
}

/** Closes one tab; the neighbour takes over when the closed tab was on screen. */
export function closeSessionTab(sessionId: string, deviceId?: string): void {
  const key = deviceId !== undefined ? `${deviceId}/${sessionId}` : sessionKey(sessionId);
  evictTurnWindow(key);
  composerDrafts.delete(key);
  const remaining = openSessionKeys().filter(item => item !== key);
  openSessionKeys.set(remaining);
  if (activeSessionKey() !== key) return;
  const fallback = remaining[remaining.length - 1];
  transcriptCursor = null;
  notifySessionSwitch("leave", sessionId, key);
  swapComposerDraft(key, null);
  setActiveSession(null);
  sessionTurns.set([]);
  runningTurnId.set(null);
  clearPendingTurn();
  clearStreamedText();
  if (fallback) selectSession(sessionIdOfKey(fallback), deviceIdOfKey(fallback));
}

/** How many of the newest turns a session loads; "Load earlier" widens it. */
export const TURN_WINDOW_STEP = 30;
const MAX_TURN_WINDOW_ENTRIES = 16;
/** Turn window per `sessionKey`. */
export const turnWindows = signal<Record<string, number>>({});

function evictTurnWindow(key: string | null | undefined): void {
  if (!key) return;
  if (!(key in turnWindows())) return;
  turnWindows.update(current => {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
}

function setTurnWindow(key: string, value: number): void {
  turnWindows.update(current => {
    const next = { ...current, [key]: value };
    const keys = Object.keys(next);
    if (keys.length > MAX_TURN_WINDOW_ENTRIES) {
      const keep = activeSessionKey();
      for (const candidate of keys) {
        if (Object.keys(next).length <= MAX_TURN_WINDOW_ENTRIES) break;
        if (candidate !== key && candidate !== keep) delete next[candidate];
      }
    }
    return next;
  });
}

function turnWindowOf(sessionId: string, key = sessionKey(sessionId)): number {
  return turnWindows()[key] ?? TURN_WINDOW_STEP;
}

/**
 * Whether the host holds turns older than the loaded window: the catalogue's
 * `turnCount` says so exactly, and without it a full window is taken to mean
 * there may be more.
 */
export const hasEarlierTurns = computed(() => {
  const sessionId = activeSessionId();
  if (!sessionId) return false;
  const loaded = sessionTurns().length;
  const row = sessions().find(item => item.sessionId === sessionId) as
    | (SessionSummary & { turnCount?: number })
    | undefined;
  if (typeof row?.turnCount === "number") return row.turnCount > loaded;
  return loaded >= turnWindowOf(sessionId, activeSessionKey() ?? sessionKey(sessionId));
});

/** Widens the open session's window by one step and reloads it. */
export async function loadEarlierTurns(): Promise<void> {
  const sessionId = activeSessionId();
  const key = activeSessionKey();
  if (!sessionId || !key) return;
  setTurnWindow(key, turnWindowOf(sessionId, key) + TURN_WINDOW_STEP);
  await loadTurns(sessionId, { silent: true });
}

/** What the last view read returned, so the next one asks only for what changed. */
let transcriptCursor: { sessionKey: string; limit: number; cursor: string } | null = null;

/**
 * Re-reads the open session's transcript view. With the cursor of the previous
 * read the host answers only the turns after the last settled one (`after`);
 * anything it cannot vouch for comes back whole (`full`). A host without the
 * view gets `transcriptNotice` instead of a client-side projection.
 */
export async function loadTurns(
  sessionId: string,
  options?: { silent?: boolean },
): Promise<TranscriptTurnView[] | null> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const key = activeSessionId() === sessionId && activeSessionKey() ? activeSessionKey()! : sessionKey(sessionId);
  let loaded: TranscriptTurnView[] | null = null;
  await runStep(
    async () => {
      const limit = turnWindowOf(sessionId, key);
      const held = sessionTurns();
      const cursor =
        transcriptCursor &&
        transcriptCursor.sessionKey === key &&
        transcriptCursor.limit === limit &&
        activeSessionKey() === key &&
        held.length > 0
          ? transcriptCursor.cursor
          : undefined;
      let view: SessionTranscriptView | null = null;
      try {
        view = await getSessionTranscriptView(sessionId, workspaceId, limit, cursor);
        if (view.mode === "after" && !held.some(turn => turn.turnIndex === view!.keptThroughIndex)) {
          // The turns this surface holds are not the ones the cursor named.
          view = await getSessionTranscriptView(sessionId, workspaceId, limit);
        }
      } catch (error) {
        if (isMissingCommand(error, "get_session_transcript_view")) {
          if (activeSessionKey() === key) {
            transcriptCursor = null;
            transcriptNotice.set(tr("sessions.transcriptHostOutdated"));
            sessionTurns.set([]);
          }
          loaded = [];
          return;
        }
        throw error;
      } finally {
        if (activeSessionKey() === key) turnsLoading.set(false);
      }
      if (activeSessionKey() !== key || !view) return;
      const list =
        view.mode === "after"
          ? [...held.filter(turn => turn.turnIndex <= (view.keptThroughIndex ?? -1)), ...view.turns]
          : Array.isArray(view.turns)
            ? view.turns
            : [];
      transcriptCursor = view.cursor ? { sessionKey: key, limit, cursor: view.cursor } : null;
      transcriptNotice.set("");
      sessionTurns.set(list);
      reconcilePendingTurnWithPersisted(sessionId, list, key);
      if (view.runningTurn?.activeTurnId) notifyRunningTurn(sessionId, view.runningTurn);
      loaded = list;
    },
    options?.silent ? { trackBusy: false, clearError: false } : undefined,
  );
  return loaded;
}

export interface PendingTurnState {
  sessionId: string;
  /** Device-scoped session key (`"<deviceId>/<sessionId>"`) to prevent cross-device collisions. */
  sessionKey?: string;
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

function matchesPendingSession(pending: PendingTurnState, sessionId: string, key?: string): boolean {
  const targetKey = key ?? sessionKey(sessionId);
  if (pending.sessionKey) return pending.sessionKey === targetKey;
  return pending.sessionId === sessionId;
}

export function setPendingTurn(sessionId: string, userText: string, turnId?: string): void {
  const trimmed = userText.trim();
  if (!sessionId || !trimmed) return;
  const key = activeSessionId() === sessionId && activeSessionKey() ? activeSessionKey()! : sessionKey(sessionId);
  // The new turn joins the window instead of pushing the oldest loaded one out.
  setTurnWindow(key, turnWindowOf(sessionId, key) + 1);
  pendingTurnState.set({
    sessionId,
    sessionKey: key,
    ...(turnId ? { turnId } : {}),
    userText: trimmed,
    createdAt: Date.now(),
    baselineTurnCount: sessionTurns().length,
  });
  if (activeSessionKey() === key) {
    pendingTurn.set(trimmed);
  }
}

export function bindPendingTurnId(sessionId: string, turnId: string, userText?: string): void {
  const current = pendingTurnState();
  const key = activeSessionId() === sessionId && activeSessionKey() ? activeSessionKey()! : sessionKey(sessionId);
  if (current && matchesPendingSession(current, sessionId, key)) {
    pendingTurnState.set({
      ...current,
      sessionKey: current.sessionKey ?? key,
      turnId,
      ...(userText && !current.userText ? { userText } : {}),
    });
    if (activeSessionKey() === key && pendingTurn() !== (current.userText || userText || "")) {
      pendingTurn.set(current.userText || userText || "");
    }
    return;
  }
  if (userText && userText.trim()) {
    setPendingTurn(sessionId, userText, turnId);
  }
}

export function clearPendingTurn(sessionId?: string, key?: string): void {
  const current = pendingTurnState();
  if (sessionId && current && !matchesPendingSession(current, sessionId, key)) return;
  pendingTurnState.set(null);
  if (!sessionId || activeSessionKey() === (key ?? sessionKey(sessionId))) {
    pendingTurn.set("");
  }
}

function reconcilePendingTurnWithPersisted(sessionId: string, turns: TranscriptTurnView[], key?: string): void {
  const pending = pendingTurnState();
  if (!pending || !matchesPendingSession(pending, sessionId, key)) return;
  if (pending.turnId) {
    const matched = turns.some(turn => turn.turnId === pending.turnId);
    if (matched) {
      clearPendingTurn(sessionId, key);
    }
    return;
  }
  // When `turnId` was not yet received (e.g. hosts that don't emit
  // `dialog-turn-started` before persisting), clear once a new turn with the
  // matching user prompt lands on disk.
  if (turns.length > pending.baselineTurnCount) {
    const content = (turns[turns.length - 1]?.user?.text ?? "").trim();
    if (!content || content === pending.userText) {
      clearPendingTurn(sessionId, key);
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
 * `sessionKey` → the turn running in it. The rows need this for every session,
 * not only the selected one, because a workspace (and every device) can run
 * several at a time.
 */
export const runningTurns = signal<Record<string, string>>({});

/** The turn running in a session, by id on its device. */
export function runningTurnOf(sessionId: string, deviceId?: string): string | null {
  return runningTurns()[sessionKey(sessionId, deviceId ?? deviceOfSession(sessionId))] ?? null;
}
/** The composer's current text. */
export const composerText = signal<string>("");

/**
 * What each session's composer held when another session was opened, so a draft
 * and its attachments stay with the session they were written for (by `sessionKey`).
 */
const composerDrafts = new Map<string, { text: string; attachments: ImageAttachment[] }>();

function swapComposerDraft(previous: string | null, next: string | null): void {
  if (previous) {
    const text = composerText();
    const attachments = imageAttachments();
    if (text || attachments.length) composerDrafts.set(previous, { text, attachments });
    else composerDrafts.delete(previous);
  }
  const draft = next ? composerDrafts.get(next) : undefined;
  // Nothing was open before: whatever the composer holds (a starter card, a quick
  // prompt) is meant for the session being opened.
  if (!previous && !draft) return;
  composerText.set(draft?.text ?? "");
  imageAttachments.set(draft?.attachments ?? []);
  if (next) composerDrafts.delete(next);
}

/** Why the composer could not send mid-turn on this host, or empty. */
export const sendNotice = signal("");

/**
 * Sends the composer's message for the selected session through the host's
 * `submit_user_message`: the host applies `app.flow_chat.send_during_turn` and
 * answers whether the message started a turn, steered the running one or waits
 * in its queue. Mobile and IM bots go through the same host function, so a
 * message written during a turn does the same thing whichever client sent it.
 *
 * The message goes to the session's own workspace, never to whichever workspace
 * the UI happens to show. A host older than the command still starts a turn on
 * an idle session; during a turn it is told to update rather than this surface
 * guessing the policy.
 */
export async function sendTurn(
  text: string,
  /** The user's explicit "Steer" / "Queue" press; omitted, the host's setting applies. */
  sendDuringTurn?: "immediate" | "queue",
): Promise<SubmitUserMessageResult["outcome"] | null> {
  const sessionId = activeSessionId();
  const body = text.trim();
  if (!sessionId || !body) return null;
  // The row says which workspace owns the session. A session open in a tab whose
  // workspace is no longer listed is sent without one, so the host restores it
  // from its own binding instead of the workspace this window shows now.
  const row = sessions().find(item => item.sessionId === sessionId);
  const workspaceId = row ? row.workspaceId || activeWorkspaceId() || undefined : undefined;
  turnError.set("");
  sendNotice.set("");
  const attachments = attachmentContexts();
  const running = Boolean(runningTurnId());
  if (!running) {
    // Optimistic: the pending bubble stays across TTFT until persisted turns
    // settle (no flash back to the empty Welcome Studio on send).
    clearStreamedText();
    setPendingTurn(sessionId, body);
  }
  let outcome: SubmitUserMessageResult["outcome"] | null = null;
  await runStep(async () => {
    try {
      const result = await submitUserMessage({
        sessionId,
        ...(workspaceId ? { workspaceId } : {}),
        text: body,
        agentType: agentTypeOf(sessionId),
        ...(attachments.length ? { attachments } : {}),
        ...(running && sendDuringTurn ? { sendDuringTurn } : {}),
      });
      outcome = result.outcome;
      composerText.set("");
      clearAttachments();
      if (result.outcome === "started") {
        bindPendingTurnId(sessionId, result.turnId, body);
      } else {
        // Steered into the running turn or waiting in the host queue: either way
        // no new turn starts from this message now.
        if (!running) clearPendingTurn(sessionId);
        if (result.outcome === "steered") await loadTurns(sessionId);
      }
    } catch (error) {
      if (isMissingCommand(error, "submit_user_message")) {
        outcome = await sendWithLegacyHost(
          sessionId,
          workspaceId ?? activeWorkspaceId() ?? "",
          body,
          attachments,
          running,
        );
        return;
      }
      if (!running) clearPendingTurn(sessionId);
      turnError.set(error instanceof Error ? error.message : String(error));
    }
  });
  return outcome;
}

/**
 * A host without `submit_user_message`: an idle session still starts a turn; a
 * message written during a turn is kept in the composer with an explicit notice,
 * because only a newer host decides between steering and queueing.
 */
async function sendWithLegacyHost(
  sessionId: string,
  workspaceId: string,
  body: string,
  attachments: ReturnType<typeof attachmentContexts>,
  running: boolean,
): Promise<SubmitUserMessageResult["outcome"] | null> {
  if (running) {
    sendNotice.set(tr("chat.send.hostUpdateRequired"));
    return null;
  }
  try {
    await startDialogTurn({
      sessionId,
      userInput: body,
      agentType: agentTypeOf(sessionId),
      workspaceId,
      ...(attachments.length ? { imageContexts: attachments } : {}),
    });
    composerText.set("");
    clearAttachments();
    return "started";
  } catch (error) {
    clearPendingTurn(sessionId);
    turnError.set(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Stops the turn the host reported as running. The host's `stop_dialog_turn`
 * interrupts when it can and cancels otherwise, so every client stops the same
 * way. A host older than that command gets the interruption it has, with hard
 * cancellation behind it, which is what such a host itself offered.
 */
export async function stopRunningTurn(): Promise<void> {
  const sessionId = activeSessionId();
  const turnId = runningTurnId();
  if (!sessionId || !turnId) return;
  await runStep(async () => {
    try {
      await stopDialogTurn(sessionId, turnId);
    } catch (error) {
      if (!isMissingCommand(error, "stop_dialog_turn")) throw error;
      try {
        await interruptDialogTurn(sessionId, turnId);
      } catch {
        await cancelDialogTurn(sessionId, turnId);
      }
    }
    runningTurnId.set(null);
    const key = sessionKey(sessionId);
    runningTurns.update(current => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
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

/** `sessionKey` → the agent this surface bound, ahead of the host's next catalogue read. */
export const sessionAgentTypes = signal<Record<string, string>>({});

/**
 * The agent a session runs as: what this surface bound, else the agent the host
 * recorded for it, else the one the composer is on. Reading the host's own record
 * is what keeps a session created on the desktop on the agent it ran as there.
 */
export function agentTypeOf(sessionId: string | null): string {
  if (!sessionId) return chosenAgentType();
  const bound = sessionAgentTypes()[sessionKey(sessionId)];
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
      sessionAgentTypes.update(current => ({ ...current, [sessionKey(created.sessionId, deviceContext())]: bound }));
      if (
        created.agentType &&
        activeWorkspaceId() === workspaceId &&
        created.agentType.trim().toLowerCase() !== agentType.trim().toLowerCase()
      ) {
        chosenAgentType.set(created.agentType.trim());
      }
    }
    await loadSessions();
    if (created?.sessionId) selectSession(created.sessionId);
  });
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  await runStep(async () => {
    const row = sessions().find(item => item.sessionId === sessionId);
    await saveSessionName(
      sessionMetadataForSave(row as (SessionSummary & Record<string, unknown>) | undefined, {
        sessionId,
        sessionName: name,
        agentType: agentTypeOf(sessionId),
      }),
      workspaceId,
    );
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
      const key = sessionKey(sessionId);
      evictTurnWindow(key);
      composerDrafts.delete(key);
      openSessionKeys.set(openSessionKeys().filter(item => item !== key));
    }
    if (archived && activeSessionId() === sessionId) {
      transcriptCursor = null;
      setActiveSession(null);
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
    const key = sessionKey(sessionId);
    evictTurnWindow(key);
    composerDrafts.delete(key);
    openSessionKeys.set(openSessionKeys().filter(item => item !== key));
    if (activeSessionId() === sessionId) {
      transcriptCursor = null;
      setActiveSession(null);
      sessionTurns.set([]);
    }
  });
}

function lineageSessionIdOf(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  const id = record.sessionId ?? record.session_id;
  return typeof id === "string" ? id : "";
}

function persistedTurnIdOf(turn: TranscriptTurnView | undefined): string {
  return turn?.turnId ?? "";
}

/**
 * Forks the active session at one turn (the last loaded one when no turn is
 * named, which is what the thread menu offers) and opens the fork the host made.
 */
export async function forkActiveSession(atTurnId?: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const sessionId = activeSessionId();
  if (!workspaceId || !sessionId) return;
  const turns = sessionTurns();
  const turnId = atTurnId || persistedTurnIdOf(turns[turns.length - 1]);
  if (!turnId) {
    lastError.set(tr("sessions.forkNoTurn"));
    return;
  }
  await runStep(async () => {
    const forked = await forkSession(sessionId, turnId, workspaceId);
    await loadSessions();
    const forkedId = lineageSessionIdOf(forked);
    if (forkedId) selectSession(forkedId);
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
    const copiedId = lineageSessionIdOf(copied);
    if (copiedId) selectSession(copiedId);
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
      sessionAgentTypes.update(current => ({ ...current, [sessionKey(currentId)]: requestedAgent }));
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

// ── Fleet lists ──────────────────────────────────────────────────────────────
//
// On a fleet connection the workspace and session lists of the device context
// are the fleet index's rows, in the backend's order; nothing is merged here.

function workspaceRecordOf(row: FleetWorkspace): WorkspaceRecord {
  return {
    id: row.workspaceId,
    name: row.name,
    rootPath: row.rootPath,
    workspaceKind: row.kind === "remote_ssh" ? "remote" : row.kind,
    ...(row.sshHost ? { sshHost: row.sshHost } : {}),
  };
}

function sessionSummaryOf(row: FleetSession): SessionSummary {
  return {
    sessionId: row.sessionId,
    sessionName: row.title,
    lastActiveAt: row.lastActivityMs,
    workspaceId: row.workspaceId,
    agentType: row.agentType,
    unread: row.unread,
    deviceId: row.deviceId,
  };
}

/** Puts the device context's index rows into the workspace and session lists. */
function applyFleetWorkspaceRows(): void {
  if (!fleetActive()) return;
  const device = fleetDeviceById(deviceContext());
  workspaces.set((device?.workspaces ?? []).map(workspaceRecordOf));
  recentWorkspaces.set([]);
  workspaceNavigatorOutdated.set(false);
  const key = activeWorkspaceKey();
  const row = key ? fleetWorkspaceByKey(key) : null;
  if (!row) return;
  const rows = row.sessions.map(sessionSummaryOf);
  const known = new Set(rows.map(item => item.sessionId));
  // Rows read from the owner beyond the index's newest stay below them.
  const extra = sessions().filter(item => !known.has(item.sessionId) && item.workspaceId === row.workspaceId);
  sessions.set([...rows, ...extra]);
  reconcileSessionReadState(rows);
  sessionTotal.set(row.sessionTotal);
  sessionHasMore.set(row.hasMore || sessionCursor() !== null);
}

let followingFleetRows = false;

function followFleetRows(): void {
  if (followingFleetRows) return;
  followingFleetRows = true;
  effect(() => {
    fleetNavigator();
    untracked(() => applyFleetWorkspaceRows());
  });
}

/**
 * The fleet path of `loadWorkspaces`: reads the index, keeps the selection while
 * its device still lists it, else selects the device context's current
 * workspace (the host's own `isHostCurrent`), else its first one.
 */
async function loadFleetWorkspaces(): Promise<void> {
  followFleetRows();
  await runStep(async () => {
    try {
      await refreshFleetNavigator();
      applyFleetWorkspaceRows();
      const key = activeWorkspaceKey();
      if (key && fleetWorkspaceByKey(key)) return;
      const device = fleetDeviceById(deviceContext());
      const next = device?.workspaces.find(item => item.isHostCurrent) ?? device?.workspaces[0] ?? null;
      if (next) selectWorkspace(next.workspaceId, { deviceId: next.deviceId || device!.deviceId });
      else if (key) clearWorkspaceSelection();
    } finally {
      workspacesLoaded.set(true);
    }
  });
}

/**
 * Moves the device context to `deviceId` (fleet only): its current workspace is
 * selected, and every device-scoped store reloads through `onWorkspaceChanged`.
 * Nothing is reset; the other devices' sessions, turns and drafts stay keyed by
 * their device.
 */
export async function selectDeviceContext(deviceId: string): Promise<void> {
  if (!fleetActive() || !deviceId) return;
  selectedDevice.set(deviceId);
  if (activeWorkspaceKey()?.deviceId === deviceId) return;
  const device = fleetDeviceById(deviceId);
  const next = device?.workspaces.find(item => item.isHostCurrent) ?? device?.workspaces[0] ?? null;
  if (next) {
    selectWorkspace(next.workspaceId, { deviceId, loadSessions: false });
    await loadSessions();
  } else {
    clearWorkspaceSelection();
    applyFleetWorkspaceRows();
  }
}

// The fleet answer arrives with the handshake (or the native ready info), so the
// first workspace read may have run before it: when the connection turns out to
// be a fleet entry (or a client moves to one), the lists are read from the index.
let fleetModeSeen = false;
effect(() => {
  const active = fleetActive();
  untracked(() => {
    if (active === fleetModeSeen) return;
    fleetModeSeen = active;
    if (!active) return;
    startFleetStore();
    void loadFleetWorkspaces();
  });
});

// The entry streams another device's events only while someone follows it
// (`fleet_subscribe`): the device context in full (terminals, files, git, its
// sessions), and the open sessions of any other device. A new entry (failover)
// starts with no follows, so the set is sent again.
let lastFollow = "";
effect(() => {
  if (!fleetActive()) {
    lastFollow = "";
    return;
  }
  const entry = entryDeviceId() ?? "";
  const context = deviceContext();
  const follow: Record<string, { all?: boolean; sessions?: string[] }> = {};
  if (context) follow[context] = { all: true };
  for (const key of openSessionKeys()) {
    const device = deviceIdOfKey(key);
    if (!device || follow[device]?.all) continue;
    (follow[device] ??= { sessions: [] }).sessions!.push(sessionIdOfKey(key));
  }
  // The account's cloud node (OpenBitFun) streams its turns and job cards
  // (`superagent://…`) to this client only while followed; they are small.
  // wave23-E: not while the Super Agent UI is gated off (`productGates.ts`); nothing would draw them.
  const cloud = superAgentUi() ? fleetNavigator()?.devices.find(device => device.hostKind === "cloud")?.deviceId : undefined;
  if (cloud && !follow[cloud]) follow[cloud] = { all: true };
  const signature = `${entry}|${JSON.stringify(follow)}`;
  if (signature === lastFollow) return;
  lastFollow = signature;
  untracked(() => {
    void invokeCommand("fleet_subscribe", { follow }).catch(error =>
      console.warn(`Fleet follow update failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  });
});

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

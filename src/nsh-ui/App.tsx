import {
  cleanup,
  Clipboard,
  computed,
  effect,
  ErrorBoundary,
  keymap,
  mount,
  Overlay,
  reduceMotion,
  Scroll,
  signal,
  Text,
  View,
  type JSX,
  type Point,
  type PressEvent,
  type ScrollRef,
  type ViewRef,
  untracked,
} from "nsh";
import { Input } from "nsh/base";
import {
  closeWindow,
  connectionError,
  connectionState,
  hideMainWindowAfterCloseRequest,
  inAppUpdatesAvailable,
  initWindowChrome,
  invokeCommand,
  invokeRawCommand,
  listenEvent,
  minimizeMainWindowToTray,
  minimizeWindow,
  nativeWindow,
  onMainWindowCloseRequest,
  openHostEventChannel,
  pageDrawsWindowControls,
  pickLocalDirectory,
  quitApplication,
  shellMenuShortcutIds,
  startShellIntegration,
  startWindowDrag,
  toggleWindowFullscreen,
  toggleWindowMaximize,
  trafficLightInsetPx,
  usesNativeDragRegions,
  windowControlsRightInsetPx,
  windowMaximized,
  windowPlatform,
} from "./src/bridge";
import { subscribeAgentEvents } from "./src/agentEvents";
import { installBackendResync } from "./src/backendResync";
import { installServedBackend } from "./src/servedBackend";
import { loadLocalDeviceId, localDeviceId } from "./src/devicePrefsStore";
import { formatPlural } from "./src/format";
import {
  SUPPORTED_LOCALES,
  currentLocale,
  isAuthRequiredError,
  localeMeta,
  localizeHostError,
  setAppLocale,
  tr,
  type MessageKey,
} from "./src/i18n";
import {
  accountStatus,
  githubUser,
  isAccountSignedIn,
  loadAccountState,
} from "./src/homeStore";
import { pendingPermissions, startPermissionPrompts } from "./src/permissionStore";
import { startQuestionPrompts } from "./src/userQuestionStore";
import {
  activeScene,
  activeSessionId,
  activeWorkspace,
  archiveSessionRow,
  auxPaneMaximized,
  auxPaneOpen,
  auxPaneSide,
  auxPaneTab,
  auxPaneWidth,
  canGoBack,
  canGoForward,
  clearError,
  closeSceneTab,
  closeWorkspace,
  collapsedWorkspaces,
  copyActiveSession,
  createSessionInWorkspace,
  deleteSessionRow,
  drawerOpen,
  goBackScene,
  goForwardScene,
  initAppLocale,
  isSessionArchived,
  lastError,
  forgetRecentWorkspace,
  loadMoreSessions,
  loadShellLayout,
  loadWorkspaces,
  NAV_COLLAPSE_WIDTH,
  NAV_DEFAULT_WIDTH,
  navWidth,
  navigateScene,
  openInAuxPane,
  openPathWorkspace,
  openRecentWorkspace,
  openSceneTabs,
  persistShellLayout,
  recentWorkspaces,
  renameSession,
  renameWorkspace,
  resetForDeviceChange,
  runningTurns,
  selectSession,
  selectWorkspace,
  sessionGrouping,
  sessionHasMore,
  sessionTotal,
  sessions,
  setAuxPaneMaximized,
  setAuxPaneWidth,
  setNavWidth,
  swapAuxPanes,
  toggleAuxPane,
  toggleDrawer,
  workspaces,
  workspacesLoaded,
  type AuxPaneTab,
  type SceneId,
} from "./src/state";
import {
  APPEARANCE_PRESETS,
  appearanceId,
  appearanceMode,
  concentricRadius,
  controlHeight,
  fontMono,
  isLightAppearance,
  palette,
  radii,
  resolvedScheme,
  selectAppearancePreset,
  syncGlobalNativeTheme,
  textLineHeight,
  textSize,
  textTracking,
  type AppearanceId,
  compactLayout,
} from "./src/theme";
import { applyAppearance, loadAppearance } from "./src/themeStore";
import { loadFontPreference } from "./src/fontPreferenceStore";
import { loadContentWidth } from "./src/contentWidthStore";
import { loadQueue } from "./src/queueStore";
import { ensureSendPolicy } from "./src/sendPolicyStore";
import { ensureQuickActions } from "./src/quickActionStore";
import { loadSeenSessions, statusOfSession } from "./src/sessionStatusStore";
import { peerBusy, peerError, peerReconnecting, peerScope } from "./src/peerState";
import { enterPeer, reconnectPeer } from "./src/peerStore";
import { forgetTerminals, openTerminal } from "./src/terminalStore";
import { openFileAt } from "./src/fileStore";
import {
  listSessions,
  revealInExplorer,
  type SessionSummary,
  type WorkspaceRecord,
} from "./src/api";
import {
  closeGlobalSearch,
  openGlobalSearch,
  runSearchItem,
  searchBusy,
  searchItems,
  searchNotice,
  searchOpen,
  searchQuery,
  setSearchQuery,
  type SearchItem,
} from "./src/globalSearchStore";
import {
  activeRemoteWorkspace,
  closeWorkspaceRecord,
  connectionStatuses,
  disconnectSsh,
  loadSavedConnections,
  openNewWorkspaceModal,
  openPortForwardModal,
  openRemoteFileBrowser,
  openSshConnectionModal,
  quickConnectSavedConnection,
  savedConnections,
} from "./src/sshRemoteStore";
import { Icon, type IconName } from "./src/ui/icons";
import {
  MOTION_DURATION,
  Spinner,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "./src/ui/motion";
import {
  ContextMenuOverlay,
  DropdownMenu,
  ModalDialog,
  ToastHost,
  pushToast,
  type DropdownMenuItem,
} from "./src/ui/overlays";
import {
  Badge,
  Button,
  IconButton,
  InlineBanner,
  KbdHint,
  PillChip,
  SplitHandle,
  StatusDot,
  TextField,
  TooltipBubble,
} from "./src/ui/primitives";
import {
  AccountAuthModal,
  onAccountAuthChanged,
  openAccountAuthModal,
} from "./src/ui/AccountAuthModal";
import { SshWorkspaceModals } from "./src/ui/SshWorkspaceModals";
import { AboutDialog, openAboutDialog } from "./src/ui/AboutDialog";
import {
  clearNotifications,
  markAllNotificationsRead,
  notifications,
  startNotifications,
  unreadNotificationCount,
} from "./src/notificationStore";
import { HomeScene } from "./src/scenes/HomeScene";
import { SessionsScene } from "./src/scenes/SessionsScene";
import { AssistantsScene } from "./src/scenes/AssistantsScene";
import { AgentsScene } from "./src/scenes/AgentsScene";
import { SkillsScene } from "./src/scenes/SkillsScene";
import { RoutinesScene } from "./src/scenes/RoutinesScene";
import { FilesScene } from "./src/scenes/FilesScene";
import { GitScene } from "./src/scenes/GitScene";
import { TerminalScene } from "./src/scenes/TerminalScene";
import { SpacesScene } from "./src/scenes/SpacesScene";
import { DevicesScene, returnToThisMachine } from "./src/scenes/DevicesScene";
import {
  requestSettingsPage,
  SETTINGS_PAGE_GROUPS,
  SettingsNavigation,
  SettingsScene,
  type SettingsPageEntry,
} from "./src/scenes/SettingsScene";

// A page served by a backend connects back to it over OBP (before any command runs).
installServedBackend();
openHostEventChannel();
subscribeAgentEvents();
installBackendResync();

function shortcutLabel(chord: string, fallback: string): string {
  try {
    return keymap.label(chord) || fallback;
  } catch {
    return fallback;
  }
}

interface SceneMeta {
  labelKey: MessageKey;
  icon: IconName;
}

const SCENE_META: Record<SceneId, SceneMeta> = {
  home: { labelKey: "nav.home", icon: "home" },
  sessions: { labelKey: "nav.sessions", icon: "chat" },
  assistants: { labelKey: "nav.assistants", icon: "bot" },
  agents: { labelKey: "nav.agents", icon: "cpu" },
  skills: { labelKey: "nav.skills", icon: "sparkles" },
  routines: { labelKey: "nav.routines", icon: "calendar" },
  spaces: { labelKey: "nav.spaces", icon: "shapes" },
  files: { labelKey: "nav.files", icon: "folder" },
  git: { labelKey: "nav.git", icon: "git-branch" },
  terminal: { labelKey: "nav.terminal", icon: "terminal-square" },
  devices: { labelKey: "nav.devices", icon: "link" },
  settings: { labelKey: "nav.settings", icon: "settings" },
};

const PRESET_LABEL_KEYS: Record<AppearanceId, MessageKey> = {
  "openbitfun-dark": "settings.appearance.presetDark",
  "openbitfun-light": "settings.appearance.presetLight",
  "openbitfun-monochrome": "settings.appearance.presetMonochrome",
  "openbitfun-slate": "settings.appearance.presetSlate",
  "openbitfun-midnight": "settings.appearance.presetMidnight",
  "openbitfun-china-style": "settings.appearance.presetChinaStyle",
  "openbitfun-china-night": "settings.appearance.presetChinaNight",
  "openbitfun-cyber": "settings.appearance.presetCyber",
  "openbitfun-tokyo-night": "settings.appearance.presetTokyoNight",
};

const PRIMARY_NAV_SCENES: ReadonlyArray<SceneId> = ["home", "sessions", "assistants"];
const STUDIO_ONLY_SCENES: ReadonlyArray<SceneId> = ["agents", "skills", "routines", "spaces"];
const WORKBENCH_NAV_SCENES: ReadonlyArray<SceneId> = ["files", "git", "terminal"];

const AUX_TABS: ReadonlyArray<{ id: AuxPaneTab; labelKey: MessageKey; icon: IconName }> = [
  { id: "files", labelKey: "nav.files", icon: "folder" },
  { id: "git", labelKey: "nav.git", icon: "git-branch" },
  { id: "terminal", labelKey: "nav.terminal", icon: "terminal-square" },
];

interface SearchCommandDef {
  id: string;
  target: SceneId | "";
  aliases: ReadonlyArray<string>;
  labelKey: MessageKey;
  detailKey: MessageKey;
}

const SEARCH_COMMANDS: ReadonlyArray<SearchCommandDef> = [
  {
    id: "command:new-session",
    target: "",
    aliases: ["new session", "new", "create", "thread"],
    labelKey: "search.cmdNewSession",
    detailKey: "search.cmdNewSessionDetail",
  },
  {
    id: "command:home",
    target: "home",
    aliases: ["home", "go to home", "overview"],
    labelKey: "search.cmdHome",
    detailKey: "search.cmdHomeDetail",
  },
  {
    id: "command:sessions",
    target: "sessions",
    aliases: ["sessions", "go to sessions", "chat", "threads"],
    labelKey: "search.cmdSessions",
    detailKey: "search.cmdSessionsDetail",
  },
  {
    id: "command:assistants",
    target: "assistants",
    aliases: ["assistants", "go to assistants", "persona"],
    labelKey: "search.cmdAssistants",
    detailKey: "search.cmdAssistantsDetail",
  },
  {
    id: "command:agents",
    target: "agents",
    aliases: ["agents", "go to agents", "bots", "subagents"],
    labelKey: "search.cmdAgents",
    detailKey: "search.cmdAgentsDetail",
  },
  {
    id: "command:skills",
    target: "skills",
    aliases: ["skills", "go to skills", "marketplace"],
    labelKey: "search.cmdSkills",
    detailKey: "search.cmdSkillsDetail",
  },
  {
    id: "command:routines",
    target: "routines",
    aliases: ["routines", "go to routines", "cron", "schedule"],
    labelKey: "search.cmdRoutines",
    detailKey: "search.cmdRoutinesDetail",
  },
  {
    id: "command:files",
    target: "files",
    aliases: ["files", "go to files", "explorer"],
    labelKey: "search.cmdFiles",
    detailKey: "search.cmdFilesDetail",
  },
  {
    id: "command:git",
    target: "git",
    aliases: ["git", "go to git", "source control", "diff"],
    labelKey: "search.cmdGit",
    detailKey: "search.cmdGitDetail",
  },
  {
    id: "command:terminal",
    target: "terminal",
    aliases: ["terminal", "go to terminal", "shell"],
    labelKey: "search.cmdTerminal",
    detailKey: "search.cmdTerminalDetail",
  },
  {
    id: "command:spaces",
    target: "spaces",
    aliases: ["spaces", "go to spaces", "miniapps"],
    labelKey: "search.cmdSpaces",
    detailKey: "search.cmdSpacesDetail",
  },
  {
    id: "command:devices",
    target: "devices",
    aliases: ["devices", "go to devices", "peer", "remote"],
    labelKey: "search.cmdDevices",
    detailKey: "search.cmdDevicesDetail",
  },
  {
    id: "command:settings",
    target: "settings",
    aliases: ["settings", "go to settings", "preferences"],
    labelKey: "search.cmdSettings",
    detailKey: "search.cmdSettingsDetail",
  },
];

interface SidebarPeerDevice {
  id: string;
  name: string;
  alias?: string;
  platform: string;
  online: boolean;
}

const studioGroupOpen = signal(true);
const showArchivedSessions = signal(false);
const archiveFilterOpen = signal(false);
const languageMenuOpen = signal(false);
const languageTriggerRef = signal<ViewRef | null>(null);
const appearanceMenuOpen = signal(false);
const appearanceTriggerRef = signal<ViewRef | null>(null);
const remoteMenuOpen = signal(false);
const remoteTriggerRef = signal<ViewRef | null>(null);
const deviceMenuOpen = signal(false);
const deviceTriggerRef = signal<ViewRef | null>(null);
const sidebarPeerDevices = signal<SidebarPeerDevice[]>([]);
const topbarWorkspaceMenuOpen = signal(false);
const topbarWorkspaceTriggerRef = signal<ViewRef | null>(null);
const workspaceActionMenuId = signal<string | null>(null);
const workspaceActionAnchor = signal<ViewRef | null>(null);
const workspaceContextPoint = signal<Point | null>(null);

interface SessionContextTarget {
  sessionId: string;
  title: string;
  archived: boolean;
}

const sessionContextTarget = signal<SessionContextTarget | null>(null);
const sessionContextPoint = signal<Point | null>(null);
const sessionContextAnchor = signal<ViewRef | null>(null);
const sessionRenameTarget = signal<SessionContextTarget | null>(null);
const sessionRenameDraft = signal("");
const sessionDeleteTarget = signal<SessionContextTarget | null>(null);

const sessionActivityCount = computed(
  () => Object.keys(runningTurns()).length + pendingPermissions().length,
);

const activeSessionRows = computed(() =>
  sessions().filter(item => !isSessionArchived(item)),
);

const archivedSessionRows = computed(() =>
  sessions().filter(item => isSessionArchived(item)),
);

const visibleSessionRows = computed(() =>
  showArchivedSessions() ? archivedSessionRows() : activeSessionRows(),
);

/**
 * Saved SSH hosts that are not already mounted in the Workspaces tree, avoiding
 * visually cloning an active remote workspace identically under SSH HOSTS.
 */
const unmountedSshHosts = computed(() => {
  const openConnectionIds = new Set(
    workspaces()
      .map(ws => ws.connectionId)
      .filter((id): id is string => Boolean(id)),
  );
  return savedConnections().filter(conn => !openConnectionIds.has(conn.id));
});

/** The width the sidebar drag has reached, beyond the clamp, while a drag runs. */
let navDragWidth: number | null = null;
const DEFAULT_AUX_WIDTH = 460;

function readRecordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function refreshSidebarDevices(): Promise<void> {
  try {
    await Promise.all([loadLocalDeviceId(), loadAccountState()]);
    const [list, online] = await Promise.all([
      invokeRawCommand<Array<Record<string, unknown>>>("account_list_devices").catch(
        () => [] as Array<Record<string, unknown>>,
      ),
      invokeRawCommand<Array<Record<string, unknown>>>("account_online_devices").catch(
        () => [] as Array<Record<string, unknown>>,
      ),
    ]);
    const onlineIds = new Set(
      (Array.isArray(online) ? online : [])
        .map(rec => readRecordString(rec ?? {}, ["deviceId", "device_id", "id"]))
        .filter(Boolean),
    );
    const parsed: SidebarPeerDevice[] = (Array.isArray(list) ? list : [])
      .map((rec): SidebarPeerDevice | null => {
        const record = rec ?? {};
        const id = readRecordString(record, ["deviceId", "device_id", "id"]);
        if (!id) return null;
        return {
          id,
          name: readRecordString(record, ["deviceName", "device_name", "name", "hostname"]) || id,
          alias:
            readRecordString(record, [
              "deviceAlias",
              "device_alias",
              "alias",
              "displayName",
              "display_name",
            ]) || undefined,
          platform: readRecordString(record, [
            "deviceOs",
            "device_os",
            "platform",
            "os",
            "deviceKind",
            "device_kind",
          ]),
          online:
            record.online === true ||
            record.is_online === true ||
            record.isOnline === true ||
            onlineIds.has(id),
        };
      })
      .filter((item): item is SidebarPeerDevice => item !== null);
    sidebarPeerDevices.set(parsed);
  } catch {
    // Hosts without account device relay degrade quietly to Local + SSH options.
  }
}

async function switchSidebarToPeer(device: SidebarPeerDevice): Promise<void> {
  if (!(await enterPeer(device.id, device.alias || device.name))) return;
  forgetTerminals();
  await resetForDeviceChange();
  navigateScene("sessions");
}

function peerDeviceIcon(platform: string): IconName {
  const lower = platform.toLowerCase();
  if (lower.includes("linux") || lower.includes("server")) return "server";
  if (lower.includes("win") || lower.includes("desktop")) return "monitor";
  return "laptop";
}

function handleTitlebarPressDown(event: PressEvent): void {
  if (event.clickCount >= 2) {
    toggleWindowMaximize();
    return;
  }
  startWindowDrag();
}

/**
 * How an empty stretch of a title bar moves the window. A native NSH window
 * declares the region (`desktop={{ windowDrag }}`: the system drags it and a
 * double click zooms); the Tauri webview starts the drag on the press.
 */
function titlebarDragRegionProps(): {
  desktop?: { windowDrag: boolean };
  onPressDown?: (event: PressEvent) => void;
} {
  return usesNativeDragRegions() ? { desktop: { windowDrag: true } } : { onPressDown: handleTitlebarPressDown };
}

/** The bar around those stretches: draggable where the system drags (its buttons stay pressable). */
function titlebarBarProps(): { desktop?: { windowDrag: boolean } } {
  return usesNativeDragRegions() ? { desktop: { windowDrag: true } } : {};
}

function toggleStudioGroup(): void {
  studioGroupOpen.update(open => !open);
}

function toggleWorkspaceCollapsed(workspaceId: string): void {
  collapsedWorkspaces.update(cur => ({
    ...cur,
    [workspaceId]: !cur[workspaceId],
  }));
}

function expandWorkspace(workspaceId: string): void {
  if (!collapsedWorkspaces()[workspaceId]) return;
  collapsedWorkspaces.update(cur => {
    const next = { ...cur };
    delete next[workspaceId];
    return next;
  });
}

function basenameLabel(rootPath: string, name?: string): string {
  if (name && name.trim()) return name.trim();
  const normalized = rootPath.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx >= 0 && idx < normalized.length - 1) return normalized.slice(idx + 1);
  return rootPath || tr("nav.workspaceFallback");
}

function sessionDisplayTitle(session: { sessionId: string; sessionName?: string }): string {
  const title = session.sessionName?.trim();
  return title && title.length > 0 ? title : session.sessionId;
}

function isLocalhostHost(host?: string | null): boolean {
  const normalized = (host ?? "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/**
 * Returns the real remote host label for a workspace, filtering out the
 * `"localhost"` sentinel that Rust `WorkspaceInfoDto` attaches to every local
 * and assistant workspace.
 */
function remoteSshHost(ws: {
  workspaceKind?: string;
  connectionId?: string;
  sshHost?: string;
}): string | undefined {
  const host = (ws.sshHost ?? "").trim();
  if (!host || isLocalhostHost(host)) return undefined;
  const kind = (ws.workspaceKind ?? "").trim().toLowerCase();
  if (kind === "assistant") return undefined;
  return host;
}

function isRemoteWorkspaceRecord(ws: {
  workspaceKind?: string;
  connectionId?: string;
  sshHost?: string;
}): boolean {
  const kind = (ws.workspaceKind ?? "").trim().toLowerCase();
  if (kind === "assistant") return false;
  return Boolean(
    ws.connectionId?.trim() ||
      remoteSshHost(ws) ||
      kind === "remote" ||
      kind.includes("ssh") ||
      kind.includes("remote") ||
      kind.includes("docker") ||
      kind.includes("container") ||
      kind.includes("wsl"),
  );
}

function workspaceKindIcon(ws: {
  workspaceKind?: string;
  connectionId?: string;
  sshHost?: string;
}): IconName {
  const kind = (ws.workspaceKind ?? "").trim().toLowerCase();
  if (kind === "assistant" || kind.includes("assistant")) return "bot";
  if (kind.includes("docker") || kind.includes("container")) return "container";
  if (kind.includes("wsl")) return "terminal";
  if (isRemoteWorkspaceRecord(ws)) return "server";
  return "folder";
}

function closeSessionMenus(): void {
  sessionContextTarget.set(null);
  sessionContextPoint.set(null);
  sessionContextAnchor.set(null);
}

function openSessionMenuAtPoint(target: SessionContextTarget, position: Point): void {
  sessionContextAnchor.set(null);
  sessionContextTarget.set(target);
  sessionContextPoint.set(position);
}

function openSessionMenuAtAnchor(target: SessionContextTarget, anchor: ViewRef | null): void {
  sessionContextPoint.set(null);
  sessionContextTarget.set(target);
  sessionContextAnchor.set(anchor);
}

async function duplicateSessionRow(target: SessionContextTarget): Promise<void> {
  selectSession(target.sessionId);
  await copyActiveSession();
  navigateScene("sessions");
}

/** Writes the session's Markdown transcript on the host and reveals the file. */
async function exportSessionMarkdown(target: SessionContextTarget): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) return;
  try {
    const exported = await invokeCommand<{ transcriptPath?: string; transcript_path?: string }>(
      "export_session_transcript",
      { session_id: target.sessionId, workspace_id: workspace.id, tools: true },
    );
    const path = exported?.transcriptPath ?? exported?.transcript_path ?? "";
    pushToast(tr("shell.session.exported", { title: target.title }), "success");
    if (path && !peerScope()) {
      await revealInExplorer(path, workspace.id).catch(() => undefined);
    }
  } catch (error) {
    pushToast(tr("shell.session.exportFailed", { error: errorText(error) }), "error");
  }
}

async function revealSessionStorage(target: SessionContextTarget): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) return;
  try {
    await invokeCommand<unknown>("reveal_session_storage_directory", {
      workspace_id: workspace.id,
      session_id: target.sessionId,
    });
  } catch (error) {
    pushToast(tr("shell.session.openStorageFailed", { error: errorText(error) }), "error");
  }
}

function sessionRowMenuItems(target: SessionContextTarget): DropdownMenuItem[] {
  return [
    {
      id: "session-open",
      label: tr("nav.openThread"),
      icon: "chat",
      onSelect: () => {
        selectSession(target.sessionId);
        navigateScene("sessions");
      },
    },
    {
      id: "session-rename",
      label: tr("common.renameEllipsis"),
      icon: "edit",
      onSelect: () => {
        sessionRenameDraft.set(target.title);
        sessionRenameTarget.set(target);
      },
    },
    {
      id: "session-duplicate",
      label: tr("shell.session.duplicate"),
      icon: "copy",
      onSelect: () => void duplicateSessionRow(target),
    },
    {
      id: "session-export",
      label: tr("shell.session.exportMarkdown"),
      icon: "download",
      separator: true,
      onSelect: () => void exportSessionMarkdown(target),
    },
    {
      id: "session-storage",
      label: tr("shell.session.openStorage"),
      icon: "folder-open",
      // The storage folder is on the host that keeps the session; a peer's has no file manager here.
      disabled: Boolean(peerScope()),
      hint: peerScope() ? tr("shell.ws.revealLocalOnly") : undefined,
      onSelect: () => void revealSessionStorage(target),
    },
    {
      id: "session-archive",
      label: target.archived ? tr("nav.restoreThread") : tr("nav.archiveThread"),
      icon: target.archived ? "undo" : "layers",
      separator: true,
      onSelect: () => {
        void archiveSessionRow(target.sessionId, !target.archived).then(() => {
          pushToast(
            target.archived
              ? tr("nav.restoredToast", { title: target.title })
              : tr("nav.archivedToast", { title: target.title }),
            "info",
          );
        });
      },
    },
    {
      id: "session-delete",
      label: tr("nav.deleteThread"),
      icon: "trash",
      danger: true,
      onSelect: () => {
        sessionDeleteTarget.set(target);
      },
    },
  ];
}

function sceneElement() {
  switch (activeScene()) {
    case "home":
      return <HomeScene />;
    case "assistants":
      return <AssistantsScene />;
    case "agents":
      return <AgentsScene />;
    case "skills":
      return <SkillsScene />;
    case "routines":
      return <RoutinesScene />;
    case "files":
      return <FilesScene />;
    case "git":
      return <GitScene />;
    case "terminal":
      return <TerminalScene />;
    case "spaces":
      return <SpacesScene />;
    case "devices":
      return <DevicesScene />;
    case "settings":
      return <SettingsScene />;
    default:
      return <SessionsScene />;
  }
}

function auxElement() {
  switch (auxPaneTab()) {
    case "git":
      return <GitScene compact />;
    case "terminal":
      return <TerminalScene compact />;
    default:
      return <FilesScene compact />;
  }
}

function NavRow(props: {
  label: string;
  icon: IconName;
  active: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
  badgeCount?: number;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={{
        height: 30,
        paddingHorizontal: 8,
        paddingVertical: 0,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: props.active ? palette().chromeActive : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.active ? palette().chromeActive : palette().chromeHover,
      }}
      activeStyle={{ backgroundColor: palette().chromeActive }}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().chromeAccent,
        outlineOffset: -1,
      }}
    >
      <Icon
        name={props.icon}
        size={16}
        color={props.active ? palette().chromeText : palette().chromeTextMuted}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().chromeText,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.3),
          fontWeight: props.active ? "500" : "400",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={(props.badgeCount ?? 0) > 0}>
        <Badge label={String(props.badgeCount ?? 0)} tone="accent" size="xs" surface="chrome" />
      </If>
    </View>
  );
}

function NavBar() {
  return (
    <View
      {...titlebarBarProps()}
      style={{
        height: 44,
        paddingLeft: trafficLightInsetPx() > 0 ? trafficLightInsetPx() : 10,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <IconButton
          icon="panel-left-close"
          size="sm"
          surface="chrome"
          active={false}
          accessibilityLabel="toggle-drawer"
          tooltip={
            <TooltipBubble
              text={tr("nav.toggleSidebar")}
              shortcut={shortcutLabel("mod+b", "⌘B")}
            />
          }
          onPress={toggleDrawer}
        />
        <IconButton
          icon="arrow-left"
          size="sm"
          surface="chrome"
          disabled={!canGoBack()}
          accessibilityLabel="nav-back"
          tooltip={tr("common.back")}
          onPress={goBackScene}
        />
        <IconButton
          icon="arrow-right"
          size="sm"
          surface="chrome"
          disabled={!canGoForward()}
          accessibilityLabel="nav-forward"
          tooltip={tr("common.forward")}
          onPress={goForwardScene}
        />
      </View>
      <View
        focusable={false}
        {...titlebarDragRegionProps()}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          cursor: "default",
        }}
      />
    </View>
  );
}

function SidebarDeviceSwitcher() {
  const menuItems = (): DropdownMenuItem[] => {
    const scope = peerScope();
    const localId = localDeviceId();
    const items: DropdownMenuItem[] = [
      {
        id: "sidebar-device-local",
        label: tr("devices.thisMachine"),
        icon: "laptop",
        trailingHint: tr("common.local"),
        active: !scope,
        onSelect: () => {
          if (peerScope()) {
            void returnToThisMachine();
          }
        },
      },
    ];

    // Account section: signed-in identity or crisp Sign-In CTA
    items.push({
      id: "sidebar-device-group-account",
      label: tr("nav.accountLabel"),
      header: true,
      separator: true,
    });
    if (isAccountSignedIn()) {
      const handle = githubUser()?.login
        ? `@${githubUser()!.login}`
        : accountStatus()?.userId || tr("home.signedIn");
      items.push({
        id: "sidebar-device-account-manage",
        label: handle,
        icon: "user",
        trailingHint: tr("home.signedIn"),
        accessibilityLabel: "sidebar-account-manage",
        onSelect: () =>
          openAccountAuthModal({
            onSuccess: () => refreshSidebarDevices(),
          }),
      });
    } else {
      items.push({
        id: "sidebar-device-account-signin",
        label: tr("nav.signInAccount"),
        icon: "log-in",
        trailingHint: tr("devices.accountSignedOut"),
        accessibilityLabel: "sidebar-account-sign-in",
        onSelect: () =>
          openAccountAuthModal({
            onSuccess: () => refreshSidebarDevices(),
          }),
      });
    }

    const remotes = sidebarPeerDevices().filter(dev => !localId || dev.id !== localId);
    if (remotes.length > 0) {
      items.push({
        id: "sidebar-device-group-peers",
        label: tr("nav.peerDevicesGroup"),
        header: true,
        separator: true,
      });
      for (const dev of remotes) {
        const isActivePeer = scope?.deviceId === dev.id;
        items.push({
          id: `sidebar-device-peer-${dev.id}`,
          label: dev.alias || dev.name,
          icon: peerDeviceIcon(dev.platform),
          trailingHint: isActivePeer
            ? tr("devices.activePeer")
            : dev.online
              ? tr("nav.online")
              : tr("nav.offline"),
          active: isActivePeer,
          disabled: !dev.online && !isActivePeer,
          onSelect: () => {
            if (dev.online && !isActivePeer) {
              void switchSidebarToPeer(dev);
            }
          },
        });
      }
    }

    const sshList = savedConnections().slice(0, 4);
    if (sshList.length > 0) {
      items.push({
        id: "sidebar-device-group-ssh",
        label: tr("nav.sshHostsGroup"),
        header: true,
        separator: true,
      });
      for (const conn of sshList) {
        const status = connectionStatuses()[conn.id] ?? "disconnected";
        items.push({
          id: `sidebar-device-ssh-${conn.id}`,
          label: conn.name || `${conn.username}@${conn.host}`,
          icon: conn.container ? "container" : conn.wsl ? "terminal-square" : "server",
          trailingHint: status === "connected" ? tr("common.connected") : tr("ssh.ssh"),
          onSelect: () => {
            void quickConnectSavedConnection(conn, { browseAfterConnect: true });
          },
        });
      }
    }

    items.push(
      {
        id: "sidebar-device-ssh-manage",
        label: tr("nav.sshConnections"),
        icon: "plug",
        separator: true,
        onSelect: () => void openSshConnectionModal(),
      },
      {
        id: "sidebar-device-manage",
        label: tr("nav.manageDevices"),
        icon: "link",
        onSelect: () => navigateScene("devices"),
      },
    );

    return items;
  };

  return (
    <View ref={el => deviceTriggerRef.set(el)} style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
      <View
        role="button"
        accessibilityLabel="nav-device-switcher-trigger"
        accessibilityState={{ expanded: deviceMenuOpen() }}
        onPress={() => {
          const next = !deviceMenuOpen();
          deviceMenuOpen.set(next);
          if (next) void refreshSidebarDevices();
        }}
        style={{
          height: 30,
          paddingHorizontal: 8,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: peerScope() ? palette().accentBorder : palette().chromeBorder,
          backgroundColor: peerScope() ? palette().chromeActive : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor: peerScope() ? palette().chromeActive : palette().chromeHover,
        }}
        activeStyle={{ backgroundColor: palette().chromeActive }}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().chromeAccent,
          outlineOffset: -1,
        }}
      >
        <Icon
          name={peerScope() ? "server" : "laptop"}
          size={13.5}
          color={peerScope() ? palette().chromeAccent : palette().chromeTextMuted}
        />
        <StatusDot
          surface="chrome"
          kind={peerScope() ? "accent" : "success"}
          size={5}
          pulse={peerReconnecting()}
        />
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().chromeText,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.32),
            fontWeight: peerScope() ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {peerScope() ? peerScope()!.label : tr("devices.thisMachine")}
        </Text>
        <If when={Boolean(peerScope())}>
          <Badge label={tr("devices.activePeer")} tone="accent" size="xs" surface="chrome" />
        </If>
        <Icon name="chevron-down" size={11} color={palette().chromeTextMuted} />
      </View>

      <DropdownMenu
        open={deviceMenuOpen()}
        anchor={deviceTriggerRef()}
        placement="bottom"
        align="start"
        minWidth={248}
        items={menuItems()}
        onClose={() => deviceMenuOpen.set(false)}
      />
    </View>
  );
}


function SessionSidebarRow(props: {
  sessionId: string;
  title: string;
  active: boolean;
  archived: boolean;
  statusLabel?: string;
  statusKind?: "running" | "approval" | "queued" | "unread" | "failed";
  onPress: () => void;
}) {
  const hovered = signal(false);
  const actionsAnchor = signal<ViewRef | null>(null);
  const showMenu = () => hovered() || sessionContextTarget()?.sessionId === props.sessionId;
  const renaming = () => sessionRenameTarget()?.sessionId === props.sessionId;
  const target = (): SessionContextTarget => ({
    sessionId: props.sessionId,
    title: props.title,
    archived: props.archived,
  });
  const commitRename = (text: string) => {
    const next = text.trim();
    sessionRenameTarget.set(null);
    if (next && next !== props.title) void renameSession(props.sessionId, next);
  };

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onContextMenu={e => openSessionMenuAtPoint(target(), e.pagePosition)}
      style={{
        position: "relative",
        height: 26,
        paddingLeft: 8,
        paddingRight: 4,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        borderWidth: 0,
        backgroundColor: props.active ? palette().chromeActive : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.active ? palette().chromeActive : palette().chromeHover,
      }}
    >
      <If
        when={renaming()}
        else={
          <View
            role="button"
            accessibilityLabel={props.title}
            accessibilityState={{ selected: props.active }}
            onPress={props.onPress}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              borderRadius: radii.xs,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            activeStyle={{ opacity: 0.86 }}
            focusVisibleStyle={{
              outlineWidth: 2,
              outlineColor: palette().chromeAccent,
              outlineOffset: -1,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: props.active ? palette().chromeText : palette().chromeTextMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.3),
                fontWeight: props.active ? "500" : "400",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.title}
            </Text>
          </View>
        }
      >
        <Input
          autoFocus
          value={sessionRenameDraft()}
          accessibilityLabel={`session-rename-input-${props.sessionId}`}
          submitBehavior="submit"
          style={{
            flex: 1,
            minWidth: 0,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: radii.xs,
            borderWidth: 1,
            borderColor: palette().chromeAccent,
            backgroundColor: palette().chromeInputBg,
            color: palette().chromeText,
            placeholderColor: palette().chromeTextMuted,
            caretColor: palette().chromeAccent,
            fontSize: textSize(13),
          }}
          onChange={event => sessionRenameDraft.set(event.value)}
          onSubmit={event => commitRename(event.text)}
          onKeyPress={event => {
            if (event.key === "Escape") sessionRenameTarget.set(null);
          }}
        />
      </If>

      <If when={showMenu() || renaming() ? "" : (props.statusLabel ?? "")}>
        {labelText => (
          <View
            accessibilityLabel={`status-${labelText()}`}
            tooltip={<TooltipBubble text={labelText()} />}
            style={{ flexShrink: 0, width: 16, alignItems: "center", justifyContent: "center" }}
          >
            <StatusDot
              surface="chrome"
              kind={
                props.statusKind === "running" || props.statusKind === "unread"
                  ? "accent"
                  : props.statusKind === "approval" || props.statusKind === "queued"
                    ? "warning"
                    : "danger"
              }
              size={5}
              pulse={props.statusKind === "running"}
            />
          </View>
        )}
      </If>

      <If when={!renaming()}>
        <View
          ref={el => actionsAnchor.set(el)}
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            opacity: showMenu() ? 1 : 0,
            marginLeft: showMenu() ? 0 : -20,
            ...paintTransition(MOTION_DURATION.fast),
          }}
          focusWithinStyle={{ opacity: 1, marginLeft: 0 }}
        >
          <IconButton
            icon="more"
            size="xs"
            iconSize={12}
            surface="chrome"
            style={{ width: 20, height: 20 }}
            accessibilityLabel={`session-row-actions-${props.sessionId}`}
            tooltip={tr("nav.threadActions")}
            onPress={() => openSessionMenuAtAnchor(target(), actionsAnchor())}
          />
        </View>
      </If>
    </View>
  );
}

// ── Sessions per workspace (lazy, keyed by workspace id) ─────────────────────

const SESSION_PREVIEW_COUNT = 10;
const OTHER_WORKSPACE_PAGE = 20;
/** Workspaces other than the active one that the user unfolded in the sidebar. */
const otherWorkspaceExpanded = signal<Record<string, boolean>>({});
/** Rows past the preview are drawn only for workspaces whose list was expanded. */
const sessionPreviewExpanded = signal<Record<string, boolean>>({});

interface OtherWorkspaceSessions {
  rows: SessionSummary[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  cursor: string | null;
}
const otherWorkspaceSessions = signal<Record<string, OtherWorkspaceSessions>>({});
const EMPTY_OTHER_SESSIONS: OtherWorkspaceSessions = {
  rows: [],
  loading: false,
  error: "",
  hasMore: false,
  cursor: null,
};

/** Reads one page of another workspace's catalogue; `more` appends the next page. */
async function loadOtherWorkspaceSessions(workspaceId: string, more = false): Promise<void> {
  const current = otherWorkspaceSessions()[workspaceId];
  if (current?.loading) return;
  if (more && !current?.cursor) return;
  const patch = (next: Partial<OtherWorkspaceSessions>) =>
    otherWorkspaceSessions.update(all => ({
      ...all,
      [workspaceId]: {
        ...(all[workspaceId] ?? EMPTY_OTHER_SESSIONS),
        ...next,
      },
    }));
  patch({ loading: true, error: "" });
  try {
    const page = await listSessions(
      workspaceId,
      OTHER_WORKSPACE_PAGE,
      more ? current?.cursor ?? undefined : undefined,
    );
    const incoming = (page.sessions ?? []).filter(item => !isSessionArchived(item));
    const known = more ? otherWorkspaceSessions()[workspaceId]?.rows ?? [] : [];
    const seen = new Set(known.map(item => item.sessionId));
    patch({
      rows: [...known, ...incoming.filter(item => !seen.has(item.sessionId))],
      loading: false,
      hasMore: page.hasMore === true,
      cursor: page.nextCursor ?? null,
    });
    if (more) sessionPreviewExpanded.update(cur => ({ ...cur, [workspaceId]: true }));
  } catch (error) {
    patch({ loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function previewRows(workspaceId: string, rows: SessionSummary[]): SessionSummary[] {
  return sessionPreviewExpanded()[workspaceId] ? rows : rows.slice(0, SESSION_PREVIEW_COUNT);
}

function SidebarHint(props: { text: string; tone?: "danger" }) {
  return (
    <Text
      style={{
        paddingHorizontal: 8,
        paddingVertical: 5,
        color: props.tone === "danger" ? palette().danger : palette().chromeTextMuted,
        fontSize: textSize(12),
        lineHeight: textLineHeight(12, 1.4),
      }}
    >
      {props.text}
    </Text>
  );
}

function SidebarTextButton(props: { label: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={{
        minHeight: 26,
        justifyContent: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().chromeHover }}
      activeStyle={{ backgroundColor: palette().chromeActive }}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().chromeAccent,
        outlineOffset: -1,
      }}
    >
      <Text
        style={{
          color: palette().chromeTextMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
          fontWeight: "500",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * Under a workspace's sessions: "Show N more" past the preview, "Show less" once
 * expanded, and the host's next page when the loaded rows are all shown.
 */
function SessionListFooter(props: {
  workspaceId: string;
  total: number;
  hostHasMore: boolean;
  accessibilityLabel: string;
  onLoadMore: () => void;
}) {
  const expandedList = () => Boolean(sessionPreviewExpanded()[props.workspaceId]);
  const hidden = () => Math.max(0, props.total - SESSION_PREVIEW_COUNT);
  return (
    <View style={{ gap: 1 }}>
      <If when={!expandedList() && hidden() > 0}>
        <SidebarTextButton
          label={tr("shell.showMore", { count: hidden() })}
          accessibilityLabel={`sessions-show-more-${props.workspaceId}`}
          onPress={() => sessionPreviewExpanded.update(cur => ({ ...cur, [props.workspaceId]: true }))}
        />
      </If>
      <If when={(expandedList() || hidden() === 0) && props.hostHasMore}>
        <SidebarTextButton
          label={tr("nav.loadMoreThreads")}
          accessibilityLabel={props.accessibilityLabel}
          onPress={props.onLoadMore}
        />
      </If>
      <If when={expandedList() && hidden() > 0}>
        <SidebarTextButton
          label={tr("shell.showLess")}
          accessibilityLabel={`sessions-show-less-${props.workspaceId}`}
          onPress={() => sessionPreviewExpanded.update(cur => ({ ...cur, [props.workspaceId]: false }))}
        />
      </If>
    </View>
  );
}

function WorkspaceRowBlock(props: {
  id: string;
  name: string;
  rootPath: string;
  connectionId?: string;
  sshHost?: string;
  workspaceKind?: string;
  showNestedSessions: boolean;
}) {
  const actionsBtnRef = signal<ViewRef | null>(null);
  const hovered = signal(false);
  const isCurrent = () => activeWorkspace()?.id === props.id;
  const isCollapsed = () => Boolean(collapsedWorkspaces()[props.id]);
  /** The active workspace is open unless folded; another one only when unfolded. */
  const expanded = () =>
    props.showNestedSessions &&
    (isCurrent() ? !isCollapsed() : Boolean(otherWorkspaceExpanded()[props.id]));
  const toggleExpanded = () => {
    if (isCurrent()) {
      toggleWorkspaceCollapsed(props.id);
      return;
    }
    const next = !otherWorkspaceExpanded()[props.id];
    otherWorkspaceExpanded.update(cur => ({ ...cur, [props.id]: next }));
    if (next) void loadOtherWorkspaceSessions(props.id);
  };
  const remoteHost = () =>
    remoteSshHost({
      workspaceKind: props.workspaceKind,
      connectionId: props.connectionId,
      sshHost: props.sshHost,
    });
  const isRemote = () =>
    isRemoteWorkspaceRecord({
      workspaceKind: props.workspaceKind,
      connectionId: props.connectionId,
      sshHost: props.sshHost,
    });
  const connStatus = () =>
    props.connectionId ? connectionStatuses()[props.connectionId] ?? "disconnected" : null;
  const showActions = () => hovered() || workspaceActionMenuId() === props.id;

  const openActionsMenu = () => {
    workspaceContextPoint.set(null);
    workspaceActionAnchor.set(actionsBtnRef());
    workspaceActionMenuId.set(workspaceActionMenuId() === props.id ? null : props.id);
  };

  return (
    <View style={{ gap: 1 }}>
      {/* 30px collapsible workspace header; the actions sit over the trailing count on hover */}
      <View
        onMouseEnter={() => hovered.set(true)}
        onMouseLeave={() => hovered.set(false)}
        onContextMenu={e => {
          workspaceActionAnchor.set(null);
          workspaceContextPoint.set(e.pagePosition);
          workspaceActionMenuId.set(props.id);
        }}
        style={{
          position: "relative",
          minHeight: 30,
          height: 30,
          paddingLeft: 4,
          paddingRight: 6,
          borderRadius: radii.xs,
          borderCurve: "continuous",
          backgroundColor: "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor: palette().chromeHover,
        }}
      >
        <View
          role="button"
          accessibilityLabel={`workspace-row-${props.id}`}
          accessibilityState={{
            selected: isCurrent(),
            expanded: expanded(),
          }}
          tooltip={
            <TooltipBubble
              text={remoteHost() ? `${remoteHost()} · ${props.rootPath}` : props.rootPath}
            />
          }
          onPress={() => {
            if (isCurrent() && props.showNestedSessions) {
              toggleWorkspaceCollapsed(props.id);
            } else {
              expandWorkspace(props.id);
              selectWorkspace(props.id);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            borderRadius: radii.xs,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          activeStyle={{ opacity: 0.86 }}
          focusVisibleStyle={{
            outlineWidth: 2,
            outlineColor: palette().chromeAccent,
            outlineOffset: -1,
          }}
        >
          <View
            role="button"
            hitSlop={4}
            accessibilityLabel={`workspace-expand-${props.id}`}
            accessibilityState={{ expanded: expanded() }}
            onPress={toggleExpanded}
            style={{
              width: 14,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radii.xs,
              cursor: "pointer",
            }}
            hoverStyle={{ backgroundColor: palette().chromeActive }}
          >
            <Icon
              name={expanded() ? "chevron-down" : "chevron-right"}
              size={11}
              color={palette().chromeTextMuted}
            />
          </View>
          <Icon
            name={workspaceKindIcon({
              workspaceKind: props.workspaceKind,
              connectionId: props.connectionId,
              sshHost: props.sshHost,
            })}
            size={16}
            color={isCurrent() ? palette().chromeAccent : palette().chromeTextMuted}
          />
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: isCurrent() ? palette().chromeText : palette().chromeTextMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.3),
                fontWeight: "600",
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {basenameLabel(props.rootPath, props.name)}
            </Text>
            <If when={isRemote()}>
              <Badge label={tr("ssh.ssh")} tone="neutral" size="xs" surface="chrome" />
            </If>
          </View>
          <View style={{ opacity: showActions() ? 0 : 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <If when={isRemote() && Boolean(props.connectionId)}>
              <StatusDot
                surface="chrome"
                kind={
                  connStatus() === "connected"
                    ? "success"
                    : connStatus() === "connecting"
                      ? "warning"
                      : connStatus() === "error"
                        ? "danger"
                        : "muted"
                }
                size={5}
                pulse={connStatus() === "connecting"}
              />
            </If>
            <If
              when={
                isCurrent() &&
                props.showNestedSessions &&
                !showArchivedSessions() &&
                sessionTotal() > 0
              }
            >
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().chromeTextMuted,
                  fontSize: textSize(11),
                  lineHeight: textLineHeight(11, 1.3),
                  fontWeight: "500",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {String(sessionTotal())}
              </Text>
            </If>
          </View>
        </View>

        {/* One set of actions, always mounted: hidden until hover or keyboard focus. */}
        <View
          style={{
            position: "absolute",
            right: 3,
            top: 4,
            flexDirection: "row",
            alignItems: "center",
            gap: 1,
            opacity: showActions() ? 1 : 0,
            ...paintTransition(MOTION_DURATION.fast),
          }}
          focusWithinStyle={{ opacity: 1 }}
        >
          <IconButton
            icon="plus"
            size="xs"
            iconSize={12}
            surface="chrome"
            style={{ width: 22, height: 22 }}
            accessibilityLabel={`workspace-new-session-${props.id}`}
            tooltip={tr("nav.newSession")}
            onPress={() => {
              expandWorkspace(props.id);
              selectWorkspace(props.id);
              void createSessionInWorkspace(tr("nav.newSession"));
              navigateScene("sessions");
            }}
          />
          <View ref={el => actionsBtnRef.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="xs"
              iconSize={12}
              surface="chrome"
              style={{ width: 22, height: 22 }}
              accessibilityLabel={`workspace-actions-${props.id}`}
              tooltip={tr("nav.workspaceOptions")}
              onPress={openActionsMenu}
            />
          </View>
        </View>
      </View>

      <If when={expanded() && isCurrent()}>
        <View style={{ paddingLeft: 20, paddingVertical: 1, gap: 1 }}>
          <Each of={previewRows(props.id, visibleSessionRows())} key={item => item.sessionId}>
            {row => {
              const mark = () =>
                statusOfSession()(
                  row().sessionId,
                  row().lastUpdated,
                  row().messageCount,
                );
              return (
                <SessionSidebarRow
                  sessionId={row().sessionId}
                  title={sessionDisplayTitle(row())}
                  active={activeSessionId() === row().sessionId}
                  archived={isSessionArchived(row())}
                  statusLabel={mark()?.label}
                  statusKind={mark()?.kind}
                  onPress={() => {
                    selectSession(row().sessionId);
                    navigateScene("sessions");
                  }}
                />
              );
            }}
          </Each>
          <If when={visibleSessionRows().length === 0}>
            <SidebarHint
              text={showArchivedSessions() ? tr("nav.noArchivedSessions") : tr("nav.noSessions")}
            />
          </If>
          <SessionListFooter
            workspaceId={props.id}
            total={visibleSessionRows().length}
            hostHasMore={!showArchivedSessions() && sessionHasMore()}
            accessibilityLabel="load-more-sessions"
            onLoadMore={() => void loadMoreSessions()}
          />
        </View>
      </If>

      {/* Another workspace's sessions, read when its row unfolds, without switching to it */}
      <If when={expanded() && !isCurrent()}>
        <View style={{ paddingLeft: 20, paddingVertical: 1, gap: 1 }}>
          <If when={otherWorkspaceSessions()[props.id]?.loading && !otherWorkspaceSessions()[props.id]?.rows.length}>
            <SidebarHint text={tr("shell.sessionsLoading")} />
          </If>
          <If when={otherWorkspaceSessions()[props.id]?.error ?? ""}>
            {message => <SidebarHint text={localizeHostError(message())} tone="danger" />}
          </If>
          <Each
            of={previewRows(props.id, otherWorkspaceSessions()[props.id]?.rows ?? [])}
            key={item => item.sessionId}
          >
            {row => (
              <SessionSidebarRow
                sessionId={row().sessionId}
                title={sessionDisplayTitle(row())}
                active={false}
                archived={isSessionArchived(row())}
                onPress={() => {
                  const sessionId = row().sessionId;
                  selectWorkspace(props.id);
                  selectSession(sessionId);
                  navigateScene("sessions");
                }}
              />
            )}
          </Each>
          <If
            when={
              otherWorkspaceSessions()[props.id] !== undefined &&
              !otherWorkspaceSessions()[props.id]!.loading &&
              !otherWorkspaceSessions()[props.id]!.error &&
              otherWorkspaceSessions()[props.id]!.rows.length === 0
            }
          >
            <SidebarHint text={tr("nav.noSessions")} />
          </If>
          <SessionListFooter
            workspaceId={props.id}
            total={otherWorkspaceSessions()[props.id]?.rows.length ?? 0}
            hostHasMore={Boolean(otherWorkspaceSessions()[props.id]?.hasMore)}
            accessibilityLabel={`load-more-sessions-${props.id}`}
            onLoadMore={() => void loadOtherWorkspaceSessions(props.id, true)}
          />
        </View>
      </If>
    </View>
  );
}

/** Placeholder rows while the first workspace read is in flight (never "No workspace"). */
function SidebarSkeleton() {
  const widths = [0.62, 0.48, 0.7];
  return (
    <View accessibilityLabel={tr("shell.sidebarLoading")} style={{ gap: 4, paddingVertical: 2 }}>
      <Each of={widths} key={(_w, index) => String(index)}>
        {width => (
          <View
            style={{
              height: 30,
              paddingHorizontal: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                backgroundColor: palette().chromeHover,
              }}
            />
            <View
              style={{
                height: 10,
                width: `${Math.round(width() * 100)}%`,
                borderRadius: 5,
                backgroundColor: palette().chromeHover,
              }}
            />
          </View>
        )}
      </Each>
    </View>
  );
}

const RECENT_PREVIEW_COUNT = 5;
const recentExpanded = signal(false);

/**
 * Workspaces the host remembers but has not opened. A press reopens one through
 * `open_workspace` (the host makes it active), and the row's remove action drops
 * it from the host's recent list with `remove_recent_workspace`.
 */
function RecentWorkspacesGroup() {
  const visible = () =>
    recentExpanded() ? recentWorkspaces() : recentWorkspaces().slice(0, RECENT_PREVIEW_COUNT);
  const hiddenCount = () => Math.max(0, recentWorkspaces().length - RECENT_PREVIEW_COUNT);
  return (
    <If when={recentWorkspaces().length > 0}>
      <View style={{ gap: 2, paddingTop: 6 }}>
        <View style={{ height: 24, paddingLeft: 8, flexDirection: "row", alignItems: "center" }}>
          <Text
            style={{
              color: palette().chromeTextMuted,
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.3),
              fontWeight: "500",
              numberOfLines: 1,
            }}
          >
            {tr("shell.recent")}
          </Text>
        </View>
        <Each of={visible()} key={ws => ws.id}>
          {ws => <RecentWorkspaceRow record={ws()} />}
        </Each>
        <If when={hiddenCount() > 0}>
          <View
            role="button"
            accessibilityLabel="recent-workspaces-toggle"
            onPress={() => recentExpanded.update(open => !open)}
            style={{
              height: 26,
              paddingHorizontal: 8,
              justifyContent: "center",
              borderRadius: radii.sm,
              borderCurve: "continuous",
              cursor: "pointer",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().chromeHover }}
            focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().chromeAccent, outlineOffset: -1 }}
          >
            <Text
              style={{
                color: palette().chromeTextMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
              }}
            >
              {recentExpanded() ? tr("shell.showLess") : tr("shell.showMore", { count: hiddenCount() })}
            </Text>
          </View>
        </If>
      </View>
    </If>
  );
}

function RecentWorkspaceRow(props: { record: WorkspaceRecord }) {
  const hovered = signal(false);
  const label = () => basenameLabel(props.record.rootPath, props.record.name);
  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        height: 30,
        paddingLeft: 8,
        paddingRight: 3,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().chromeHover }}
    >
      <View
        role="button"
        accessibilityLabel={`recent-workspace-${props.record.id}`}
        tooltip={<TooltipBubble text={tr("shell.recentReopen", { path: props.record.rootPath })} />}
        onPress={() => void openRecentWorkspace(props.record)}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
        focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().chromeAccent, outlineOffset: -1 }}
      >
        <Icon name={workspaceKindIcon(props.record)} size={15} color={palette().chromeTextMuted} />
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().chromeTextMuted,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.3),
            fontWeight: "400",
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {label()}
        </Text>
      </View>
      <View style={{ opacity: hovered() ? 1 : 0, flexShrink: 0 }} focusWithinStyle={{ opacity: 1 }}>
        <IconButton
          icon="close"
          size="xs"
          iconSize={11}
          surface="chrome"
          style={{ width: 22, height: 22 }}
          accessibilityLabel={`recent-workspace-remove-${props.record.id}`}
          tooltip={tr("shell.recentRemove")}
          onPress={() => {
            const name = label();
            void forgetRecentWorkspace(props.record.id).then(() => {
              if (!recentWorkspaces().some(item => item.id === props.record.id)) {
                pushToast(tr("shell.recentRemoved", { name }), "info");
              }
            });
          }}
        />
      </View>
    </View>
  );
}

interface WorkspaceTarget {
  id: string;
  name: string;
  rootPath: string;
}

const workspaceRenameTarget = signal<WorkspaceTarget | null>(null);
const workspaceRenameDraft = signal("");
const assistantActionTarget = signal<(WorkspaceTarget & { kind: "reset" | "delete" }) | null>(null);
const assistantActionBusy = signal(false);

function isAssistantWorkspace(ws: { workspaceKind?: string }): boolean {
  return (ws.workspaceKind ?? "").trim().toLowerCase().includes("assistant");
}

function errorText(error: unknown): string {
  return localizeHostError(error instanceof Error ? error.message : String(error));
}

async function copyWorkspacePath(path: string): Promise<void> {
  try {
    await Clipboard.writeText(path);
    pushToast(tr("shell.ws.pathCopied"), "success");
  } catch (error) {
    pushToast(tr("shell.ws.copyPathFailed", { error: errorText(error) }), "error");
  }
}

async function revealWorkspaceFolder(ws: WorkspaceTarget): Promise<void> {
  try {
    await revealInExplorer(ws.rootPath, ws.id);
  } catch (error) {
    pushToast(tr("shell.ws.revealFailed", { error: errorText(error) }), "error");
  }
}

async function runAssistantAction(): Promise<void> {
  const target = assistantActionTarget();
  if (!target || assistantActionBusy()) return;
  assistantActionBusy.set(true);
  try {
    if (target.kind === "reset") {
      await invokeCommand<unknown>("reset_assistant_workspace", { workspaceId: target.id });
      pushToast(tr("shell.ws.assistantReset", { name: target.name }), "success");
    } else {
      await invokeCommand<unknown>("delete_assistant_workspace", { workspaceId: target.id });
      pushToast(tr("shell.ws.assistantDeleted", { name: target.name }), "success");
    }
    assistantActionTarget.set(null);
    await loadWorkspaces();
  } catch (error) {
    pushToast(errorText(error), "error");
  } finally {
    assistantActionBusy.set(false);
  }
}

function workspaceDropdownItems(workspaceId: string): DropdownMenuItem[] {
  const ws = workspaces().find(item => item.id === workspaceId);
  if (!ws) return [];
  const remote = isRemoteWorkspaceRecord(ws);
  const target: WorkspaceTarget = {
    id: ws.id,
    name: basenameLabel(ws.rootPath, ws.name),
    rootPath: ws.rootPath,
  };
  const focusWorkspace = () => {
    expandWorkspace(ws.id);
    selectWorkspace(ws.id);
  };
  const items: DropdownMenuItem[] = [
    {
      id: "new-session",
      label: tr("nav.newSession"),
      icon: "plus",
      onSelect: () => {
        focusWorkspace();
        void createSessionInWorkspace(tr("nav.newSession"));
        navigateScene("sessions");
      },
    },
    {
      id: "new-terminal",
      label: tr("shell.ws.newTerminal"),
      icon: "terminal-square",
      onSelect: () => {
        focusWorkspace();
        navigateScene("terminal");
        void openTerminal(ws.id, ws.rootPath);
      },
    },
    {
      id: "open-files",
      label: tr("shell.ws.openFiles"),
      icon: "folder-open",
      onSelect: () => {
        focusWorkspace();
        navigateScene("files");
      },
    },
    {
      id: "rename-workspace",
      label: tr("common.renameEllipsis"),
      icon: "edit",
      separator: true,
      onSelect: () => {
        workspaceRenameDraft.set(target.name);
        workspaceRenameTarget.set(target);
      },
    },
    {
      id: "copy-path",
      label: tr("shell.ws.copyPath"),
      icon: "copy",
      onSelect: () => void copyWorkspacePath(ws.rootPath),
    },
    {
      id: "reveal-workspace",
      label: tr("shell.ws.reveal"),
      icon: "external-link",
      // The file manager is this machine's: a remote root or a peer's folder has none here.
      disabled: remote || Boolean(peerScope()),
      hint: remote || peerScope() ? tr("shell.ws.revealLocalOnly") : undefined,
      onSelect: () => void revealWorkspaceFolder(target),
    },
  ];
  if (ws.connectionId) {
    const host = remoteSshHost(ws);
    items.push(
      {
        id: "remote-browse",
        label: tr("nav.browseRemoteFiles"),
        icon: "folder",
        separator: true,
        onSelect: () =>
          void openRemoteFileBrowser(ws.connectionId!, ws.rootPath, {
            connectionName: ws.name,
            sshHost: host,
          }),
      },
      {
        id: "port-forward",
        label: tr("nav.portForwardingEllipsis"),
        icon: "network",
        onSelect: () => void openPortForwardModal(ws.connectionId!, host ?? ws.name),
      },
      {
        id: "ssh-disconnect",
        label:
          connectionStatuses()[ws.connectionId] === "connected"
            ? tr("nav.disconnectSsh")
            : tr("nav.manageSshConnection"),
        icon: "server",
        onSelect: () => {
          if (connectionStatuses()[ws.connectionId!] === "connected") {
            void disconnectSsh(ws.connectionId!);
          } else {
            void openSshConnectionModal(ws.connectionId);
          }
        },
      },
    );
  }
  if (isAssistantWorkspace(ws)) {
    items.push(
      {
        id: "reset-assistant",
        label: tr("shell.ws.resetAssistant"),
        icon: "undo",
        separator: true,
        onSelect: () => assistantActionTarget.set({ ...target, kind: "reset" }),
      },
      {
        id: "delete-assistant",
        label: tr("shell.ws.deleteAssistant"),
        icon: "trash",
        danger: true,
        onSelect: () => assistantActionTarget.set({ ...target, kind: "delete" }),
      },
    );
  }
  items.push({
    id: "close-workspace",
    label: tr("nav.closeWorkspace"),
    icon: "close",
    danger: !isAssistantWorkspace(ws),
    separator: !isAssistantWorkspace(ws),
    onSelect: () => {
      if (ws.connectionId) {
        void closeWorkspaceRecord(ws.id);
      } else {
        void closeWorkspace(ws.id);
      }
    },
  });
  return items;
}

/** Rename and assistant reset/delete confirmations opened from a workspace menu. */
function WorkspaceDialogs() {
  const submitRename = () => {
    const target = workspaceRenameTarget();
    const next = workspaceRenameDraft().trim();
    workspaceRenameTarget.set(null);
    if (target && next && next !== target.name) void renameWorkspace(target.id, next);
  };
  return (
    <View>
      <ModalDialog
        open={Boolean(workspaceRenameTarget())}
        title={tr("shell.ws.renameTitle")}
        size="sm"
        accessibilityLabel="workspace-rename-modal"
        onClose={() => workspaceRenameTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              onPress={() => workspaceRenameTarget.set(null)}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              disabled={!workspaceRenameDraft().trim()}
              accessibilityLabel="workspace-rename-save"
              onPress={submitRename}
            />
          </View>
        }
      >
        <TextField
          autoFocus
          label={tr("shell.ws.nameLabel")}
          value={workspaceRenameDraft()}
          accessibilityLabel="workspace-rename-input"
          onChange={v => workspaceRenameDraft.set(v)}
          onSubmit={() => submitRename()}
        />
      </ModalDialog>

      <ModalDialog
        open={Boolean(assistantActionTarget())}
        title={
          assistantActionTarget()?.kind === "delete"
            ? tr("shell.ws.deleteAssistantTitle", { name: assistantActionTarget()?.name ?? "" })
            : tr("shell.ws.resetAssistantTitle", { name: assistantActionTarget()?.name ?? "" })
        }
        size="sm"
        accessibilityLabel="assistant-action-modal"
        onClose={() => assistantActionTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              onPress={() => assistantActionTarget.set(null)}
            />
            <Button
              label={
                assistantActionTarget()?.kind === "delete"
                  ? tr("common.delete")
                  : tr("shell.ws.resetConfirm")
              }
              variant="danger"
              size="sm"
              loading={assistantActionBusy()}
              accessibilityLabel="assistant-action-confirm"
              onPress={() => void runAssistantAction()}
            />
          </View>
        }
      >
        <View style={{ gap: 8 }}>
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {assistantActionTarget()?.kind === "delete"
              ? tr("shell.ws.deleteAssistantMessage")
              : tr("shell.ws.resetAssistantMessage")}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontFamily: fontMono,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.4),
              numberOfLines: 2,
              textOverflow: "ellipsis-middle",
            }}
          >
            {assistantActionTarget()?.rootPath ?? ""}
          </Text>
        </View>
      </ModalDialog>
    </View>
  );
}

function SettingsNavBlock() {
  return (
    <View
      style={{
        gap: 6,
        paddingTop: 2,
      }}
    >
      <View
        role="button"
        accessibilityLabel="settings-nav-back"
        onPress={goBackScene}
        style={{
          height: 30,
          paddingHorizontal: 8,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().chromeHover }}
        activeStyle={{ backgroundColor: palette().chromeActive }}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().chromeAccent,
          outlineOffset: -1,
        }}
      >
        <Icon name="arrow-left" size={13.5} color={palette().chromeText} />
        <Text
          style={{
            color: palette().chromeText,
            fontSize: textSize(12.5),
            lineHeight: textLineHeight(12.5, 1.32),
            fontWeight: "600",
          }}
        >
          {tr("common.back")}
        </Text>
      </View>

      <View style={{ paddingTop: 4 }}>
        <SettingsNavigation />
      </View>
    </View>
  );
}

// ── App updates (the desktop's update menu: check, download, install) ─────────
// Every update command is controller local, so a driven peer never answers them.

type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";
const updatePhase = signal<UpdatePhase>("idle");
const updateVersion = signal<string>("");
let updateStateRead = false;

async function readPendingUpdate(): Promise<void> {
  if (updateStateRead || !inAppUpdatesAvailable()) return;
  updateStateRead = true;
  try {
    const pending = await invokeCommand<{ version?: string } | null>("get_pending_update", {});
    if (pending?.version) {
      updateVersion.set(pending.version);
      updatePhase.set("ready");
    }
  } catch (error) {
    console.warn("Failed to read pending update", error);
  }
}

async function checkForAppUpdates(): Promise<void> {
  if (updatePhase() === "checking" || updatePhase() === "downloading" || updatePhase() === "installing") {
    return;
  }
  const previous = updatePhase();
  updatePhase.set("checking");
  try {
    const result = await invokeCommand<{
      updateAvailable?: boolean;
      currentVersion?: string;
      latestVersion?: string | null;
    }>("check_for_updates", {});
    if (result?.updateAvailable && result.latestVersion) {
      if (previous === "ready" && updateVersion() === result.latestVersion) {
        updatePhase.set("ready");
        pushToast(tr("shell.updates.readyVersion", { version: result.latestVersion }), "info");
      } else {
        updateVersion.set(result.latestVersion);
        updatePhase.set("available");
        pushToast(tr("shell.updates.available", { version: result.latestVersion }), "info");
      }
    } else {
      updatePhase.set(previous === "ready" ? "ready" : "idle");
      pushToast(tr("shell.updates.upToDate", { version: result?.currentVersion ?? "" }), "success");
    }
  } catch (error) {
    updatePhase.set(previous === "ready" ? "ready" : "idle");
    pushToast(tr("shell.updates.failed", { error: errorText(error) }), "error");
  }
}

async function downloadAppUpdate(): Promise<void> {
  const expected = updateVersion();
  if (!expected || updatePhase() !== "available") return;
  updatePhase.set("downloading");
  try {
    const pending = await invokeCommand<{ version?: string; installError?: string }>("download_update", {
      expectedVersion: expected,
    });
    updateVersion.set(pending?.version || expected);
    updatePhase.set("ready");
    pushToast(tr("shell.updates.readyVersion", { version: updateVersion() }), "success");
  } catch (error) {
    updatePhase.set("available");
    pushToast(tr("shell.updates.failed", { error: errorText(error) }), "error");
  }
}

async function installAppUpdate(): Promise<void> {
  const version = updateVersion();
  if (!version || updatePhase() !== "ready") return;
  updatePhase.set("installing");
  try {
    await invokeCommand<unknown>("install_pending_update", { version });
  } catch (error) {
    updatePhase.set("ready");
    pushToast(tr("shell.updates.failed", { error: errorText(error) }), "error");
  }
}

function updateMenuItem(): DropdownMenuItem {
  // A native NSH window does not run Tauri's updater; the menu says so instead of failing.
  if (!inAppUpdatesAvailable()) {
    return {
      id: "footer-updates",
      label: tr("shell.updates.check"),
      icon: "refresh",
      disabled: true,
      hint: tr("shell.updates.unsupported"),
    };
  }
  switch (updatePhase()) {
    case "checking":
      return { id: "footer-updates", label: tr("shell.updates.checking"), icon: "refresh", disabled: true };
    case "available":
      return {
        id: "footer-updates",
        label: tr("shell.updates.download", { version: updateVersion() }),
        icon: "download",
        accessibilityLabel: "footer-update-download",
        onSelect: () => void downloadAppUpdate(),
      };
    case "downloading":
      return { id: "footer-updates", label: tr("shell.updates.downloading"), icon: "download", disabled: true };
    case "ready":
      return {
        id: "footer-updates",
        label: tr("shell.updates.install", { version: updateVersion() }),
        icon: "refresh",
        accessibilityLabel: "footer-update-install",
        onSelect: () => void installAppUpdate(),
      };
    case "installing":
      return { id: "footer-updates", label: tr("shell.updates.installing"), icon: "refresh", disabled: true };
    default:
      return {
        id: "footer-updates",
        label: tr("shell.updates.check"),
        icon: "refresh",
        accessibilityLabel: "footer-update-check",
        onSelect: () => void checkForAppUpdates(),
      };
  }
}

const footerMenuOpen = signal(false);
const footerMenuTriggerRef = signal<ViewRef | null>(null);

function footerMenuItems(): DropdownMenuItem[] {
  return [
    {
      id: "footer-notifications",
      label: tr("shell.notifications.title"),
      icon: "bell",
      trailingHint:
        unreadNotificationCount() > 0 ? String(unreadNotificationCount()) : undefined,
      onSelect: () => notificationsOpen.set(true),
    },
    { ...updateMenuItem(), separator: true },
    {
      id: "footer-fullscreen",
      label: tr("shell.fullscreen"),
      icon: "maximize",
      disabled: !nativeWindow(),
      onSelect: () => void toggleMainWindowFullscreen(),
    },
    {
      id: "footer-feedback",
      label: tr("shell.feedback"),
      icon: "message-circle",
      // The desktop's feedback form address is a build-time setting this frontend does not carry.
      onSelect: () => pushToast(tr("shell.feedbackUnavailable"), "warning"),
    },
    {
      id: "footer-settings",
      label: tr("nav.settings"),
      icon: "settings",
      separator: true,
      shortcut: shortcutLabel("mod+,", "⌘,"),
      onSelect: () => navigateScene("settings"),
    },
    {
      id: "footer-about",
      label: tr("shell.about.title"),
      icon: "info",
      accessibilityLabel: "footer-about",
      onSelect: () => openAboutDialog(),
    },
  ];
}

const notificationsOpen = signal(false);
const notificationsTriggerRef = signal<ViewRef | null>(null);

function notificationMenuItems(): DropdownMenuItem[] {
  const list = notifications();
  const items: DropdownMenuItem[] = [
    { id: "notifications-header", label: tr("shell.notifications.title"), header: true },
  ];
  if (list.length === 0) {
    items.push({
      id: "notifications-empty",
      label: tr("shell.notifications.empty"),
      icon: "inbox",
      disabled: true,
    });
    return items;
  }
  for (const entry of list.slice(0, 12)) {
    items.push({
      id: `notifications-${entry.id}`,
      label: entry.title,
      hint: entry.body,
      icon:
        entry.kind === "permission" ? "shield" : entry.kind === "turn-failed" ? "alert-circle" : "check-circle",
      active: !entry.read,
      onSelect: () => {
        if (entry.sessionId) {
          selectSession(entry.sessionId);
          navigateScene("sessions");
        }
        markAllNotificationsRead();
      },
    });
  }
  items.push(
    {
      id: "notifications-mark-read",
      label: tr("shell.notifications.markRead"),
      icon: "check",
      separator: true,
      disabled: unreadNotificationCount() === 0,
      onSelect: () => markAllNotificationsRead(),
    },
    {
      id: "notifications-clear",
      label: tr("shell.notifications.clear"),
      icon: "trash",
      onSelect: () => clearNotifications(),
    },
  );
  return items;
}

/** Top-bar bell: the notification history and its unread count. */
function NotificationBell() {
  return (
    <View ref={el => notificationsTriggerRef.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon="bell"
        size="sm"
        active={notificationsOpen()}
        accessibilityLabel="topbar-notifications"
        tooltip={tr("shell.notifications.title")}
        onPress={() => notificationsOpen.update(open => !open)}
      />
      <If when={unreadNotificationCount() > 0}>
        <View
          focusable={false}
          accessibilityLabel={`notifications-unread-${unreadNotificationCount()}`}
          style={{
            pointerEvents: "none",
            position: "absolute",
            right: 1,
            top: 1,
            minWidth: 14,
            height: 14,
            paddingHorizontal: 3,
            borderRadius: radii.pill,
            backgroundColor: palette().actionSolid,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: palette().actionSolidFg,
              fontSize: textSize(9),
              lineHeight: textLineHeight(9, 1.1),
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            }}
          >
            {unreadNotificationCount() > 9 ? "9+" : String(unreadNotificationCount())}
          </Text>
        </View>
      </If>
      <DropdownMenu
        open={notificationsOpen()}
        anchor={notificationsTriggerRef()}
        placement="bottom"
        align="end"
        minWidth={300}
        maxHeight={460}
        items={notificationMenuItems()}
        onClose={() => notificationsOpen.set(false)}
      />
    </View>
  );
}

function PersistentFooter() {
  const languageItems = (): DropdownMenuItem[] =>
    SUPPORTED_LOCALES.map(loc => ({
      id: `locale-${loc.id}`,
      label: loc.nativeName,
      trailingHint: loc.shortName,
      active: currentLocale() === loc.id,
      onSelect: () => {
        void setAppLocale(loc.id);
      },
    }));

  const appearanceItems = (): DropdownMenuItem[] => [
    {
      id: "mode-system",
      label: tr("nav.systemAppearance"),
      icon: "monitor",
      active: appearanceMode() === "system" && appearanceId() === null,
      onSelect: () => {
        selectAppearancePreset(null);
        applyAppearance("system");
      },
    },
    {
      id: "mode-light",
      label: tr("nav.lightMode"),
      icon: "sun",
      active: appearanceMode() === "light" && appearanceId() === null,
      onSelect: () => {
        selectAppearancePreset(null);
        applyAppearance("light");
      },
    },
    {
      id: "mode-dark",
      label: tr("nav.darkMode"),
      icon: "moon",
      active: appearanceMode() === "dark" && appearanceId() === null,
      onSelect: () => {
        selectAppearancePreset(null);
        applyAppearance("dark");
      },
    },
    ...APPEARANCE_PRESETS.map((preset, idx) => ({
      id: `preset-${preset.id}`,
      label: tr(PRESET_LABEL_KEYS[preset.id]),
      trailingHint: preset.isLight ? tr("nav.lightTheme") : tr("nav.darkTheme"),
      separator: idx === 0,
      active: appearanceId() === preset.id,
      onSelect: () => selectAppearancePreset(preset.id),
    })),
  ];

  const remoteMenuItems = (): DropdownMenuItem[] => [
    {
      id: "menu-new-workspace",
      label: tr("nav.newWorkspace"),
      icon: "folder-plus",
      onSelect: () => void openNewWorkspaceModal(),
    },
    {
      id: "menu-open-folder",
      label: tr("shell.openFolder"),
      icon: "folder-open",
      // The native picker browses this machine only.
      disabled: Boolean(peerScope()) || !nativeWindow(),
      hint: peerScope() ? tr("shell.ws.revealLocalOnly") : undefined,
      onSelect: () => void pickAndOpenWorkspaceFolder(),
    },
    {
      id: "menu-ssh-connections",
      label: tr("nav.sshConnections"),
      icon: "server",
      onSelect: () => void openSshConnectionModal(),
    },
    {
      id: "menu-search",
      label: tr("nav.searchEverything"),
      icon: "search",
      shortcut: shortcutLabel("mod+k", "⌘K"),
      separator: true,
      onSelect: () => openGlobalSearch(),
    },
  ];

  return (
    <View
      style={{
        height: 40,
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderColor: palette().chromeBorder,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <View
        role="button"
        accessibilityLabel={tr("nav.devices")}
        accessibilityState={{ selected: activeScene() === "devices" }}
        onPress={() => navigateScene("devices")}
        style={{
          flexShrink: 0,
          height: controlHeight.sm,
          paddingHorizontal: 7,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          backgroundColor:
            activeScene() === "devices" ? palette().chromeActive : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor:
            activeScene() === "devices" ? palette().chromeActive : palette().chromeHover,
        }}
        activeStyle={{ backgroundColor: palette().chromeActive }}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().chromeAccent,
          outlineOffset: -1,
        }}
      >
        <Icon
          name="link"
          size={13}
          color={
            peerScope() || activeScene() === "devices"
              ? palette().chromeAccent
              : palette().chromeTextMuted
          }
        />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color:
              activeScene() === "devices" ? palette().chromeText : palette().chromeTextMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontWeight: activeScene() === "devices" ? "500" : "400",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("nav.devices")}
        </Text>
        <If when={Boolean(peerScope())}>
          <StatusDot surface="chrome" kind="accent" size={5} />
        </If>
      </View>

      <View
        role="button"
        accessibilityLabel={tr("nav.settings")}
        accessibilityState={{ selected: activeScene() === "settings" }}
        onPress={() => navigateScene("settings")}
        style={{
          flexShrink: 0,
          height: controlHeight.sm,
          paddingHorizontal: 7,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          backgroundColor:
            activeScene() === "settings" ? palette().chromeActive : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor:
            activeScene() === "settings" ? palette().chromeActive : palette().chromeHover,
        }}
        activeStyle={{ backgroundColor: palette().chromeActive }}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().chromeAccent,
          outlineOffset: -1,
        }}
      >
        <Icon
          name="settings"
          size={13}
          color={
            activeScene() === "settings" ? palette().chromeText : palette().chromeTextMuted
          }
        />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color:
              activeScene() === "settings" ? palette().chromeText : palette().chromeTextMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontWeight: activeScene() === "settings" ? "500" : "400",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("nav.settings")}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
        {/* Quick Language Switcher (中 / EN / 繁) */}
        <View ref={el => languageTriggerRef.set(el)} style={{ flexShrink: 0 }}>
          <View
            role="button"
            accessibilityLabel="nav-language-trigger"
            accessibilityState={{ expanded: languageMenuOpen() }}
            tooltip={
              <TooltipBubble
                text={`${tr("nav.languageTooltip")} · ${localeMeta().nativeName}`}
              />
            }
            onPress={() => languageMenuOpen.update(open => !open)}
            style={{
              height: controlHeight.xs,
              minWidth: 24,
              paddingHorizontal: 4,
              borderRadius: radii.xs,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: languageMenuOpen() ? palette().chromeBorder : "transparent",
              backgroundColor: languageMenuOpen() ? palette().chromeActive : "transparent",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              cursor: "pointer",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().chromeHover }}
            activeStyle={tactileActiveStyle(0.94, { backgroundColor: palette().chromeActive })}
            focusVisibleStyle={{
              outlineWidth: 2,
              outlineColor: palette().chromeAccent,
              outlineOffset: 1,
            }}
          >
            <If when={navWidth() >= 300}>
              <Icon
                name="languages"
                size={12.5}
                color={languageMenuOpen() ? palette().chromeText : palette().chromeTextMuted}
              />
            </If>
            <Text
              style={{
                color: languageMenuOpen() ? palette().chromeText : palette().chromeTextMuted,
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.25),
                fontWeight: "600",
                numberOfLines: 1,
              }}
            >
              {localeMeta().shortName}
            </Text>
          </View>
        </View>

        <View ref={el => appearanceTriggerRef.set(el)} style={{ flexShrink: 0 }}>
          <IconButton
            icon={resolvedScheme() === "dark" ? "moon" : "sun"}
            size="xs"
            iconSize={13.5}
            surface="chrome"
            active={appearanceMenuOpen()}
            accessibilityLabel="nav-appearance-trigger"
            tooltip={tr("nav.appearancePresetsTooltip")}
            onPress={() => appearanceMenuOpen.update(open => !open)}
          />
        </View>

        <View ref={el => remoteTriggerRef.set(el)} style={{ flexShrink: 0 }}>
          <IconButton
            icon="server"
            size="xs"
            iconSize={13.5}
            surface="chrome"
            active={remoteMenuOpen()}
            accessibilityLabel="nav-remote-trigger"
            tooltip={tr("nav.remoteWorkspacesTooltip")}
            onPress={() => remoteMenuOpen.update(open => !open)}
          />
        </View>

        <View ref={el => footerMenuTriggerRef.set(el)} style={{ flexShrink: 0 }}>
          <IconButton
            icon="more"
            size="xs"
            iconSize={13.5}
            surface="chrome"
            active={footerMenuOpen()}
            accessibilityLabel="nav-footer-menu"
            tooltip={
              updatePhase() === "available" || updatePhase() === "ready"
                ? tr("shell.updates.available", { version: updateVersion() })
                : tr("shell.footerMore")
            }
            onPress={() => {
              footerMenuOpen.update(open => !open);
              void readPendingUpdate();
            }}
          />
          <If when={updatePhase() === "available" || updatePhase() === "ready"}>
            <View
              focusable={false}
              accessibilityLabel="footer-update-badge"
              style={{
                pointerEvents: "none",
                position: "absolute",
                right: 3,
                top: 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: palette().chromeAccent,
              }}
            />
          </If>
        </View>
      </View>

      <DropdownMenu
        open={footerMenuOpen()}
        anchor={footerMenuTriggerRef()}
        placement="top"
        align="end"
        minWidth={236}
        items={footerMenuItems()}
        onClose={() => footerMenuOpen.set(false)}
      />

      <DropdownMenu
        open={languageMenuOpen()}
        anchor={languageTriggerRef()}
        placement="top"
        align="end"
        minWidth={176}
        items={languageItems()}
        onClose={() => languageMenuOpen.set(false)}
      />

      <DropdownMenu
        open={appearanceMenuOpen()}
        anchor={appearanceTriggerRef()}
        placement="top"
        align="end"
        minWidth={240}
        maxHeight={480}
        items={appearanceItems()}
        onClose={() => appearanceMenuOpen.set(false)}
      />

      <DropdownMenu
        open={remoteMenuOpen()}
        anchor={remoteTriggerRef()}
        placement="top"
        align="end"
        minWidth={210}
        items={remoteMenuItems()}
        onClose={() => remoteMenuOpen.set(false)}
      />
    </View>
  );
}

function NavPanel() {
  return (
    <View style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
      {/* Active Device / Host Switcher */}
      <SidebarDeviceSwitcher />

      {/* Omnibox Search Trigger — crisp tonal field aligned to controlHeight.md */}
      <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
        <View
          role="button"
          accessibilityLabel="global-search-trigger"
          onPress={() => openGlobalSearch()}
          style={{
            height: 32,
            paddingHorizontal: 10,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            borderWidth: 0,
            backgroundColor: palette().chromeInputBg,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            backgroundColor: palette().chromeHover,
          }}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={{
            outlineWidth: 2,
            outlineColor: palette().chromeAccent,
            outlineOffset: 1,
          }}
        >
          <Icon name="search" size={15} color={palette().chromeTextMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().chromeTextMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.3),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("nav.searchEverything")}
          </Text>
          <KbdHint keys={shortcutLabel("mod+k", "⌘K")} surface="chrome" />
        </View>
      </View>

      <Scroll
        scrollbar={true}
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 10 }}
      >
        <If
          when={activeScene() === "settings"}
          else={
            <View style={{ gap: 12 }}>
              {/* Primary Studio Navigation (uniform 30px single-column rows) */}
              <View style={{ gap: 2 }}>
                <Each of={PRIMARY_NAV_SCENES} key={sceneId => sceneId}>
                  {sceneId => (
                    <NavRow
                      label={tr(SCENE_META[sceneId()].labelKey)}
                      icon={SCENE_META[sceneId()].icon}
                      active={activeScene() === sceneId()}
                      badgeCount={sceneId() === "sessions" ? sessionActivityCount() : 0}
                      onPress={() => navigateScene(sceneId())}
                    />
                  )}
                </Each>
              </View>

              {/* Collapsible Single-Column Studio Links + Compact 3-Item Workbench Strip */}
              <View style={{ gap: 6 }}>
                <View style={{ gap: 2 }}>
                  <View
                    role="button"
                    accessibilityLabel="nav-toggle-studio-group"
                    accessibilityState={{ expanded: studioGroupOpen() }}
                    onPress={toggleStudioGroup}
                    style={{
                      height: 24,
                      paddingHorizontal: 8,
                      borderRadius: radii.xs,
                      borderCurve: "continuous",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().chromeHover }}
                    activeStyle={{ backgroundColor: palette().chromeActive }}
                    focusVisibleStyle={{
                      outlineWidth: 2,
                      outlineColor: palette().chromeAccent,
                      outlineOffset: -1,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: palette().chromeTextMuted,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.3),
                        fontWeight: "500",
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {tr("nav.studio")}
                    </Text>
                    <Icon
                      name={studioGroupOpen() ? "chevron-down" : "chevron-right"}
                      size={11.5}
                      color={palette().chromeTextMuted}
                    />
                  </View>
                  <If when={studioGroupOpen()}>
                    <View style={{ gap: 1 }}>
                      <Each of={[...STUDIO_ONLY_SCENES, ...WORKBENCH_NAV_SCENES]} key={sceneId => sceneId}>
                        {sceneId => (
                          <NavRow
                            compact
                            label={tr(SCENE_META[sceneId()].labelKey)}
                            icon={SCENE_META[sceneId()].icon}
                            active={activeScene() === sceneId()}
                            onPress={() => navigateScene(sceneId())}
                          />
                        )}
                      </Each>
                    </View>
                  </If>
                </View>
              </View>

              {/* Workspaces & Nested Sessions */}
              <View style={{ gap: 4, paddingTop: 2 }}>
                <View
                  style={{
                    height: 26,
                    paddingLeft: 8,
                    paddingRight: 2,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      overflow: "hidden",
                    }}
                  >
                    <Text
                      style={{
                        flexShrink: 1,
                        minWidth: 0,
                        color: palette().chromeTextMuted,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.3),
                        fontWeight: "500",
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {tr("nav.workspaces")}
                    </Text>
                    <If when={workspaces().length > 0}>
                      <Text
                        style={{
                          color: palette().chromeTextMuted,
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.3),
                          fontWeight: "500",
                          fontVariant: ["tabular-nums"],
                          flexShrink: 0,
                        }}
                      >
                        {String(workspaces().length)}
                      </Text>
                    </If>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
                    <IconButton
                      icon="plus"
                      size="xs"
                      iconSize={13}
                      surface="chrome"
                      accessibilityLabel="New"
                      tooltip={
                        <TooltipBubble
                          text={tr("nav.newSession")}
                          shortcut={shortcutLabel("mod+n", "⌘N")}
                        />
                      }
                      onPress={() => {
                        void createSessionInWorkspace(tr("nav.newSession"));
                        navigateScene("sessions");
                      }}
                    />
                    <IconButton
                      icon="folder-plus"
                      size="xs"
                      iconSize={13}
                      surface="chrome"
                      accessibilityLabel="workspace-switcher-trigger"
                      tooltip={tr("nav.newWorkspaceTooltip")}
                      onPress={() => void openNewWorkspaceModal()}
                    />
                    <IconButton
                      icon="more"
                      size="xs"
                      iconSize={13}
                      surface="chrome"
                      active={archiveFilterOpen()}
                      accessibilityLabel="drawer-more"
                      tooltip={tr("nav.sessionFilterTooltip")}
                      onPress={() => archiveFilterOpen.update(open => !open)}
                    />
                  </View>
                </View>

                <If when={archiveFilterOpen()}>
                  <View
                    style={{
                      paddingHorizontal: 4,
                      paddingBottom: 2,
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Button
                      label={tr("common.active")}
                      size="xs"
                      surface="chrome"
                      variant={showArchivedSessions() ? "ghost" : "secondary"}
                      accessibilityLabel={tr("common.active")}
                      onPress={() => showArchivedSessions.set(false)}
                    />
                    <Button
                      label={tr("nav.archivedCount", { count: archivedSessionRows().length })}
                      size="xs"
                      surface="chrome"
                      variant={showArchivedSessions() ? "secondary" : "ghost"}
                      onPress={() => showArchivedSessions.set(true)}
                    />
                    <Button
                      label={sessionGrouping() === "grouped" ? tr("nav.grouped") : tr("nav.flat")}
                      leadingIcon={sessionGrouping() === "grouped" ? "layers" : "list"}
                      size="xs"
                      surface="chrome"
                      variant="ghost"
                      accessibilityLabel="nav-toggle-grouping"
                      onPress={() =>
                        sessionGrouping.update(mode => (mode === "grouped" ? "flat" : "grouped"))
                      }
                    />
                  </View>
                </If>

                <If when={!workspacesLoaded()}>
                  <SidebarSkeleton />
                </If>

                <If when={workspacesLoaded() && workspaces().length === 0}>
                  <View
                    style={{
                      padding: 10,
                      borderRadius: radii.md,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().chromeBorder,
                      backgroundColor: palette().chromeInputBg,
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().chromeTextMuted,
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.4),
                      }}
                    >
                      {tr("nav.noWorkspace")}
                    </Text>
                    <View style={{ alignSelf: "flex-start" }}>
                      <Button
                        label={tr("nav.openWorkspace")}
                        leadingIcon="folder-plus"
                        size="xs"
                        surface="chrome"
                        variant="secondary"
                        accessibilityLabel="nav-empty-open-workspace"
                        onPress={() => void openNewWorkspaceModal()}
                      />
                    </View>
                  </View>
                </If>

                <View style={{ gap: 2 }}>
                  <Each of={workspaces()} key={ws => ws.id}>
                    {ws => (
                      <WorkspaceRowBlock
                        id={ws().id}
                        name={ws().name ?? ""}
                        rootPath={ws().rootPath}
                        connectionId={ws().connectionId}
                        sshHost={ws().sshHost}
                        workspaceKind={ws().workspaceKind}
                        showNestedSessions={sessionGrouping() === "grouped"}
                      />
                    )}
                  </Each>
                </View>

                <RecentWorkspacesGroup />

                <If when={sessionGrouping() === "flat"}>
                  <View style={{ gap: 2, paddingTop: 6 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        paddingHorizontal: 8,
                        paddingBottom: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: palette().chromeTextMuted,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.3),
                          fontWeight: "500",
                        }}
                      >
                        {tr("nav.sessionsGroup")}
                      </Text>
                      <If when={!showArchivedSessions() && sessionTotal() > 0}>
                        <Text
                          style={{
                            color: palette().chromeTextMuted,
                            fontSize: textSize(10.5),
                            lineHeight: textLineHeight(10.5, 1.3),
                            fontWeight: "500",
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {String(sessionTotal())}
                        </Text>
                      </If>
                    </View>
                    <Each of={visibleSessionRows()} key={item => item.sessionId}>
                      {row => {
                        const mark = () =>
                          statusOfSession()(
                            row().sessionId,
                            row().lastUpdated,
                            row().messageCount,
                          );
                        return (
                          <SessionSidebarRow
                            sessionId={row().sessionId}
                            title={sessionDisplayTitle(row())}
                            active={activeSessionId() === row().sessionId}
                            archived={isSessionArchived(row())}
                            statusLabel={mark()?.label}
                            statusKind={mark()?.kind}
                            onPress={() => {
                              selectSession(row().sessionId);
                              navigateScene("sessions");
                            }}
                          />
                        );
                      }}
                    </Each>
                    <If when={!showArchivedSessions() && sessionHasMore()}>
                      <View
                        role="button"
                        accessibilityLabel="load-more-sessions-flat"
                        onPress={() => void loadMoreSessions()}
                        style={{
                          minHeight: 26,
                          justifyContent: "center",
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: radii.xs,
                          borderCurve: "continuous",
                          cursor: "pointer",
                          ...paintTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{ backgroundColor: palette().chromeHover }}
                        activeStyle={{ backgroundColor: palette().chromeActive }}
                        focusVisibleStyle={{
                          outlineWidth: 2,
                          outlineColor: palette().chromeAccent,
                          outlineOffset: -1,
                        }}
                      >
                        <Text
                          style={{
                            color: palette().chromeAccent,
                            fontSize: textSize(11),
                            lineHeight: textLineHeight(11, 1.35),
                            fontWeight: "500",
                          }}
                        >
                          {tr("nav.loadMoreThreads")}
                        </Text>
                      </View>
                    </If>
                  </View>
                </If>

                {/* Deduplicated Saved SSH Hosts quick-connect list */}
                <If when={unmountedSshHosts().length > 0}>
                  <View style={{ gap: 2, paddingTop: 6 }}>
                    <View
                      style={{
                        height: 24,
                        paddingLeft: 8,
                        paddingRight: 2,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text
                        style={{
                          color: palette().chromeTextMuted,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.3),
                          fontWeight: "500",
                        }}
                      >
                        {tr("nav.sshHosts")}
                      </Text>
                      <IconButton
                        icon="plus"
                        size="xs"
                        iconSize={12.5}
                        surface="chrome"
                        accessibilityLabel="nav-add-ssh-host"
                        tooltip={tr("nav.connectSshTooltip")}
                        onPress={() => void openSshConnectionModal()}
                      />
                    </View>
                    <Each of={unmountedSshHosts()} key={conn => conn.id}>
                      {conn => {
                        const status = () => connectionStatuses()[conn().id] ?? "disconnected";
                        return (
                          <View
                            role="button"
                            accessibilityLabel={`ssh-host-row-${conn().id}`}
                            tooltip={
                              <TooltipBubble
                                text={`${conn().username}@${conn().host}:${conn().port}`}
                              />
                            }
                            onPress={() =>
                              void quickConnectSavedConnection(conn(), {
                                browseAfterConnect: true,
                              })
                            }
                            style={{
                              height: 28,
                              paddingLeft: 8,
                              paddingRight: 6,
                              borderRadius: radii.sm,
                              borderCurve: "continuous",
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 7,
                              cursor: "pointer",
                              ...paintTransition(MOTION_DURATION.fast),
                            }}
                            hoverStyle={{ backgroundColor: palette().chromeHover }}
                            activeStyle={{ backgroundColor: palette().chromeActive }}
                            focusVisibleStyle={{
                              outlineWidth: 2,
                              outlineColor: palette().chromeAccent,
                              outlineOffset: -1,
                            }}
                          >
                            <Icon
                              name={
                                conn().container
                                  ? "container"
                                  : conn().wsl
                                    ? "terminal-square"
                                    : "server"
                              }
                              size={12.5}
                              color={palette().chromeTextMuted}
                            />
                            <Text
                              style={{
                                flex: 1,
                                minWidth: 0,
                                color: palette().chromeTextMuted,
                                fontSize: textSize(12),
                                lineHeight: textLineHeight(12, 1.32),
                                numberOfLines: 1,
                                textOverflow: "ellipsis-middle",
                              }}
                            >
                              {conn().name || `${conn().username}@${conn().host}`}
                            </Text>
                            <StatusDot
                              surface="chrome"
                              kind={
                                status() === "connected"
                                  ? "success"
                                  : status() === "connecting"
                                    ? "warning"
                                    : status() === "error"
                                      ? "danger"
                                      : "muted"
                              }
                              size={5}
                              pulse={status() === "connecting"}
                            />
                          </View>
                        );
                      }}
                    </Each>
                  </View>
                </If>
              </View>
            </View>
          }
        >
          <SettingsNavBlock />
        </If>
      </Scroll>

      <PersistentFooter />

      <DropdownMenu
        open={Boolean(workspaceActionMenuId() && !workspaceContextPoint())}
        anchor={workspaceActionAnchor()}
        placement="right"
        align="start"
        minWidth={220}
        items={workspaceActionMenuId() ? workspaceDropdownItems(workspaceActionMenuId()!) : []}
        onClose={() => workspaceActionMenuId.set(null)}
      />

      <ContextMenuOverlay
        open={Boolean(workspaceActionMenuId() && workspaceContextPoint())}
        position={workspaceContextPoint()}
        items={workspaceActionMenuId() ? workspaceDropdownItems(workspaceActionMenuId()!) : []}
        onClose={() => {
          workspaceActionMenuId.set(null);
          workspaceContextPoint.set(null);
        }}
      />

      <ContextMenuOverlay
        open={Boolean(sessionContextTarget() && sessionContextPoint())}
        position={sessionContextPoint()}
        items={sessionContextTarget() ? sessionRowMenuItems(sessionContextTarget()!) : []}
        onClose={closeSessionMenus}
      />

      <DropdownMenu
        open={Boolean(sessionContextTarget() && sessionContextAnchor())}
        anchor={sessionContextAnchor()}
        placement="right"
        align="start"
        minWidth={190}
        items={sessionContextTarget() ? sessionRowMenuItems(sessionContextTarget()!) : []}
        onClose={closeSessionMenus}
      />

      <ModalDialog
        open={Boolean(sessionDeleteTarget())}
        title={tr("nav.deleteThreadTitle")}
        size="sm"
        accessibilityLabel="sidebar-session-delete-modal"
        onClose={() => sessionDeleteTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              onPress={() => sessionDeleteTarget.set(null)}
            />
            <Button
              label={tr("common.delete")}
              variant="danger"
              size="sm"
              accessibilityLabel="sidebar-session-delete-confirm"
              onPress={() => {
                const target = sessionDeleteTarget();
                sessionDeleteTarget.set(null);
                if (target) {
                  void deleteSessionRow(target.sessionId);
                }
              }}
            />
          </View>
        }
      >
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.5),
          }}
        >
          {tr("nav.deleteThreadConfirm", { title: sessionDeleteTarget()?.title ?? "" })}
        </Text>
      </ModalDialog>
    </View>
  );
}

// ── Scene history: the keyboard shortcuts walk the scenes the user opened ─────

const pinnedSceneTabs = signal<SceneId[]>([]);

/** Pinned tabs lead the strip, in the order they were pinned; the rest follow. */
const orderedSceneTabs = computed<SceneId[]>(() => {
  const open = openSceneTabs();
  const pinned = pinnedSceneTabs().filter(tab => open.includes(tab));
  return [...pinned, ...open.filter(tab => !pinned.includes(tab))];
});

function isTabPinned(tab: SceneId): boolean {
  return pinnedSceneTabs().includes(tab);
}

function closeTab(tab: SceneId): void {
  if (isTabPinned(tab)) return;
  closeSceneTab(tab);
}



/** Moves the selection `delta` tabs along the strip, wrapping at the ends. */
function cycleSceneTab(delta: number): void {
  const tabs = orderedSceneTabs();
  if (tabs.length < 2) return;
  const idx = Math.max(0, tabs.indexOf(activeScene()));
  navigateScene(tabs[(idx + delta + tabs.length) % tabs.length]);
}


/**
 * Minimize / maximize / close for the frameless Windows and Linux window
 * (`decorations(false)`); macOS keeps its native traffic lights, so this draws
 * nothing there. Close goes through the native close request, which the desktop
 * turns into `openbitfun_main_window_close_requested`.
 */
function WindowControlButton(props: {
  id: "minimize" | "maximize" | "close";
  label: string;
  onPress: () => void;
  children: JSX.Element;
}) {
  const wide = () => windowPlatform() === "windows";
  return (
    <View
      role="button"
      accessibilityLabel={`window-${props.id}`}
      tooltip={<TooltipBubble text={props.label} />}
      onPress={props.onPress}
      style={{
        width: wide() ? 46 : 28,
        height: wide() ? 44 : 28,
        flexShrink: 0,
        borderRadius: wide() ? 0 : radii.sm,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor:
          props.id === "close" && wide() ? palette().danger : palette().surfaceSubtle,
      }}
      activeStyle={{ opacity: 0.8 }}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: props.id === "close" ? palette().danger : palette().borderFocus,
        outlineOffset: -2,
      }}
    >
      {props.children}
    </View>
  );
}

function WindowControls() {
  const glyph = () => palette().textSecondary;
  return (
    <If when={pageDrawsWindowControls()}>
      <View
        accessibilityLabel="window-controls"
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: windowPlatform() === "windows" ? "stretch" : "center",
          gap: windowPlatform() === "windows" ? 0 : 2,
          marginRight: windowPlatform() === "windows" ? -10 : 0,
          marginLeft: 4,
          flexShrink: 0,
        }}
      >
        <WindowControlButton id="minimize" label={tr("shell.window.minimize")} onPress={minimizeWindow}>
          <View style={{ width: 10, height: 1, backgroundColor: glyph() }} />
        </WindowControlButton>
        <WindowControlButton
          id="maximize"
          label={windowMaximized() ? tr("shell.window.restore") : tr("shell.window.maximize")}
          onPress={toggleWindowMaximize}
        >
          <If
            when={windowMaximized()}
            else={
              <View
                style={{ width: 10, height: 10, borderWidth: 1, borderColor: glyph(), borderRadius: 1.5 }}
              />
            }
          >
            <View style={{ width: 11, height: 11 }}>
              <View
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: 8,
                  height: 8,
                  borderTopWidth: 1,
                  borderRightWidth: 1,
                  borderColor: glyph(),
                  borderTopRightRadius: 1.5,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  width: 8,
                  height: 8,
                  borderWidth: 1,
                  borderColor: glyph(),
                  borderRadius: 1.5,
                }}
              />
            </View>
          </If>
        </WindowControlButton>
        <WindowControlButton id="close" label={tr("shell.window.close")} onPress={closeWindow}>
          <Icon name="close" size={12} color={glyph()} />
        </WindowControlButton>
      </View>
    </If>
  );
}

/**
 * Opens a local folder as a workspace through the native picker. The picker is
 * this machine's, so it is refused while a peer is driven (its paths are not
 * this machine's) and where no native picker exists, each with its own message.
 */
async function pickAndOpenWorkspaceFolder(): Promise<void> {
  if (peerScope()) {
    pushToast(tr("shell.pickFolderPeerUnsupported"), "warning");
    return;
  }
  let selected: string | null = null;
  try {
    selected = await pickLocalDirectory({ title: tr("shell.pickFolderTitle") });
  } catch (error) {
    pushToast(tr("shell.pickFolderUnavailable", { error: errorText(error) }), "warning");
    return;
  }
  if (selected) await openPathWorkspace(selected);
}

type CloseButtonBehavior = "minimize_to_tray" | "quit" | "ask";
const closeAskOpen = signal(false);
let closeRequestHandling = false;

async function minimizeToTray(): Promise<void> {
  await minimizeMainWindowToTray();
}

async function quitApp(): Promise<void> {
  await quitApplication();
}

/**
 * The desktop prevents the native close and asks the page what to do, as it
 * asks the React surface (`AppLayout.tsx`): macOS hides the window, Windows and
 * Linux follow `app.close_button_behavior` (minimize to tray by default).
 *
 * backend-owned: the stored preference is the backend's; only the choice of
 * which shell call carries it out belongs here.
 */
async function handleMainWindowCloseRequest(): Promise<void> {
  if (closeRequestHandling) return;
  closeRequestHandling = true;
  try {
    if (windowPlatform() === "macos" || trafficLightInsetPx() > 0) {
      try {
        await hideMainWindowAfterCloseRequest();
      } catch (error) {
        console.error("Failed to hide main window after close request", error);
      }
      return;
    }
    let behavior: CloseButtonBehavior = "minimize_to_tray";
    try {
      const stored = await invokeCommand<unknown>("get_config", {
        path: "app.close_button_behavior",
        skipRetryOnNotFound: true,
      });
      if (stored === "quit" || stored === "ask" || stored === "minimize_to_tray") behavior = stored;
    } catch {
      // A host that stores no preference closes to the tray, as the desktop does.
    }
    if (behavior === "ask") {
      closeAskOpen.set(true);
      return;
    }
    try {
      if (behavior === "quit") await quitApp();
      else await minimizeToTray();
    } catch (error) {
      console.error("Failed to handle close request", error);
      await quitApp().catch(() => undefined);
    }
  } finally {
    closeRequestHandling = false;
  }
}

function CloseAskDialog() {
  const choose = (quit: boolean) => {
    closeAskOpen.set(false);
    void (quit ? quitApp() : minimizeToTray()).catch(error => {
      console.error("Failed to handle close choice", error);
      pushToast(localizeHostError(error instanceof Error ? error.message : String(error)), "error");
    });
  };
  return (
    <ModalDialog
      open={closeAskOpen()}
      title={tr("shell.closeDialog.title")}
      size="sm"
      accessibilityLabel="close-ask-dialog"
      onClose={() => closeAskOpen.set(false)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("shell.closeDialog.minimizeToTray")}
            variant="secondary"
            size="sm"
            accessibilityLabel="close-ask-tray"
            onPress={() => choose(false)}
          />
          <Button
            label={tr("shell.closeDialog.quit")}
            variant="danger"
            size="sm"
            accessibilityLabel="close-ask-quit"
            onPress={() => choose(true)}
          />
        </View>
      }
    >
      <Text
        style={{
          color: palette().textSecondary,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.5),
        }}
      >
        {tr("shell.closeDialog.message")}
      </Text>
    </ModalDialog>
  );
}

function SceneTopBar() {
  const topbarWorkspaceItems = (): DropdownMenuItem[] => {
    const current = activeWorkspace();
    const items: DropdownMenuItem[] = workspaces().map(ws => ({
      id: `topbar-ws-${ws.id}`,
      label: basenameLabel(ws.rootPath, ws.name),
      icon: workspaceKindIcon(ws),
      trailingHint: remoteSshHost(ws),
      active: current?.id === ws.id,
      onSelect: () => {
        expandWorkspace(ws.id);
        selectWorkspace(ws.id);
      },
    }));
    if (current?.connectionId) {
      items.push(
        {
          id: "topbar-ws-manage-ssh",
          label: tr("nav.manageSshConnection"),
          icon: "server",
          separator: true,
          onSelect: () => void openSshConnectionModal(current.connectionId),
        },
        {
          id: "topbar-ws-port-forward",
          label: tr("nav.portForwardingEllipsis"),
          icon: "network",
          onSelect: () =>
            void openPortForwardModal(
              current.connectionId!,
              remoteSshHost(current) ?? current.name,
            ),
        },
      );
    }
    items.push(
      {
        id: "topbar-ws-new",
        label: tr("nav.newWorkspace"),
        icon: "folder-plus",
        separator: true,
        onSelect: () => void openNewWorkspaceModal({ step: "project" }),
      },
      {
        id: "topbar-ws-open-folder",
        label: tr("shell.openFolder"),
        icon: "folder-open",
        disabled: Boolean(peerScope()) || !nativeWindow(),
        onSelect: () => void pickAndOpenWorkspaceFolder(),
      },
    );
    return items;
  };

  return (
    <View
      {...titlebarBarProps()}
      style={{
        height: 44,
        minWidth: 0,
        overflow: "hidden",
        paddingLeft: !drawerOpen() && trafficLightInsetPx() > 0 ? trafficLightInsetPx() : 10,
        paddingRight: windowControlsRightInsetPx() > 0 ? windowControlsRightInsetPx() : 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: palette().canvas,
      }}
    >
      <If when={!drawerOpen()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <IconButton
            icon="panel-left"
            size="sm"
            accessibilityLabel="toggle-drawer"
            tooltip={
              <TooltipBubble
                text={tr("nav.toggleSidebar")}
                shortcut={shortcutLabel("mod+b", "⌘B")}
              />
            }
            onPress={toggleDrawer}
          />
          <IconButton
            icon="arrow-left"
            size="sm"
            disabled={!canGoBack()}
            accessibilityLabel="topbar-nav-back"
            tooltip={tr("common.back")}
            onPress={goBackScene}
          />
          <IconButton
            icon="arrow-right"
            size="sm"
            disabled={!canGoForward()}
            accessibilityLabel="topbar-nav-forward"
            tooltip={tr("common.forward")}
            onPress={goForwardScene}
          />
        </View>
      </If>

      {/* No browser-style tab strip: navigation lives in the sidebar and the
          back/forward controls; the bar itself is a quiet, draggable title area. */}
      <View
        focusable={false}
        {...titlebarDragRegionProps()}
        style={{ flex: 1, minWidth: 0, height: "100%", cursor: "default" }}
      />

      {/* Trailing Workspace Dropdown & AuxPane Controls */}
      <View
        style={{
          flexShrink: 0,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <If when={Object.keys(runningTurns()).length > 0}>
          <View
            accessibilityLabel="topbar-busy-indicator"
            tooltip={<TooltipBubble text={tr("nav.working")} />}
            style={{
              width: 22,
              height: 22,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Spinner size={12} color={palette().accent} />
          </View>
        </If>

        <If when={activeWorkspace()}>
          {ws => {
            const host = () => remoteSshHost(ws());
            return (
              <View ref={el => topbarWorkspaceTriggerRef.set(el)} style={{ flexShrink: 1, minWidth: 0 }}>
                <View
                  role="button"
                  accessibilityLabel="topbar-workspace-chip"
                  accessibilityState={{ expanded: topbarWorkspaceMenuOpen() }}
                  tooltip={
                    <TooltipBubble
                      text={
                        ws().connectionId
                          ? tr("nav.manageSshHostTooltip", {
                              host: host() ?? basenameLabel(ws().rootPath, ws().name),
                            })
                          : ws().rootPath
                      }
                    />
                  }
                  onPress={() => topbarWorkspaceMenuOpen.update(open => !open)}
                  style={{
                    height: controlHeight.sm,
                    flexShrink: 1,
                    minWidth: 0,
                    maxWidth: 184,
                    overflow: "hidden",
                    paddingHorizontal: 8,
                    borderRadius: 7,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: topbarWorkspaceMenuOpen() ? palette().border : "transparent",
                    backgroundColor: topbarWorkspaceMenuOpen()
                      ? palette().surfaceSubtle
                      : "transparent",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{
                    backgroundColor: palette().surfaceSubtle,
                  }}
                  activeStyle={tactileActiveStyle(0.98, {
                    backgroundColor: palette().panelHover,
                  })}
                  focusVisibleStyle={{
                    outlineWidth: 2,
                    outlineColor: palette().borderFocus,
                    outlineOffset: 1,
                  }}
                >
                  <Icon
                    name={workspaceKindIcon(ws())}
                    size={13}
                    color={isRemoteWorkspaceRecord(ws()) ? palette().accent : palette().textMuted}
                  />
                  <Text
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      color: palette().textSecondary,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.3),
                      fontWeight: "500",
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {host()
                      ? `${host()} · ${basenameLabel(ws().rootPath, ws().name)}`
                      : basenameLabel(ws().rootPath, ws().name)}
                  </Text>
                  <Icon name="chevron-down" size={10.5} color={palette().textMuted} />
                </View>
              </View>
            );
          }}
        </If>

        <DropdownMenu
          open={topbarWorkspaceMenuOpen()}
          anchor={topbarWorkspaceTriggerRef()}
          placement="bottom"
          align="end"
          minWidth={224}
          items={topbarWorkspaceItems()}
          onClose={() => topbarWorkspaceMenuOpen.set(false)}
        />

        <NotificationBell />

        <If when={activeRemoteWorkspace()}>
          {remote => (
            <If when={Boolean(remote().connectionId)}>
              <IconButton
                icon="network"
                size="sm"
                accessibilityLabel="topbar-port-forward"
                tooltip={tr("nav.portForwarding")}
                onPress={() =>
                  void openPortForwardModal(remote().connectionId, remote().sshHost)
                }
              />
            </If>
          )}
        </If>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
          }}
        >
          <IconButton
            icon="folder"
            size="sm"
            active={auxPaneOpen() && auxPaneTab() === "files"}
            accessibilityLabel="topbar-aux-files"
            tooltip={tr("nav.openFilesAux")}
            onPress={() => openInAuxPane("files")}
          />
          <IconButton
            icon="git-branch"
            size="sm"
            active={auxPaneOpen() && auxPaneTab() === "git"}
            accessibilityLabel="topbar-aux-git"
            tooltip={tr("nav.openGitAux")}
            onPress={() => openInAuxPane("git")}
          />
          <IconButton
            icon="terminal-square"
            size="sm"
            active={auxPaneOpen() && auxPaneTab() === "terminal"}
            accessibilityLabel="topbar-aux-terminal"
            tooltip={tr("nav.openTerminalAux")}
            onPress={() => openInAuxPane("terminal")}
          />
          <IconButton
            icon="panel-right"
            size="sm"
            active={auxPaneOpen()}
            accessibilityLabel="aux-pane-toggle"
            tooltip={
              <TooltipBubble
                text={tr("nav.toggleSidePane")}
                shortcut={shortcutLabel("mod+j", "⌘J")}
              />
            }
            onPress={toggleAuxPane}
          />
        </View>
        <WindowControls />
      </View>
    </View>
  );
}

/** A `file:` URL a file manager drags, as a local path (`/C:/x` becomes `C:/x`). */
function pathFromFileUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

/**
 * A file dropped on a scene outside the composer (which attaches drops itself)
 * opens in Files when it lives in the active local workspace. A dropped local
 * file cannot be opened in a remote or peer workspace, which is said rather than
 * opened from this machine's disk.
 */
async function handleSceneFileDrop(uris: string[]): Promise<void> {
  const paths = uris.map(pathFromFileUri).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return;
  const ws = activeWorkspace();
  if (!ws) {
    pushToast(tr("shell.drop.noWorkspace"), "warning");
    return;
  }
  if (peerScope() || isRemoteWorkspaceRecord(ws)) {
    pushToast(tr("shell.drop.remoteUnsupported"), "warning");
    return;
  }
  const root = ws.rootPath.replace(/[\\/]+$/, "");
  const inside = paths.find(path => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`));
  if (!inside) {
    pushToast(tr("shell.drop.outsideWorkspace", { name: basenameLabel(ws.rootPath, ws.name) }), "warning");
    return;
  }
  navigateScene("files");
  await openFileAt(inside);
}

/**
 * What a scene that threw draws instead of a blank pane: the error, a retry that
 * remounts it, and a way back to Sessions. The rest of the shell keeps working.
 */
function SceneErrorCard(props: { error: unknown; reset: () => void; area: "scene" | "aux" }) {
  const message =
    props.error instanceof Error ? props.error.message : String(props.error ?? "");
  console.error(`The ${props.area} view failed to render`, props.error);
  return (
    <View
      accessibilityLabel={`${props.area}-error-card`}
      style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 20,
          gap: 12,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="alert-circle" size={18} color={palette().danger} />
          <Text
            style={{
              flex: 1,
              color: palette().text,
              fontSize: textSize(14),
              lineHeight: textLineHeight(14, 1.35),
              fontWeight: "600",
            }}
          >
            {tr("shell.error.title")}
          </Text>
        </View>
        <Text
          style={{
            color: palette().textSecondary,
            fontFamily: fontMono,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.45),
            numberOfLines: 6,
            textOverflow: "ellipsis",
          }}
        >
          {message || tr("shell.error.unknown")}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label={tr("shell.error.retry")}
            variant="primary"
            size="sm"
            leadingIcon="refresh"
            accessibilityLabel={`${props.area}-error-retry`}
            onPress={props.reset}
          />
          <If when={props.area === "scene"}>
            <Button
              label={tr("shell.error.backToSessions")}
              variant="secondary"
              size="sm"
              onPress={() => {
                navigateScene("sessions");
                props.reset();
              }}
            />
          </If>
        </View>
      </View>
    </View>
  );
}

function AuxPane() {
  const auxTabInnerRadius = concentricRadius(9, 2.5);
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          height: 38,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          backgroundColor: palette().canvas,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <View
          role="tablist"
          style={{
            height: controlHeight.sm,
            padding: 2.5,
            borderRadius: 9,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().segmentedTrackBg,
            boxShadow: palette().shadowInset,
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Each of={AUX_TABS} key={tab => tab.id}>
            {tab => {
              const active = () => auxPaneTab() === tab().id;
              return (
                <View
                  role="tab"
                  accessibilityLabel={`aux-tab-${tab().id}`}
                  accessibilityState={{ selected: active() }}
                  onPress={() => auxPaneTab.set(tab().id)}
                  style={{
                    height: "100%",
                    flexShrink: 1,
                    minWidth: 0,
                    paddingHorizontal: 9,
                    borderRadius: auxTabInnerRadius,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: active()
                      ? isLightAppearance()
                        ? "transparent"
                        : palette().border
                      : "transparent",
                    backgroundColor: active() ? palette().panelRaised : "transparent",
                    boxShadow: active()
                      ? `${palette().shadowButton}, ${palette().innerHighlight}`
                      : undefined,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{
                    backgroundColor: active()
                      ? palette().panelRaised
                      : palette().surfaceSubtle,
                  }}
                  activeStyle={tactileActiveStyle(0.98)}
                  focusVisibleStyle={{
                    outlineWidth: 2,
                    outlineColor: palette().borderFocus,
                    outlineOffset: 1,
                  }}
                >
                  <Icon
                    name={tab().icon}
                    size={12.5}
                    color={active() ? palette().accent : palette().textMuted}
                  />
                  <Text
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      color: active() ? palette().text : palette().textMuted,
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.26),
                      fontWeight: active() ? "600" : "500",
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {tr(tab().labelKey)}
                  </Text>
                </View>
              );
            }}
          </Each>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <IconButton
            icon="arrow-left-right"
            size="xs"
            accessibilityLabel="aux-swap-side"
            tooltip={tr("nav.swapAuxPane")}
            onPress={swapAuxPanes}
          />
          <IconButton
            icon={auxPaneMaximized() ? "minimize" : "maximize"}
            size="xs"
            accessibilityLabel="aux-maximize"
            tooltip={
              auxPaneMaximized() ? tr("nav.restoreAuxPane") : tr("nav.maximizeAuxPane")
            }
            onPress={() => setAuxPaneMaximized()}
          />
          <IconButton
            icon="close"
            size="xs"
            accessibilityLabel="aux-close"
            tooltip={tr("nav.closeAuxPane")}
            onPress={toggleAuxPane}
          />
        </View>
      </View>

      <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
        <ErrorBoundary
          fallback={(error, reset) => <SceneErrorCard error={error} reset={reset} area="aux" />}
        >
          <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
            {auxElement()}
          </View>
        </ErrorBoundary>
      </View>
    </View>
  );
}

/**
 * Peer Device Mode is a state the whole surface is in, so it is stated above
 * every scene: which device is being driven, and one press to come back.
 */
function PeerBanner() {
  return (
    <If when={peerScope()}>
      {scope => (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 7,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            backgroundColor: palette().accentSoft,
            borderBottomWidth: 1,
            borderColor: palette().accentBorder,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 200,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <StatusDot kind="accent" size={6} pulse={peerReconnecting()} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                style={{
                  color: palette().text,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.4),
                  fontWeight: "500",
                }}
              >
                {tr("nav.peerDrivingBannerDetail", {
                  label: scope().label,
                  hostKind: scope().hostKind,
                })}
              </Text>
              <If when={peerError()}>
                {message => (
                  <Text
                    style={{
                      color: palette().danger,
                      fontSize: textSize(11),
                      lineHeight: textLineHeight(11, 1.38),
                    }}
                  >
                    {localizeHostError(message())}
                  </Text>
                )}
              </If>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Button
              label={peerReconnecting() ? tr("nav.peerReconnecting") : tr("nav.peerReconnect")}
              size="xs"
              variant="secondary"
              loading={peerReconnecting()}
              accessibilityLabel="reconnect-peer"
              onPress={() => void reconnectPeer()}
            />
            <Button
              label={peerBusy() ? tr("nav.peerLeaving") : tr("nav.returnToThisMachine")}
              size="xs"
              variant="secondary"
              loading={peerBusy()}
              accessibilityLabel="leave-peer"
              onPress={() => void returnToThisMachine()}
            />
          </View>
        </View>
      )}
    </If>
  );
}

/**
 * The backend connection, said out loud when it is not answering: a backend
 * that failed to start or an event stream that is reconnecting must not look
 * like an empty app.
 */
function BackendConnectionBanner() {
  const message = () => {
    const state = connectionState();
    if (state === "failed") return tr("shell.backend.failed", { error: connectionError() || "-" });
    if (state === "reconnecting") return tr("shell.backend.reconnecting");
    return "";
  };
  return (
    <If when={message()}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
        <InlineBanner
          tone={connectionState() === "failed" ? "danger" : "warning"}
          message={message()}
          accessibilityLabel="backend-connection-banner"
        />
      </View>
    </If>
  );
}

function ErrorBanner() {
  return (
    <If when={lastError()}>
      {message => (
        <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          <InlineBanner
            tone="danger"
            message={localizeHostError(message())}
            action={
              isAuthRequiredError(message()) ? (
                <Button
                  label={tr("devices.signInCta")}
                  variant="secondary"
                  size="xs"
                  leadingIcon="log-in"
                  accessibilityLabel="error-banner-sign-in"
                  onPress={() =>
                    openAccountAuthModal({
                      onSuccess: () => {
                        clearError();
                        void refreshSidebarDevices();
                      },
                    })
                  }
                />
              ) : undefined
            }
            onDismiss={clearError}
          />
        </View>
      )}
    </If>
  );
}

const SEARCH_GROUPS: ReadonlyArray<{
  kind: SearchItem["kind"];
  titleKey: MessageKey;
  icon: IconName;
}> = [
  { kind: "command", titleKey: "search.commands", icon: "command" },
  { kind: "session", titleKey: "search.sessions", icon: "chat" },
  { kind: "message", titleKey: "search.messages", icon: "message-circle" },
  { kind: "file", titleKey: "search.files", icon: "file-text" },
  { kind: "workspace", titleKey: "search.workspaces", icon: "folder" },
  { kind: "assistant", titleKey: "search.assistants", icon: "bot" },
  { kind: "setting", titleKey: "search.settings", icon: "settings" },
];

/** Scope chips narrow the list to one group; `all` draws every group. */
const searchScope = signal<SearchItem["kind"] | "all">("all");

/** Settings sections, matched by their localized names (the shell owns their navigation). */
function settingsSearchItems(rawNeedle: string): SearchItem[] {
  const needle = rawNeedle.trim().toLowerCase();
  if (!needle) return [];
  const items: SearchItem[] = [];
  for (const group of SETTINGS_PAGE_GROUPS) {
    for (const page of group.pages) {
      const label = tr(page.labelKey);
      const description = tr(page.descriptionKey);
      const hit = [label, description, ...page.keywords].some(text =>
        text.toLowerCase().includes(needle),
      );
      if (!hit) continue;
      items.push({
        id: `setting:${page.id}`,
        kind: "setting" as const,
        label,
        detail: `${tr(group.labelKey)} · ${description}`,
        target: page.id,
      });
    }
  }
  return items.slice(0, 8);
}

function runShellSearchItem(item: SearchItem): void {
  if (item.kind === "setting") {
    closeGlobalSearch();
    navigateScene("settings");
    requestSettingsPage(item.target as SettingsPageEntry["id"]);
    return;
  }
  void runSearchItem(item);
}

function localizedCommandItems(rawNeedle: string): SearchItem[] {
  const needle = rawNeedle.trim().toLowerCase();
  return SEARCH_COMMANDS.filter(cmd => {
    if (!needle) return true;
    const label = tr(cmd.labelKey).toLowerCase();
    const detail = tr(cmd.detailKey).toLowerCase();
    return (
      label.includes(needle) ||
      detail.includes(needle) ||
      cmd.aliases.some(alias => alias.includes(needle))
    );
  }).map(cmd => ({
    id: cmd.id,
    kind: "command" as const,
    label: tr(cmd.labelKey),
    detail: tr(cmd.detailKey),
    target: cmd.target,
  }));
}

/**
 * Spotlight Command Palette: searches the active workspace's sessions, turns,
 * files, and studio commands behind a leading `>`. Opens instantaneously with
 * zero open/close animation (keyboard-triggered 100+/day tool).
 */
function SearchPanel() {
  const activeIndex = signal(0);
  searchScope.set("all");
  const itemRefs = new Map<string, ViewRef>();

  // Localize command items reactively and support both English (`>files`, `>settings`)
  // and localized (`>文件`, `>设置`) command queries seamlessly.
  const effectiveItems = computed<SearchItem[]>(() => {
    currentLocale();
    const q = searchQuery().trim();
    if (q === "") {
      return localizedCommandItems("");
    }
    if (q.startsWith(">")) {
      return localizedCommandItems(q.slice(1));
    }
    const hits = searchItems().map(item => {
      if (item.kind !== "command") return item;
      const def = SEARCH_COMMANDS.find(cmd => cmd.id === item.id);
      if (!def) return item;
      return {
        ...item,
        label: tr(def.labelKey),
        detail: tr(def.detailKey),
      };
    });
    return [...localizedCommandItems(q).filter(cmd => !hits.some(hit => hit.id === cmd.id)), ...hits, ...settingsSearchItems(q)];
  });

  /** The groups that have hits, for the scope chips. */
  const availableKinds = computed<Array<SearchItem["kind"]>>(() =>
    SEARCH_GROUPS.map(g => g.kind).filter(kind => effectiveItems().some(item => item.kind === kind)),
  );
  const scopedItems = computed<SearchItem[]>(() => {
    const scope = searchScope();
    const list = effectiveItems();
    if (scope === "all" || !availableKinds().includes(scope)) return list;
    return list.filter(item => item.kind === scope);
  });

  const groupedRows = (kind: SearchItem["kind"]) =>
    scopedItems().filter(item => item.kind === kind);

  const flatResults = computed<SearchItem[]>(() => {
    const all: SearchItem[] = [];
    const list = scopedItems();
    for (const g of SEARCH_GROUPS) {
      for (const item of list) {
        if (item.kind === g.kind) all.push(item);
      }
    }
    return all;
  });

  effect(() => {
    searchQuery();
    const len = flatResults().length;
    if (len === 0) {
      activeIndex.set(0);
    } else if (activeIndex() >= len) {
      activeIndex.set(0);
    }
  });

  const activeItemId = computed(() => {
    const list = flatResults();
    const idx = activeIndex();
    return list[idx]?.id ?? null;
  });

  const revealActiveItem = (id: string | null) => {
    if (!id) return;
    const node = itemRefs.get(id);
    if (!node) return;
    try {
      node.reveal({ vertical: "nearest", animated: false });
    } catch {
      // Ignore reveal errors if list items changed before layout settled.
    }
  };

  const moveSelection = (delta: number) => {
    const len = flatResults().length;
    if (len === 0) return;
    const nextIdx = (activeIndex() + delta + len) % len;
    activeIndex.set(nextIdx);
    revealActiveItem(flatResults()[nextIdx]?.id ?? null);
  };

  const activateSelection = () => {
    const list = flatResults();
    const chosen = list[activeIndex()] ?? list[0];
    if (chosen) runShellSearchItem(chosen);
  };

  const hasHeaderStatus = () =>
    Boolean(searchNotice()) ||
    (!searchBusy() && searchQuery().trim() !== "" && flatResults().length === 0);

  return (
    <Overlay
      onCancel={() => closeGlobalSearch()}
      style={{
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingTop: 56,
        paddingBottom: 24,
        alignItems: "center",
      }}
    >
      {/* Clean dimming scrim — no double-blur stacking behind the command palette card */}
      <View
        focusable={false}
        onPress={() => closeGlobalSearch()}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: palette().scrimBg,
        }}
      />

      <View
        role="dialog"
        accessibilityLabel="global-search-dialog"
        style={{
          width: "100%",
          maxWidth: 744,
          maxHeight: "100%",
          flexShrink: 1,
          minHeight: 0,
          borderRadius: 22,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderStrong,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(18px) saturate(1.2)",
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        {/* Top Search Input Row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 12,
            flexShrink: 0,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 0,
              height: controlHeight.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 11,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().inputBg,
              boxShadow: palette().shadowInset,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            focusWithinStyle={{
              borderColor: palette().fieldFocusBorder,
              boxShadow: `0 0 0 3px ${palette().accentSoft}`,
            }}
          >
            <Icon name="search" size={15} color={palette().textMuted} />
            <Input
              autoFocus
              value={searchQuery()}
              placeholder={tr("search.placeholder")}
              accessibilityLabel="global-search-input"
              submitBehavior="submit"
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().text,
                placeholderColor: palette().textMuted,
                caretColor: palette().accent,
                fontSize: textSize(13.5),
              }}
              onChange={event => {
                setSearchQuery(event.value);
                activeIndex.set(0);
              }}
              onSubmit={() => activateSelection()}
              onKeyPress={event => {
                if (event.key === "Escape") {
                  closeGlobalSearch();
                } else if (event.key === "ArrowDown") {
                  moveSelection(1);
                } else if (event.key === "ArrowUp") {
                  moveSelection(-1);
                }
              }}
            />
            <If when={searchBusy()}>
              <Spinner size={13} color={palette().accent} />
            </If>
            <If when={!searchBusy() && searchQuery().length > 0}>
              <IconButton
                icon="close"
                size="xs"
                iconSize={11}
                accessibilityLabel="global-search-clear"
                tooltip={tr("common.clearSearch")}
                onPress={() => {
                  setSearchQuery("");
                  activeIndex.set(0);
                }}
              />
            </If>
          </View>
          <IconButton
            icon="close"
            size="sm"
            accessibilityLabel="global-search-close"
            tooltip={tr("common.closeEsc")}
            onPress={() => closeGlobalSearch()}
          />
        </View>

        {/* Scope chips: one per group that has hits, so a long list narrows in one press */}
        <If when={availableKinds().length > 1}>
          <View
            style={{
              paddingHorizontal: 20,
              paddingBottom: 10,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 6,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              flexShrink: 0,
            }}
          >
            <PillChip
              label={tr("search.scopeAll")}
              active={searchScope() === "all" || !availableKinds().includes(searchScope() as SearchItem["kind"])}
              accessibilityLabel="global-search-scope-all"
              onPress={() => {
                searchScope.set("all");
                activeIndex.set(0);
              }}
            />
            <Each of={availableKinds()} key={kind => kind}>
              {kind => (
                <PillChip
                  label={tr(SEARCH_GROUPS.find(g => g.kind === kind())!.titleKey)}
                  active={searchScope() === kind()}
                  badge={effectiveItems().filter(item => item.kind === kind()).length}
                  accessibilityLabel={`global-search-scope-${kind()}`}
                  onPress={() => {
                    searchScope.set(kind());
                    activeIndex.set(0);
                  }}
                />
              )}
            </Each>
          </View>
        </If>

        {/* Notices & Empty State (rendered only when needed — zero dead padding) */}
        <If when={hasHeaderStatus()}>
          <View style={{ paddingHorizontal: 14, paddingTop: 10, gap: 8, flexShrink: 0 }}>
            <If when={searchNotice()}>
              {notice => <InlineBanner tone="warning" message={localizeHostError(notice())} />}
            </If>
            <If
              when={!searchBusy() && searchQuery().trim() !== "" && flatResults().length === 0}
            >
              <View
                style={{
                  paddingVertical: 20,
                  paddingHorizontal: 16,
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon name="search" size={18} color={palette().textMuted} />
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.45),
                    textAlign: "center",
                  }}
                >
                  {tr("search.noMatches")}
                </Text>
                <Button
                  label={tr("common.clearSearch")}
                  size="xs"
                  variant="ghost"
                  onPress={() => {
                    setSearchQuery("");
                    activeIndex.set(0);
                  }}
                />
              </View>
            </If>
          </View>
        </If>

        {/* Grouped Results */}
        <If when={flatResults().length > 0}>
          <Scroll
            scrollbar={true}
            style={{ flexShrink: 1, minHeight: 0 }}
            contentStyle={{ paddingHorizontal: 10, paddingVertical: 8, gap: 10 }}
          >
            <Each of={SEARCH_GROUPS} key={group => group.kind}>
              {group => (
                <If when={groupedRows(group().kind).length > 0}>
                  <View style={{ gap: 2 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Icon name={group().icon} size={11} color={palette().textElevatedMuted} />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().textElevatedMuted,
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.3),
                          fontWeight: "600",
                          letterSpacing: textTracking(10.5),
                        }}
                      >
                        {tr(group().titleKey)}
                      </Text>
                      <Text
                        style={{
                          color: palette().textElevatedMuted,
                          fontSize: textSize(10),
                          lineHeight: textLineHeight(10, 1.3),
                          fontVariant: ["tabular-nums"],
                          flexShrink: 0,
                        }}
                      >
                        {String(groupedRows(group().kind).length)}
                      </Text>
                    </View>
                    <Each of={groupedRows(group().kind)} key={item => item.id}>
                      {item => {
                        const isSelected = () => activeItemId() === item().id;
                        return (
                          <View
                            ref={el => {
                              if (el) itemRefs.set(item().id, el);
                              else itemRefs.delete(item().id);
                            }}
                            role="button"
                            accessibilityLabel={`global-search-item-${item().id}`}
                            accessibilityState={{ selected: isSelected() }}
                            onMouseEnter={() => {
                              const idx = flatResults().findIndex(
                                entry => entry.id === item().id,
                              );
                              if (idx >= 0) activeIndex.set(idx);
                            }}
                            onPress={() => runShellSearchItem(item())}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 10,
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: radii.sm,
                              borderCurve: "continuous",
                              borderWidth: 1,
                              borderColor: isSelected()
                                ? palette().accentBorder
                                : "transparent",
                              backgroundColor: isSelected()
                                ? palette().accentSoft
                                : "transparent",
                              cursor: "pointer",
                              ...paintTransition(MOTION_DURATION.fast),
                            }}
                            hoverStyle={{
                              backgroundColor: isSelected()
                                ? palette().accentSoft
                                : palette().panelHover,
                            }}
                            activeStyle={{ opacity: 0.88 }}
                            focusVisibleStyle={{
                              outlineWidth: 2,
                              outlineColor: palette().borderFocus,
                              outlineOffset: -1,
                            }}
                          >
                            <Icon
                              name={group().icon}
                              size={14}
                              color={
                                isSelected() ? palette().accent : palette().textMuted
                              }
                            />
                            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                              <Text
                                style={{
                                  color: palette().text,
                                  fontSize: textSize(12.5),
                                  lineHeight: textLineHeight(12.5, 1.35),
                                  fontWeight: isSelected() ? "600" : "500",
                                  numberOfLines: 1,
                                  textOverflow:
                                    item().kind === "file" ? "ellipsis-middle" : "ellipsis",
                                }}
                              >
                                {item().label}
                              </Text>
                              <If when={item().detail}>
                                {detail => (
                                  <Text
                                    style={{
                                      color: palette().textElevatedMuted,
                                      fontFamily: item().kind === "file" ? fontMono : undefined,
                                      fontSize: textSize(11),
                                      lineHeight: textLineHeight(11, 1.38),
                                      numberOfLines: 1,
                                      textOverflow:
                                        item().kind === "file" ? "ellipsis-middle" : "ellipsis",
                                    }}
                                  >
                                    {detail()}
                                  </Text>
                                )}
                              </If>
                            </View>
                            <If when={isSelected()}>
                              <KbdHint keys="↵" />
                            </If>
                          </View>
                        );
                      }}
                    </Each>
                  </View>
                </If>
              )}
            </Each>
          </Scroll>
        </If>

        {/* Bottom Keyboard Hint Footer */}
        <View
          style={{
            minHeight: 34,
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().surfaceTertiary,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <KbdHint keys="↑↓" />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.3),
                }}
              >
                {tr("search.hintNavigate")}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <KbdHint keys="↵" />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.3),
                }}
              >
                {tr("search.hintOpen")}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <KbdHint keys="Esc" />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.3),
                }}
              >
                {tr("search.hintClose")}
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(10.5),
              lineHeight: textLineHeight(10.5, 1.3),
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatPlural(flatResults().length, "format.resultOne", "format.resultOther")}
          </Text>
        </View>
      </View>
    </Overlay>
  );
}

/**
 * The shell's shortcuts. Ids follow the desktop's shortcut registry so a user
 * override stored in `app.keybindings` (`{ __version__: 1, overrides: { id: { key,
 * ctrl, shift, alt, meta } } }`, or the legacy flat map) rebinds the same action
 * here. OS-window fullscreen (F11, Control+Command+F) is a platform-reserved key
 * NSH does not let an app bind, so it is offered as a command instead.
 */
const SHELL_SHORTCUTS: ReadonlyArray<{ id: string; keystroke: string; run: () => void }> = [
  { id: "search.global", keystroke: "mod+k", run: () => openGlobalSearch() },
  { id: "panel.toggleLeft", keystroke: "mod+b", run: () => toggleDrawer() },
  { id: "panel.toggleRight", keystroke: "mod+j", run: () => toggleAuxPane() },
  { id: "scene.openSettings", keystroke: "mod+,", run: () => navigateScene("settings") },
  {
    id: "chat.newSession",
    keystroke: "mod+n",
    run: () => {
      void createSessionInWorkspace(tr("nav.newSession"));
      navigateScene("sessions");
    },
  },
  {
    id: "tab.close",
    keystroke: "mod+w",
    run: () => {
      const tab = activeScene();
      if (openSceneTabs().length > 1 && !isTabPinned(tab)) closeTab(tab);
    },
  },
  { id: "tab.previous", keystroke: "mod+shift+[", run: () => cycleSceneTab(-1) },
  { id: "tab.next", keystroke: "mod+shift+]", run: () => cycleSceneTab(1) },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({
    id: `tab.switch${n}`,
    keystroke: `mod+${n}`,
    run: () => {
      const tabs = orderedSceneTabs();
      const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
      if (target) navigateScene(target);
    },
  })),
];

function keystrokeFromOverride(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.key !== "string" || !v.key.trim()) return null;
  const parts: string[] = [];
  // The desktop treats `ctrl` as the primary modifier (Command on macOS).
  if (v.ctrl === true || v.meta === true) parts.push("mod");
  if (v.shift === true) parts.push("shift");
  if (v.alt === true) parts.push("alt");
  parts.push(v.key.trim().toLowerCase());
  return parts.join("+");
}

function readKeybindingOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const doc = raw as Record<string, unknown>;
  const map =
    doc.__version__ === 1 && doc.overrides && typeof doc.overrides === "object"
      ? (doc.overrides as Record<string, unknown>)
      : "__version__" in doc
        ? {}
        : doc;
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(map)) {
    if (id.startsWith("__")) continue;
    const keystroke = keystrokeFromOverride(value);
    if (keystroke) out[id] = keystroke;
  }
  return out;
}

function bindShortcut(keystroke: string, run: () => void): (() => void) | null {
  try {
    return keymap.bind(keystroke, () => run());
  } catch (error) {
    console.warn(`Shortcut ${keystroke} cannot be bound here`, error);
    return null;
  }
}

function runShellShortcut(id: string): void {
  SHELL_SHORTCUTS.find(shortcut => shortcut.id === id)?.run();
}

function bindShellShortcuts(): void {
  const unbinders = new Map<string, () => void>();
  // A native application menu carries some of these keys itself; binding them
  // again would run the action twice.
  const menuOwned = shellMenuShortcutIds();
  for (const shortcut of SHELL_SHORTCUTS) {
    if (menuOwned.has(shortcut.id)) continue;
    const stop = bindShortcut(shortcut.keystroke, shortcut.run);
    if (stop) unbinders.set(shortcut.id, stop);
  }
  cleanup(() => unbinders.forEach(stop => stop()));
  void invokeCommand<unknown>("get_config", { path: "app.keybindings", skipRetryOnNotFound: true })
    .then(raw => {
      const overrides = readKeybindingOverrides(raw);
      for (const shortcut of SHELL_SHORTCUTS) {
        const keystroke = overrides[shortcut.id];
        if (!keystroke || keystroke === shortcut.keystroke || menuOwned.has(shortcut.id)) continue;
        const stop = bindShortcut(keystroke, shortcut.run);
        if (!stop) continue;
        unbinders.get(shortcut.id)?.();
        unbinders.set(shortcut.id, stop);
      }
    })
    .catch(() => undefined);
}

async function toggleMainWindowFullscreen(): Promise<void> {
  try {
    await toggleWindowFullscreen();
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

// ── Responsive shell: one UI from phone to desktop ───────────────────────────

/** Width of the whole window, measured on the root view. */
const shellWidth = signal(0);
/** Phone-sized layouts: the sidebar becomes an overlay drawer and side panes fill the scene. */
const compactShell = computed(() => shellWidth() > 0 && shellWidth() < 720);

function auxFillsScene(): boolean {
  return auxPaneMaximized() || compactShell();
}

function CompactDrawer() {
  return (
    <View
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, flexDirection: "row" }}
    >
      <View
        style={{
          width: Math.min(320, Math.max(240, shellWidth() * 0.86)),
          height: "100%",
          minHeight: 0,
          flexDirection: "column",
          backgroundColor: palette().chromeBg,
          boxShadow: palette().shadowOverlay,
        }}
      >
        <NavBar />
        <NavPanel />
      </View>
      <View
        role="button"
        accessibilityLabel="compact-drawer-scrim"
        onPress={() => drawerOpen.set(false)}
        style={{ flex: 1, height: "100%", backgroundColor: palette().scrimBg }}
      />
    </View>
  );
}

function App() {
  syncGlobalNativeTheme();
  void initAppLocale();
  void initWindowChrome();
  void loadAppearance();
  // The host's font baseline decides every text size in every scene, so it is
  // read before anything is drawn rather than when the settings page opens.
  void loadFontPreference();
  // The stored conversation width shapes how every transcript is laid out, so it
  // is read once here instead of when the settings page is opened.
  void loadContentWidth();
  void loadQueue();
  ensureSendPolicy();
  ensureQuickActions();
  void loadSeenSessions();
  void loadAccountState();
  void loadShellLayout();
  void loadWorkspaces({ autoOpenRecent: true });
  void loadSavedConnections();
  void startPermissionPrompts();
  void startQuestionPrompts();
  startNotifications();

  const unsubAccountAuth = onAccountAuthChanged(signedIn => {
    if (signedIn) {
      void refreshSidebarDevices();
    } else {
      sidebarPeerDevices.set([]);
    }
  });
  cleanup(() => unsubAccountAuth());

  // The layout is the user's: written back on every change once the stored one was read.
  effect(() => persistShellLayout());

  const unsubCloseRequest = onMainWindowCloseRequest(() => {
    void handleMainWindowCloseRequest();
  });
  cleanup(() => unsubCloseRequest());

  // The application menu and the tray are the shell's: the Tauri window builds
  // them natively and asks the page through events, a native NSH window builds
  // them from `nsh/desktop`. Both run the same actions.
  const stopShellIntegration = startShellIntegration({
    newSession: () => runShellShortcut("chat.newSession"),
    openFolder: () => void pickAndOpenWorkspaceFolder(),
    newWorkspace: () => void openNewWorkspaceModal({ step: "project" }),
    openSettings: () => runShellShortcut("scene.openSettings"),
    toggleSidebar: () => runShellShortcut("panel.toggleLeft"),
    about: () => openAboutDialog(),
    markAllRead: () => markAllNotificationsRead(),
  });
  cleanup(() => stopShellIntegration());

  void initWindowChrome().then(() => {
    if (nativeWindow()) void readPendingUpdate();
  });

  bindShellShortcuts();

  // Entering a compact layout folds the sidebar away; picking a scene there closes it again.
  let wasCompact = false;
  effect(() => compactLayout.set(compactShell()));
  effect(() => {
    const compact = compactShell();
    if (compact && !wasCompact) untracked(() => drawerOpen.set(false));
    wasCompact = compact;
  });
  effect(() => {
    activeScene();
    activeSessionId();
    if (untracked(() => compactShell())) untracked(() => drawerOpen.set(false));
  });

  return (
    <View
      onLayout={event => {
        const width = event.bounds.size.width;
        if (width > 0 && Math.abs(width - shellWidth()) > 1) shellWidth.set(width);
      }}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flexDirection: "row",
        backgroundColor: palette().chromeBg,
      }}
    >
      {/* Left Recessed Navigation Chrome */}
      <If when={drawerOpen() && !compactShell()}>
        <View
          style={{
            flexDirection: "row",
            height: "100%",
            minHeight: 0,
            maxWidth: "58%",
            flexShrink: 0,
          }}
        >
          <View
            style={{
              width: navWidth(),
              flexShrink: 1,
              minWidth: 160,
              maxWidth: 480,
              minHeight: 0,
              flexDirection: "column",
              backgroundColor: palette().chromeBg,
            }}
          >
            <NavBar />
            <NavPanel />
          </View>
          <SplitHandle
            surface="chrome"
            seam={false}
            accessibilityLabel="nav-split-handle"
            onDragStateChange={dragging => {
              navDragWidth = dragging ? navWidth() : null;
            }}
            onDelta={delta => {
              // The drag follows the pointer past the minimum; far enough left, it folds.
              navDragWidth = (navDragWidth ?? navWidth()) + delta;
              if (navDragWidth < NAV_COLLAPSE_WIDTH) {
                navDragWidth = null;
                drawerOpen.set(false);
                return;
              }
              setNavWidth(navDragWidth);
            }}
            onReset={() => setNavWidth(NAV_DEFAULT_WIDTH)}
          />
        </View>
      </If>

      {/* Right Inset Rounded Paper Scene Surface (matches `src/web-ui` WorkspaceBody) */}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          borderTopLeftRadius: drawerOpen() && !compactShell() ? radii.surface : 0,
          borderBottomLeftRadius: drawerOpen() && !compactShell() ? radii.surface : 0,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderCurve: "continuous",
          borderLeftWidth: drawerOpen() && !compactShell() ? 1 : 0,
          borderColor: palette().border,
          backgroundColor: palette().canvas,
          boxShadow: drawerOpen() && !compactShell() ? palette().shadowSceneEdge : undefined,
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        <SceneTopBar />
        <BackendConnectionBanner />
        <PeerBanner />
        <ErrorBanner />

        <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" }}>
          <If when={auxPaneOpen() && auxPaneSide() === "left" && !auxFillsScene()}>
            <View
              style={{
                flexDirection: "row",
                minHeight: 0,
                width: auxPaneWidth() + 9,
                maxWidth: "68%",
                flexShrink: 0,
              }}
            >
              <AuxPane />
              <SplitHandle
                surface="canvas"
                accessibilityLabel="aux-split-handle-left"
                onDelta={delta => setAuxPaneWidth(auxPaneWidth() + delta)}
                onReset={() => setAuxPaneWidth(DEFAULT_AUX_WIDTH)}
              />
            </View>
          </If>

          <If when={!(auxPaneOpen() && auxFillsScene())}>
            <View
              onFileDrop={event => void handleSceneFileDrop(event.uris)}
              style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}
            >
              <ErrorBoundary
                fallback={(error, reset) => <SceneErrorCard error={error} reset={reset} area="scene" />}
              >
                {/* The switch lives in a view so it stays reactive under the boundary. */}
                <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
                  {sceneElement()}
                </View>
              </ErrorBoundary>
            </View>
          </If>

          <If when={auxPaneOpen() && auxPaneSide() === "right" && !auxFillsScene()}>
            <View
              style={{
                flexDirection: "row",
                minHeight: 0,
                width: auxPaneWidth() + 9,
                maxWidth: "68%",
                flexShrink: 0,
              }}
            >
              <SplitHandle
                surface="canvas"
                accessibilityLabel="aux-split-handle-right"
                onDelta={delta => setAuxPaneWidth(auxPaneWidth() - delta)}
                onReset={() => setAuxPaneWidth(DEFAULT_AUX_WIDTH)}
              />
              <AuxPane />
            </View>
          </If>

          <If when={auxPaneOpen() && auxFillsScene()}>
            <AuxPane />
          </If>
        </View>
      </View>

      <If when={compactShell() && drawerOpen()}>
        <CompactDrawer />
      </If>
      <If when={searchOpen()}>
        <SearchPanel />
      </If>
      <SshWorkspaceModals />
      <AccountAuthModal />
      <WorkspaceDialogs />
      <AboutDialog />
      <CloseAskDialog />
      <ToastHost />
    </View>
  );
}

mount(App);

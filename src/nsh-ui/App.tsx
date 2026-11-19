import {
  cleanup,
  computed,
  effect,
  keymap,
  mount,
  Overlay,
  reduceMotion,
  Scroll,
  signal,
  Text,
  View,
  type Point,
  type PressEvent,
  type ScrollRef,
  type ViewRef,
} from "nsh";
import { Input } from "nsh/base";
import {
  initWindowChrome,
  invokeRawCommand,
  openHostEventChannel,
  startWindowDrag,
  toggleWindowMaximize,
  trafficLightInsetPx,
} from "./src/bridge";
import { subscribeAgentEvents } from "./src/agentEvents";
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
  busy,
  canGoBack,
  canGoForward,
  clearError,
  closeSceneTab,
  closeWorkspace,
  createSessionInWorkspace,
  deleteSessionRow,
  drawerOpen,
  goBackScene,
  goForwardScene,
  initAppLocale,
  isSessionArchived,
  lastError,
  loadMoreSessions,
  loadWorkspaces,
  navWidth,
  navigateScene,
  openInAuxPane,
  openSceneTabs,
  renameSession,
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
import { forgetTerminals } from "./src/terminalStore";
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
  selectedCategory,
  SettingsScene,
  type SettingsCategory,
} from "./src/scenes/SettingsScene";

openHostEventChannel();
subscribeAgentEvents();

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

const SETTINGS_NAV_CATEGORIES: ReadonlyArray<{
  id: SettingsCategory;
  labelKey: MessageKey;
  icon: IconName;
}> = [
  { id: "all", labelKey: "settings.cat.all", icon: "layers" },
  { id: "appearance", labelKey: "settings.cat.appearance", icon: "palette" },
  { id: "agent", labelKey: "settings.cat.agent", icon: "bot" },
  { id: "models", labelKey: "settings.cat.models", icon: "cpu" },
  { id: "permissions", labelKey: "settings.cat.permissions", icon: "shield" },
  { id: "mcp", labelKey: "settings.cat.mcp", icon: "plug" },
  { id: "workspace", labelKey: "settings.cat.workspace", icon: "terminal-square" },
  { id: "usage", labelKey: "settings.cat.usage", icon: "database" },
];

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
const collapsedWorkspaces = signal<Record<string, boolean>>({});
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

const DEFAULT_NAV_WIDTH = 272;
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
      id: "session-archive",
      label: target.archived ? tr("nav.restoreThread") : tr("nav.archiveThread"),
      icon: target.archived ? "undo" : "layers",
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
      separator: true,
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
        height: props.compact ? 28 : 30,
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
        size={props.compact ? 14 : 15}
        color={props.active ? palette().chromeText : palette().chromeTextMuted}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: props.active ? palette().chromeText : palette().chromeTextMuted,
          fontSize: textSize(props.compact ? 12 : 12.5),
          lineHeight: textLineHeight(props.compact ? 12 : 12.5, 1.32),
          fontWeight: props.active ? "600" : "500",
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
        onPressDown={handleTitlebarPressDown}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          cursor: "default",
        }}
      >
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().chromeText,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.3),
            letterSpacing: textTracking(13),
            fontWeight: "600",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("product.name")}
        </Text>
      </View>
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

function WorkbenchNavStrip() {
  const innerRadius = concentricRadius(radii.sm, 2.5);
  return (
    <View
      role="tablist"
      accessibilityLabel={tr("nav.workbench")}
      style={{
        height: 30,
        padding: 2.5,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().chromeBorder,
        backgroundColor: palette().chromeInputBg,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Each of={WORKBENCH_NAV_SCENES} key={sceneId => sceneId}>
        {sceneId => {
          const isActive = () => activeScene() === sceneId();
          return (
            <View
              role="button"
              accessibilityLabel={tr(SCENE_META[sceneId()].labelKey)}
              accessibilityState={{ selected: isActive() }}
              onPress={() => navigateScene(sceneId())}
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                paddingHorizontal: 5,
                borderRadius: innerRadius,
                borderCurve: "continuous",
                backgroundColor: isActive() ? palette().chromeActive : "transparent",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{
                backgroundColor: isActive() ? palette().chromeActive : palette().chromeHover,
              }}
              activeStyle={{ backgroundColor: palette().chromeActive }}
              focusVisibleStyle={{
                outlineWidth: 2,
                outlineColor: palette().chromeAccent,
                outlineOffset: -1,
              }}
            >
              <Icon
                name={SCENE_META[sceneId()].icon}
                size={12.5}
                color={isActive() ? palette().chromeAccent : palette().chromeTextMuted}
              />
              <Text
                style={{
                  flexShrink: 1,
                  minWidth: 0,
                  color: isActive() ? palette().chromeText : palette().chromeTextMuted,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.28),
                  fontWeight: isActive() ? "600" : "500",
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr(SCENE_META[sceneId()].labelKey)}
              </Text>
            </View>
          );
        }}
      </Each>
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

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onContextMenu={e => {
        openSessionMenuAtPoint(
          {
            sessionId: props.sessionId,
            title: props.title,
            archived: props.archived,
          },
          e.pagePosition,
        );
      }}
      style={{
        height: 29,
        paddingLeft: 8,
        paddingRight: showMenu() ? 2 : 6,
        borderRadius: radii.sm,
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
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.32),
            fontWeight: props.active ? "500" : "400",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.title}
        </Text>
      </View>

      <If when={showMenu() ? "" : (props.statusLabel ?? "")}>
        {labelText => (
          <View
            accessibilityLabel={`status-${labelText()}`}
            tooltip={<TooltipBubble text={labelText()} />}
            style={{ flexShrink: 0, alignItems: "center", justifyContent: "center" }}
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

      <If when={showMenu()}>
        <View
          ref={el => actionsAnchor.set(el)}
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconButton
            icon="more"
            size="xs"
            iconSize={12}
            surface="chrome"
            style={{ width: 22, height: 22 }}
            accessibilityLabel={`session-row-actions-${props.sessionId}`}
            tooltip={tr("nav.threadActions")}
            onPress={() => {
              openSessionMenuAtAnchor(
                {
                  sessionId: props.sessionId,
                  title: props.title,
                  archived: props.archived,
                },
                actionsAnchor(),
              );
            }}
          />
        </View>
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

  return (
    <View style={{ gap: 2 }}>
      {/* Borderless 28px collapsible tree header — single right rail, zero reserved hover width */}
      <View
        onMouseEnter={() => hovered.set(true)}
        onMouseLeave={() => hovered.set(false)}
        style={{
          position: "relative",
          height: 28,
          paddingLeft: 4,
          paddingRight: showActions() ? 2 : 6,
          borderRadius: radii.sm,
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
            expanded: props.showNestedSessions && isCurrent() && !isCollapsed(),
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
            gap: 5,
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
          <Icon
            name={
              props.showNestedSessions && isCurrent() && !isCollapsed()
                ? "chevron-down"
                : "chevron-right"
            }
            size={11}
            color={palette().chromeTextMuted}
          />
          <Icon
            name={workspaceKindIcon({
              workspaceKind: props.workspaceKind,
              connectionId: props.connectionId,
              sshHost: props.sshHost,
            })}
            size={13.5}
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
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.32),
                fontWeight: isCurrent() ? "600" : "500",
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
          <If when={!showActions()}>
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
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.3),
                  fontWeight: "500",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {String(sessionTotal())}
              </Text>
            </If>
          </If>
        </View>

        <If when={showActions()}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 1,
              flexShrink: 0,
            }}
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
                onPress={() => {
                  workspaceActionAnchor.set(actionsBtnRef());
                  workspaceActionMenuId.set(
                    workspaceActionMenuId() === props.id ? null : props.id,
                  );
                }}
              />
            </View>
          </View>
        </If>

        <If when={!showActions()}>
          <View
            ref={el => actionsBtnRef.set(el)}
            role="button"
            accessibilityLabel={`workspace-actions-${props.id}`}
            onPress={() => {
              workspaceActionAnchor.set(actionsBtnRef());
              workspaceActionMenuId.set(
                workspaceActionMenuId() === props.id ? null : props.id,
              );
            }}
            style={{
              position: "absolute",
              right: 2,
              top: 3,
              width: 1,
              height: 1,
              opacity: 0,
            }}
          />
        </If>
      </View>

      <If when={props.showNestedSessions && isCurrent() && !isCollapsed()}>
        <View
          style={{
            marginLeft: 9,
            paddingLeft: 10,
            paddingVertical: 1,
            borderLeftWidth: 1,
            borderColor: palette().chromeBorder,
            gap: 1,
          }}
        >
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
          <If when={visibleSessionRows().length === 0}>
            <Text
              style={{
                paddingHorizontal: 8,
                paddingVertical: 5,
                color: palette().chromeTextMuted,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.4),
              }}
            >
              {showArchivedSessions() ? tr("nav.noArchivedSessions") : tr("nav.noSessions")}
            </Text>
          </If>
          <If when={!showArchivedSessions() && sessionHasMore()}>
            <View
              role="button"
              accessibilityLabel="load-more-sessions"
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
    </View>
  );
}

function workspaceDropdownItems(workspaceId: string): DropdownMenuItem[] {
  const ws = workspaces().find(item => item.id === workspaceId);
  if (!ws) return [];
  const items: DropdownMenuItem[] = [
    {
      id: "new-session",
      label: tr("nav.newSession"),
      icon: "plus",
      onSelect: () => {
        expandWorkspace(ws.id);
        selectWorkspace(ws.id);
        void createSessionInWorkspace(tr("nav.newSession"));
        navigateScene("sessions");
      },
    },
  ];
  if (ws.connectionId) {
    const host = remoteSshHost(ws);
    items.push(
      {
        id: "remote-browse",
        label: tr("nav.browseRemoteFiles"),
        icon: "folder",
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
  items.push({
    id: "close-workspace",
    label: tr("nav.closeWorkspace"),
    icon: "close",
    danger: true,
    separator: true,
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

      <View style={{ gap: 2, paddingTop: 4 }}>
        <Text
          style={{
            paddingHorizontal: 8,
            paddingBottom: 4,
            color: palette().chromeTextMuted,
            fontSize: textSize(10.5),
            lineHeight: textLineHeight(10.5, 1.3),
            fontWeight: "600",
            letterSpacing: textTracking(10.5, true),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("nav.settingsSections")}
        </Text>
        <Each of={SETTINGS_NAV_CATEGORIES} key={cat => cat.id}>
          {cat => (
            <NavRow
              label={tr(cat().labelKey)}
              icon={cat().icon}
              active={selectedCategory() === cat().id}
              accessibilityLabel={`nav-settings-cat-${cat().id}`}
              onPress={() => selectedCategory.set(cat().id)}
            />
          )}
        </Each>
      </View>
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
        height: 44,
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
          flexShrink: 1,
          minWidth: 0,
          height: controlHeight.sm,
          paddingHorizontal: 8,
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
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.3),
            fontWeight: activeScene() === "devices" ? "600" : "500",
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
          flexShrink: 1,
          minWidth: 0,
          height: controlHeight.sm,
          paddingHorizontal: 8,
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
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.3),
            fontWeight: activeScene() === "settings" ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("nav.settings")}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 4 }} />

      <View
        style={{
          width: 1,
          height: 14,
          marginHorizontal: 2,
          backgroundColor: palette().chromeBorder,
          flexShrink: 0,
        }}
      />

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
      </View>

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
            height: controlHeight.md,
            paddingHorizontal: 9,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().chromeBorder,
            backgroundColor: palette().chromeInputBg,
            boxShadow: palette().shadowInset,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            borderColor: palette().chromeTextMuted,
          }}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={{
            outlineWidth: 2,
            outlineColor: palette().chromeAccent,
            outlineOffset: 1,
          }}
        >
          <Icon name="search" size={13.5} color={palette().chromeTextMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().chromeTextMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.32),
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
                        fontSize: textSize(10.5),
                        lineHeight: textLineHeight(10.5, 1.3),
                        fontWeight: "600",
                        letterSpacing: textTracking(10.5, true),
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
                      <Each of={STUDIO_ONLY_SCENES} key={sceneId => sceneId}>
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

                <WorkbenchNavStrip />
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
                        fontSize: textSize(10.5),
                        lineHeight: textLineHeight(10.5, 1.3),
                        fontWeight: "600",
                        letterSpacing: textTracking(10.5, true),
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

                <If when={workspaces().length === 0}>
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
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.3),
                          fontWeight: "600",
                          letterSpacing: textTracking(10.5, true),
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
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.3),
                          fontWeight: "600",
                          letterSpacing: textTracking(10.5, true),
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
        open={Boolean(workspaceActionMenuId())}
        anchor={workspaceActionAnchor()}
        placement="right"
        align="start"
        minWidth={210}
        items={workspaceActionMenuId() ? workspaceDropdownItems(workspaceActionMenuId()!) : []}
        onClose={() => workspaceActionMenuId.set(null)}
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
        open={Boolean(sessionRenameTarget())}
        title={tr("nav.renameThreadTitle")}
        size="sm"
        accessibilityLabel="sidebar-session-rename-modal"
        onClose={() => sessionRenameTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              onPress={() => sessionRenameTarget.set(null)}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              disabled={!sessionRenameDraft().trim()}
              accessibilityLabel="sidebar-session-rename-save"
              onPress={() => {
                const target = sessionRenameTarget();
                const next = sessionRenameDraft().trim();
                sessionRenameTarget.set(null);
                if (target && next) {
                  void renameSession(target.sessionId, next);
                }
              }}
            />
          </View>
        }
      >
        <TextField
          autoFocus
          label={tr("nav.threadName")}
          value={sessionRenameDraft()}
          placeholder={tr("nav.threadNamePlaceholder")}
          accessibilityLabel="sidebar-session-rename-input"
          onChange={v => sessionRenameDraft.set(v)}
          onSubmit={text => {
            const target = sessionRenameTarget();
            const next = text.trim();
            sessionRenameTarget.set(null);
            if (target && next) {
              void renameSession(target.sessionId, next);
            }
          }}
        />
      </ModalDialog>

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

function SceneTabItem(props: {
  tab: SceneId;
  active: boolean;
  closable: boolean;
  onRef: (node: ViewRef | null) => void;
  onSelect: () => void;
  onClose: () => void;
}) {
  const hovered = signal(false);

  return (
    <View
      ref={props.onRef}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        height: controlHeight.sm,
        paddingRight: props.closable ? 3 : 0,
        borderRadius: 7,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.active
          ? isLightAppearance()
            ? palette().borderStrong
            : palette().border
          : "transparent",
        backgroundColor: props.active ? palette().panelRaised : "transparent",
        boxShadow: props.active
          ? `${palette().shadowButton}, ${palette().innerHighlight}`
          : undefined,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        maxWidth: 168,
        flexShrink: 0,
        overflow: "hidden",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.active ? palette().panelRaised : palette().surfaceSubtle,
      }}
    >
      <View
        role="button"
        accessibilityLabel={`scene-tab-${props.tab}`}
        accessibilityState={{ selected: props.active }}
        onPress={props.onSelect}
        style={{
          height: "100%",
          flexShrink: 1,
          minWidth: 0,
          paddingLeft: 9,
          paddingRight: props.closable ? 3 : 9,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        activeStyle={{ opacity: 0.85 }}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().borderFocus,
          outlineOffset: -2,
        }}
      >
        <Icon
          name={SCENE_META[props.tab].icon}
          size={13}
          color={props.active ? palette().accent : palette().textMuted}
        />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: props.active ? palette().text : palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontWeight: props.active ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr(SCENE_META[props.tab].labelKey)}
        </Text>
      </View>
      <If when={props.closable}>
        <View
          role="button"
          hitSlop={3}
          accessibilityLabel={`scene-tab-close-${props.tab}`}
          tooltip={
            <TooltipBubble
              text={tr("nav.closeTabLabel", { label: tr(SCENE_META[props.tab].labelKey) })}
            />
          }
          onPress={props.onClose}
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            borderRadius: 5,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            opacity: hovered() || props.active ? 1 : 0,
            cursor: "pointer",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().dangerSoft, opacity: 1 }}
          activeStyle={tactileActiveStyle(0.92, {
            backgroundColor: palette().dangerSoft,
          })}
          focusVisibleStyle={{
            outlineWidth: 2,
            outlineColor: palette().borderFocus,
            outlineOffset: 1,
            opacity: 1,
          }}
        >
          <Icon name="close" size={10} color={palette().textMuted} />
        </View>
      </If>
    </View>
  );
}

function SceneTopBar() {
  const scrollRef = signal<ScrollRef | null>(null);
  const tabRefs = new Map<SceneId, ViewRef>();
  const scrollOffset = signal(0);
  const viewportWidth = signal(0);
  const contentWidth = signal(0);

  const canScrollLeft = computed(
    () => contentWidth() > viewportWidth() + 4 && scrollOffset() > 4,
  );
  const canScrollRight = computed(
    () =>
      contentWidth() > viewportWidth() + 4 &&
      scrollOffset() + viewportWidth() < contentWidth() - 4,
  );

  // Eased multi-stop gradient mask pinned to the non-scrolling clipping wrapper
  // so overflowed tabs dissolve smoothly before reaching the scroll chevrons.
  const tabStripMask = computed<string | undefined>(() => {
    const left = canScrollLeft();
    const right = canScrollRight();
    if (!left && !right) return undefined;
    const vw = Math.max(140, viewportWidth());
    const fadePct = Math.min(20, Math.max(8, Math.round((36 / vw) * 100)));
    const s1 = Number((fadePct * 0.35).toFixed(1));
    const s2 = Number((fadePct * 0.72).toFixed(1));
    const rStart = 100 - fadePct;
    const r2 = Number((100 - fadePct * 0.72).toFixed(1));
    const r1 = Number((100 - fadePct * 0.35).toFixed(1));
    if (left && right) {
      return `linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.2) ${s1}%, rgba(0, 0, 0, 0.72) ${s2}%, black ${fadePct}%, black ${rStart}%, rgba(0, 0, 0, 0.72) ${r2}%, rgba(0, 0, 0, 0.2) ${r1}%, transparent 100%)`;
    }
    if (left) {
      return `linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.2) ${s1}%, rgba(0, 0, 0, 0.72) ${s2}%, black ${fadePct}%, black 100%)`;
    }
    return `linear-gradient(to right, black 0%, black ${rStart}%, rgba(0, 0, 0, 0.72) ${r2}%, rgba(0, 0, 0, 0.2) ${r1}%, transparent 100%)`;
  });

  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  cleanup(() => {
    if (revealTimer !== null) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  });

  effect(() => {
    const maxOffset = Math.max(0, contentWidth() - viewportWidth());
    if (scrollOffset() > maxOffset) {
      scrollOffset.set(maxOffset);
    }
  });

  effect(() => {
    const current = activeScene();
    const tabs = openSceneTabs();
    const vw = viewportWidth();
    const cw = contentWidth();
    if (!tabs.includes(current)) return;

    const isLastTab = tabs.length > 0 && tabs[tabs.length - 1] === current;
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = null;
      const scroller = scrollRef();
      if (isLastTab && scroller && vw > 0 && cw > vw + 2) {
        const targetX = Math.max(0, cw - vw);
        scrollOffset.set(targetX);
        scroller.scrollTo({ x: targetX, animated: !reduceMotion() });
        return;
      }
      const node = tabRefs.get(current);
      if (node) {
        try {
          node.reveal({ horizontal: "nearest", animated: !reduceMotion() });
        } catch {
          // Ignore reveal errors if a tab unmounted before layout settled.
        }
      }
    }, 24);
  });

  const scrollTabsBy = (delta: number) => {
    const scroller = scrollRef();
    if (!scroller) return;
    const maxOffset = Math.max(0, contentWidth() - viewportWidth());
    const nextX = Math.max(0, Math.min(maxOffset, scrollOffset() + delta));
    scrollOffset.set(nextX);
    scroller.scrollTo({ x: nextX, animated: !reduceMotion() });
  };

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
    items.push({
      id: "topbar-ws-new",
      label: tr("nav.newWorkspace"),
      icon: "folder-plus",
      separator: true,
      onSelect: () => void openNewWorkspaceModal({ step: "project" }),
    });
    return items;
  };

  return (
    <View
      style={{
        height: 44,
        minWidth: 0,
        overflow: "hidden",
        paddingLeft: !drawerOpen() && trafficLightInsetPx() > 0 ? trafficLightInsetPx() : 10,
        paddingRight: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
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
          <View
            focusable={false}
            onPressDown={handleTitlebarPressDown}
            style={{
              height: 36,
              justifyContent: "center",
              paddingHorizontal: 6,
              cursor: "default",
            }}
          >
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.3),
                letterSpacing: textTracking(12.5),
                fontWeight: "600",
              }}
            >
              {tr("product.name")}
            </Text>
          </View>
        </View>
      </If>

      {/* SceneBar Tabs — sleek 28px/7px geometry, hover/active close, eased overflow fade */}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          overflow: "hidden",
        }}
      >
        <If when={canScrollLeft()}>
          <IconButton
            icon="chevron-left"
            size="xs"
            accessibilityLabel="scene-tabs-scroll-left"
            tooltip={tr("nav.scrollTabsLeft")}
            onPress={() => scrollTabsBy(-160)}
          />
        </If>

        <View
          onLayout={e => {
            const w = e.bounds.size.width;
            if (w > 0 && Math.abs(w - viewportWidth()) > 0.5) {
              viewportWidth.set(w);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 36,
            overflow: "hidden",
            maskImage: tabStripMask(),
          }}
        >
          <Scroll
            ref={el => scrollRef.set(el)}
            horizontal
            scrollbar={false}
            onScroll={e => {
              scrollOffset.set(e.offset.x);
              if (e.size.width > 0) viewportWidth.set(e.size.width);
              if (e.contentSize.width > 0) contentWidth.set(e.contentSize.width);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 36,
            }}
            contentStyle={{
              flexGrow: 1,
              flexDirection: "row",
              alignItems: "center",
              height: 36,
            }}
          >
            <View
              onLayout={e => {
                const w = e.bounds.size.width;
                if (w > 0 && Math.abs(w - contentWidth()) > 0.5) {
                  contentWidth.set(w);
                }
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                height: 36,
                paddingHorizontal: 2,
              }}
            >
              <Each of={openSceneTabs()} key={tab => tab}>
                {tab => (
                  <SceneTabItem
                    tab={tab()}
                    active={activeScene() === tab()}
                    closable={openSceneTabs().length > 1}
                    onRef={el => {
                      if (el) tabRefs.set(tab(), el);
                      else tabRefs.delete(tab());
                    }}
                    onSelect={() => navigateScene(tab())}
                    onClose={() => closeSceneTab(tab())}
                  />
                )}
              </Each>
            </View>
            <View
              focusable={false}
              onPressDown={handleTitlebarPressDown}
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                cursor: "default",
              }}
            />
          </Scroll>
        </View>

        <If when={canScrollRight()}>
          <IconButton
            icon="chevron-right"
            size="xs"
            accessibilityLabel="scene-tabs-scroll-right"
            tooltip={tr("nav.scrollTabsRight")}
            onPress={() => scrollTabsBy(160)}
          />
        </If>
      </View>

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
        <If when={busy()}>
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
            width: 1,
            height: 14,
            backgroundColor: palette().borderSubtle,
            flexShrink: 0,
          }}
        />

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
        {auxElement()}
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
];

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
    return searchItems().map(item => {
      if (item.kind !== "command") return item;
      const def = SEARCH_COMMANDS.find(cmd => cmd.id === item.id);
      if (!def) return item;
      return {
        ...item,
        label: tr(def.labelKey),
        detail: tr(def.detailKey),
      };
    });
  });

  const groupedRows = (kind: SearchItem["kind"]) =>
    effectiveItems().filter(item => item.kind === kind);

  const flatResults = computed<SearchItem[]>(() => {
    const all: SearchItem[] = [];
    const list = effectiveItems();
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
    if (chosen) void runSearchItem(chosen);
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
          maxWidth: 660,
          maxHeight: "100%",
          flexShrink: 1,
          minHeight: 0,
          borderRadius: radii.xl,
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
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
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
                            onPress={() => void runSearchItem(item())}
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
  void loadWorkspaces();
  void loadSavedConnections();
  void startPermissionPrompts();
  void startQuestionPrompts();

  const unsubAccountAuth = onAccountAuthChanged(signedIn => {
    if (signedIn) {
      void refreshSidebarDevices();
    } else {
      sidebarPeerDevices.set([]);
    }
  });
  cleanup(() => unsubAccountAuth());

  keymap.bind("mod+k", () => openGlobalSearch());
  keymap.bind("mod+b", () => toggleDrawer());
  keymap.bind("mod+j", () => toggleAuxPane());
  keymap.bind("mod+,", () => navigateScene("settings"));
  keymap.bind("mod+n", () => {
    void createSessionInWorkspace(tr("nav.newSession"));
    navigateScene("sessions");
  });

  return (
    <View
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
      <If when={drawerOpen()}>
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
              maxWidth: 420,
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
            onDelta={delta => setNavWidth(navWidth() + delta)}
            onReset={() => setNavWidth(DEFAULT_NAV_WIDTH)}
          />
        </View>
      </If>

      {/* Right Inset Rounded Paper Scene Surface (matches `src/web-ui` WorkspaceBody) */}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          borderTopLeftRadius: drawerOpen() ? radii.surface : 0,
          borderBottomLeftRadius: drawerOpen() ? radii.surface : 0,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderCurve: "continuous",
          borderLeftWidth: drawerOpen() ? 1 : 0,
          borderColor: palette().border,
          backgroundColor: palette().canvas,
          boxShadow: drawerOpen() ? palette().shadowSceneEdge : undefined,
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        <SceneTopBar />
        <PeerBanner />
        <ErrorBanner />

        <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" }}>
          <If when={auxPaneOpen() && auxPaneSide() === "left" && !auxPaneMaximized()}>
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

          <If when={!(auxPaneOpen() && auxPaneMaximized())}>
            <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
              {sceneElement()}
            </View>
          </If>

          <If when={auxPaneOpen() && auxPaneSide() === "right" && !auxPaneMaximized()}>
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

          <If when={auxPaneOpen() && auxPaneMaximized()}>
            <AuxPane />
          </If>
        </View>
      </View>

      <If when={searchOpen()}>
        <SearchPanel />
      </If>
      <SshWorkspaceModals />
      <AccountAuthModal />
      <ToastHost />
    </View>
  );
}

mount(App);

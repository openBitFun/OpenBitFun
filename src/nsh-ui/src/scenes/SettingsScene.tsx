import {
  cleanup,
  Clipboard,
  computed,
  context,
  effect,
  horizontalSizeClass,
  Scroll,
  signal,
  Text,
  untracked,
  View,
  type JSX,
  type ViewRef,
} from "nsh";
import { Input, TextView } from "nsh/base";
// wave22-p3: Settings › Pet (desktop pet and desktop cards)
import { Picker } from "nsh";
import { Buffer } from "buffer";
import {
  companionAvailableHere,
  companionBusy,
  companionEnabled,
  companionNotice,
  desktopCardsEnabled,
  importCompanionPetArchive,
  loadCompanionPets,
  loadCompanionSettings,
  setCompanionEnabled,
  setDesktopCardsEnabled,
} from "../companionStore";
import { PetCharacterGrid } from "../ui/companion";
import { STATIC_MARKDOWN_OPTIONS, createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { entryDeviceId, fleetActive, invokeCommand, windowShellId } from "../bridge";
import { fleetDeviceById, fleetDevices, refreshFleetNavigator } from "../fleetStore";
import { isCommandUnavailable } from "../hostCommands";
import { isRemotePeerContext } from "../shared/deviceScope";
import { errorMessageOf } from "../shared/errorUtils";
import {
  fetchUsageActivity,
  UsageActivityUnavailable,
  type UsageActivityCell,
  type UsageActivityView,
} from "../usageActivity";
import { StateMark, deviceGlyphIcon, stateColor } from "../ui/fleet";
import { AccountDevicesPage } from "./AccountDevicesPage";
import { Bar, Cell, Grid, Plot, PlotAxis } from "nsh/base/plot";
import {
  EXTERNAL_SESSION_NAMES,
  applyMcpImport,
  externalBlock,
  externalDiscoveryError,
  externalDiscoverySaving,
  externalError,
  externalLoadState,
  externalSnapshot,
  loadExternalImport,
  loadRemovedSessions,
  mcpImportBusy,
  externalMcpNotice,
  mcpImportPlan,
  mcpItemSelectable,
  mcpItemStateKey,
  mcpPlanState,
  removedRestoreBusy,
  removedRestoreFailed,
  removedSessionKey,
  removedSessions,
  removedSessionsState,
  restoreRemovedSession,
  setAutomaticDiscovery,
  syncExternalImportScope,
  type ExternalSourceRow,
  type McpImportItem,
} from "../externalImportStore";
import {
  INSIGHTS_DAY_OPTIONS,
  accountStatus,
  activeInsightsReport,
  cancelInsights,
  closeInsightsModal,
  generateInsightsReport,
  insightsDays,
  insightsError,
  insightsGenerating,
  insightsLoading,
  insightsMetas,
  insightsModalOpen,
  insightsModel,
  insightsNotice,
  insightsProgress,
  isAccountSignedIn,
  loadAccountState,
  loadLatestInsights,
  openInsightsReport,
  revealInsightsHtml,
  selectedInsightsPath,
} from "../homeStore";
import { accountDisplay } from "../accountDisplay";
import {
  ACP_PERMISSION_MODES,
  acpBusy,
  acpClients,
  acpJsonDirty,
  acpJsonNotice,
  acpJsonOpen,
  acpJsonText,
  acpNotice,
  acpProbing,
  acpProbes,
  acpRowStatus,
  acpSupported,
  closeAcpJson,
  editAcpJson,
  ensureAcp,
  installAcpClient,
  loadAcpClients,
  openAcpJson,
  probeAcpClients,
  saveAcpJson,
  setAcpPermissionMode,
  stopAcpClient,
} from "../acpStore";
import {
  CONTENT_WIDTH_STEP,
  DEFAULT_CONTENT_WIDTH,
  MIN_CONTENT_WIDTH,
  adjustContentWidth,
  contentWidth,
  contentWidthNotice,
  resetContentWidth,
} from "../contentWidthStore";
import {
  ensureRuntimeLogging,
  exportDiagnosticsBundle,
  loadRuntimeLogging,
  loggingBusy,
  loggingNotice,
  revealLogFolder,
  runtimeLogging,
} from "../diagnosticsStore";
import {
  FONT_LEVELS,
  MAX_FONT_PX,
  MIN_FONT_PX,
  adjustFontPx,
  chooseFontLevel,
  fontLevel,
  fontNotice,
  fontPx,
  resetFontPreference,
  type FontLevel,
} from "../fontPreferenceStore";
import {
  formatBytes,
  formatDate,
  formatBucket,
  formatCount,
  formatDuration,
  formatPercent,
  formatPlural,
  formatRelativeTime,
  formatTokens,
  weekdayShortLabels,
} from "../format";
import {
  SUPPORTED_LOCALES,
  currentLocale,
  localeMeta,
  localizeHostError,
  localizeQuotaWindowLabel,
  tr,
  type AppLocale,
  type MessageKey,
} from "../i18n";
import {
  closeMcpResources,
  loadMcpResources,
  mcpResourceContent,
  mcpResourceContentBusy,
  mcpResourceQuery,
  mcpResourceSelected,
  mcpResourceVisibleRows,
  mcpResourcesBusy,
  mcpResourcesLoaded,
  mcpResourcesNotice,
  mcpResourcesRows,
  mcpResourcesServer,
  openMcpResource,
  openMcpResources,
  setMcpResourceQuery,
} from "../mcpResourcesStore";
import {
  MCP_TRANSPORTS,
  cancelMcpRemoteOAuth,
  clearMcpRemoteAuth,
  closeMcpAuth,
  closeMcpDraft,
  closeMcpImport,
  closeMcpJson,
  copyMcpOAuthUrl,
  deleteMcpServer,
  enableMcpServer,
  ensureMcp,
  importMcpServers,
  loadMcpDocument,
  mcpAuthValue,
  mcpAvailable,
  mcpBusy,
  mcpDocument,
  mcpDocumentLoaded,
  mcpDraft,
  mcpImportCandidates,
  mcpImportNotice,
  mcpImportOpen,
  mcpImportText,
  mcpJsonNotice,
  mcpJsonOpen,
  mcpJsonState,
  mcpJsonText,
  mcpLoading,
  mcpNotice,
  mcpOAuthBusy,
  mcpOAuthNotice,
  mcpOAuthServer,
  mcpOAuthSession,
  mcpOAuthStatusLabel,
  mcpOAuthUrlUnopened,
  mcpServerRows,
  openMcpAuth,
  openMcpDraft,
  openMcpImport,
  openMcpJson,
  previewMcpImport,
  refreshMcpServers,
  reloadMcpForDevice,
  restartMcpServer,
  saveMcpDraft,
  saveMcpJson,
  saveMcpRemoteAuth,
  setMcpAuthValue,
  setMcpImportText,
  startMcpRemoteOAuth,
  startMcpServer,
  stopMcpServer,
  updateMcpDraft,
  updateMcpImportCandidate,
  updateMcpJson,
} from "../mcpStore";
import {
  addAllSelectedDiscoveredModels,
  closeDiscoveryPicker,
  detectModelsForConfig,
  discoveryPickerOpen,
  discoverySearchQuery,
  draftTestOutcome,
  loadSubscriptions,
  mergedDiscoveredOptions,
  modelTestOutcomes,
  openDiscoveryPicker,
  previewRequestUrl,
  quotaMeters,
  remoteDiscoveredModels,
  remoteDiscoveryError,
  remoteDiscoveryLoading,
  resetRemoteDiscovery,
  selectedDiscoveredIds,
  subscriptionAccounts,
  subscriptionQuotas,
  subscriptionsLoading,
  testDraftConnection,
  testSavedModelConnection,
  toggleDiscoveredModel,
  cancelSubscriptionSignIn,
  copySubscriptionLoginUrl,
  signOutSubscriptionAccount,
  startSubscriptionSignIn,
  subscriptionLogin,
  subscriptionSigningOut,
  type QuotaMeterRow,
  type SubscriptionQuotaSummary,
} from "../modelDiscoveryStore";
import {
  catalogProviders,
  chooseCatalogModel,
  chooseCatalogProvider,
  closeModelForm,
  closeModelLimits,
  chooseDefaultModel,
  defaultModelReferences,
  defaultModelSaving,
  defaultModels,
  defaultModelsNotice,
  deleteModel,
  isSelectableForCapability,
  loadDefaultModels,
  modelOptionDetail,
  modelOptionLabel,
  modelOptionText,
  selectableChatModels,
  type DefaultModelSlot,
  loadModels,
  MODEL_CATEGORIES,
  MODEL_FORMATS,
  modelDeletePending,
  openModelEditor,
  requestModelDelete,
  modelCatalog,
  modelCatalogLoaded,
  modelCatalogNotice,
  modelCatalogProvider,
  modelCatalogQuery,
  modelDraft,
  modelFormOpen,
  modelLimitsDraft,
  modelSettingsLoaded,
  modelSettingsNotice,
  normalizeModelFormat,
  openModelForm,
  openModelLimits,
  saveModelDraft,
  saveModelLimits,
  selectedCatalogProvider,
  setCatalogQuery,
  setModelEnabled,
  storedModels,
  updateDraft,
  updateModelLimitsDraft,
} from "../modelSettingsStore";
import {
  PERMISSION_ACTIONS,
  PERMISSION_EFFECTS,
  PERMISSION_MODES,
  addPermissionRule,
  approvalModels,
  approvalNotice,
  approvalSettings,
  beginRulesDraft,
  cancelFullAccess,
  choosePermissionMode,
  clearDecisionCredential,
  decisionCredential,
  decisionModel,
  discardRuleDraft,
  ensurePermissions,
  loadDecisionModel,
  loadPermissions,
  movePermissionRule,
  patchPermissionRule,
  pendingFullAccess,
  permissionMode,
  permissionModeControl,
  permissionRuleCount,
  permissionsNotice,
  permissionsSupported,
  removePermissionRule,
  ruleDraft,
  rulesNotice,
  saveApproval,
  saveDecisionCredential,
  saveDecisionModel,
  saveRuleDraft,
  setPermissionModeControl,
  type PermissionEffect,
  type PermissionMode,
} from "../permissionPolicyStore";
import {
  POOL_STRATEGIES,
  closePoolDraft,
  deletePool,
  ensurePools,
  loadPoolStatus,
  loadPools,
  movePoolMember,
  openPoolDraft,
  poolDraft,
  poolStatuses,
  pools,
  poolsNotice,
  poolsSupported,
  savePoolDraft,
  togglePoolMember,
  updatePoolDraft,
  type ModelPool,
} from "../poolStore";
import {
  closeQuickActionDraft,
  deleteQuickAction,
  ensureQuickActions,
  loadQuickActions,
  moveQuickAction,
  openQuickActionDraft,
  quickActionDraft,
  quickActions,
  quickActionsNotice,
  saveQuickActionDraft,
  toggleQuickAction,
  updateQuickActionDraft,
} from "../quickActionStore";
import {
  MID_TURN_POLICIES,
  chooseMidTurnSendPolicy,
  ensureSendPolicy,
  loadSendPolicy,
  midTurnSendPolicy,
  sendPolicyNotice,
  type MidTurnSendPolicy,
} from "../sendPolicyStore";
import {
  SETTINGS_SECTIONS,
  appLanguageValue,
  defaultForField,
  fieldDisplay,
  fieldEmptyLabel,
  fieldHint,
  fieldLabel,
  fieldMissing,
  fieldPlaceholder,
  fieldSaving,
  fieldUnit,
  generalControlSaving,
  generalControlValue,
  generalControlValues,
  loadGeneralControl,
  memoryActionBusy,
  memoryResetPending,
  openMemoryFolder,
  resetMemory,
  setGeneralControl,
  type GeneralControlOption,
  loadSettingsValues,
  maxForField,
  minForField,
  optionLabel,
  sectionNotice,
  sectionOfField,
  sectionTitle,
  setSectionNotice,
  settingsLoaded,
  settingsNotice,
  settingsValues,
  writeAppLanguage,
  writeField,
  type FieldSpec,
  type SettingsPageId,
} from "../settingsStore";
import { loadTerminalShells, terminalShells } from "../terminalStore";
import {
  cleanSnapshotStorage, inspectSnapshotStorage, setConfig,
  type SessionSummary, type SnapshotPeriod, type SnapshotStorageOverview,
} from "../api";
import {
  TASK_MODEL_ROWS,
  chooseTaskModel,
  ensureTaskModels,
  loadTaskModels,
  taskModels,
  taskModelsAbsent,
  taskModelsNotice,
  taskModelsSupported,
  type TaskModelChoice,
} from "../taskModelStore";
import {
  APPEARANCE_PRESETS,
  appearanceId,
  appearanceMode,
  compactLayout,
  concentricRadius,
  controlHeight,
  fontMono,
  isLightAppearance,
  layout,
  palette,
  radii,
  resolvedAppearanceId,
  resolvedScheme,
  space,
  textLineHeight,
  textSize,
  textStyle,
  textTracking,
  touchSlop,
  type AppearanceId,
} from "../theme";
import { chooseAppearancePreset, setFollowSystemAppearance } from "../themeStore";
// wave24-replica: MCP servers from the account that still need a secret here.
import { loadAccountRecords, mcpSecretsNote } from "../accountRecordsStore";
import {
  accountSync,
  accountSyncBusy,
  accountSyncCaptionShown,
  accountSyncLoad,
  accountSyncNote,
  accountSyncWriteError,
  clearAccountSyncWriteError,
  loadAccountSync,
  setAccountSyncEnabled,
} from "../accountSyncStore";
import { openAccountAuthModal } from "../ui/AccountAuthModal";
import { Icon, type IconName } from "../ui/icons";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  rotatingChevronStyle,
  Spinner,
  subtleCrossfadeMotion,
  tactileActiveStyle,
} from "../ui/motion";
import {
  DropdownMenu,
  ListRowContent,
  ModalDialog,
  SelectDropdown,
  listRowHoverBg,
  pushToast,
  type SelectDropdownOption,
} from "../ui/overlays";
// wave22-p2: the external Chrome or Edge connect status.
import { ExternalBrowserSection } from "../ui/externalBrowser";
// wave22-p5 settings parity: shortcut remapping, desktop control permissions, settings export/import.
import { keymap } from "nsh";
import { TextField } from "../ui/primitives";
import {
  effectiveKeystroke,
  keystrokeReservedHere,
  keybindingOverrides,
  keystrokeFromKeyEvent,
  loadKeybindings,
  resetAllShortcuts,
  resetShortcut,
  setShortcut,
  SHORTCUT_DEFINITIONS,
  shortcutNotice,
  shortcutRecording,
  shortcutUsing,
  type ShortcutDefinition,
} from "../shortcutsStore";
import {
  computerUseBusy,
  computerUseNotice,
  computerUseState,
  computerUseStatus,
  loadComputerUseStatus,
  openComputerUseSettings,
  requestComputerPermission,
  type ComputerPermissionRow,
} from "../computerUseStore";
import {
  closeConfigImport,
  configImportError,
  configImportName,
  configImportOpen,
  configImportText,
  configTransferBusy,
  copyConfigExport,
  importConfigText,
  openConfigImport,
  pickConfigFile,
} from "../configTransferStore";
import { deleteSessionTarget } from "../ui/sessionActions";
import {
  ActionButton,
  Badge,
  Button,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InlineDeleteConfirm,
  InlineFieldSaveGroup,
  InputBox,
  SearchInput,
  SegmentedTabs,
  StatusDot,
  ToggleSwitch,
  focusRingStyle,
} from "../ui/primitives";
import {
  activeWorkspace,
  archiveSessionRow,
  deviceContext,
  isSessionArchived,
  loadSessions,
  selectDeviceContext,
  sessionTotal,
  sessions,
} from "../state";
import {
  USAGE_DISTRIBUTIONS,
  USAGE_RANGES,
  chooseUsageDistribution,
  chooseUsageRange,
  loadUsage,
  setUsageEntryFilter,
  toggleUsageExpanded,
  usageActivity,
  usageActivityNotice,
  usageBuckets,
  usageCacheHitRate,
  usageDistribution,
  usageEndpoints,
  usageEntryFilter,
  usageExpanded,
  usageGranularity,
  usageGroups,
  usageModels,
  usageNotice,
  usageRange,
  usageTotals,
  usageUnsupported,
  usageVisibleRows,
} from "../usageStore";
import {
  WEB_SEARCH_AUTH_MODES,
  WEB_SEARCH_PROVIDERS,
  chooseSearchProvider,
  clearSearchCredential,
  credentialIdFor,
  ensureWebSearch,
  httpProvider,
  loadWebSearch,
  providerOf,
  saveSearchCredential,
  selectedProvider,
  setHttpAuth,
  setHttpEndpoint,
  setProviderCredentialId,
  webSearchCredential,
  webSearchNotice,
  type WebSearchProviderId,
} from "../webSearchStore";
import { superAgentUi } from "../productGates"; // wave23-E

/** One settings page, as the desktop's settings registry lists it. */
export interface SettingsPageEntry {
  id: SettingsPageId;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: IconName;
  /** Extra words the search matches; field labels on the page are matched too. */
  keywords: readonly string[];
  /** The sections the page draws, in order, for the navigation's anchors. */
  anchors: ReadonlyArray<{ id: string; labelKey: MessageKey }>;
  /** Drawn only in the native desktop window (the desktop pet). */
  nativeOnly?: boolean;
}

/**
 * The three scopes of Settings (visual spec §4.9): Preferences sync with the
 * account, Account is the signed-in identity, Device is the device the scope
 * chip names.
 */
export type SettingsScope = "preferences" | "account" | "device";

export interface SettingsPageGroup {
  id: SettingsScope;
  labelKey: MessageKey;
  pages: readonly SettingsPageEntry[];
}

/** The scopes and their pages, in the spec's order. */
export const SETTINGS_PAGE_GROUPS: readonly SettingsPageGroup[] = [
  {
    id: "preferences",
    labelKey: "settings.scope.preferences",
    pages: [
      {
        id: "general",
        labelKey: "settings.page.general",
        descriptionKey: "settings.page.generalDesc",
        icon: "settings",
        keywords: ["startup", "launch", "update", "sleep", "window", "notification", "language", "locale"],
        anchors: [
          { id: "general-language", labelKey: "settings.section.language" },
          { id: "general", labelKey: "settings.section.startup" },
        ],
      },
      {
        id: "appearance",
        labelKey: "settings.page.appearance",
        descriptionKey: "settings.page.appearanceDesc",
        icon: "palette",
        keywords: ["theme", "font", "size", "dark", "light", "content", "width"],
        anchors: [],
      },
      {
        id: "input",
        labelKey: "settings.page.input",
        descriptionKey: "settings.page.inputDesc",
        icon: "command",
        keywords: ["selection", "send", "queue"],
        anchors: [
          { id: "input", labelKey: "settings.section.input" },
          { id: "send-policy", labelKey: "settings.sendPolicy.title" },
        ],
      },
      {
        id: "shortcuts",
        labelKey: "settings.page.shortcuts",
        descriptionKey: "settings.page.shortcutsDesc",
        icon: "command",
        keywords: ["keyboard", "shortcut", "keybinding", "hotkey"],
        anchors: [{ id: "shortcuts", labelKey: "settings.shortcuts.title" }],
      },
      {
        id: "pet",
        labelKey: "settings.page.pet",
        descriptionKey: "settings.page.petDesc",
        icon: "bot",
        keywords: ["pet", "companion", "desktop", "cards"],
        // Listed everywhere; phones and browsers say "Desktop only" (wave22-p3).
        anchors: [],
      },
    ],
  },
  {
    id: "account",
    labelKey: "settings.scope.account",
    pages: [
      {
        id: "profile",
        labelKey: "settings.page.profile",
        descriptionKey: "settings.page.profileDesc",
        icon: "user",
        keywords: ["account", "sign in", "email", "profile"],
        anchors: [],
      },
      {
        id: "devices",
        labelKey: "settings.page.devices",
        descriptionKey: "settings.page.devicesDesc",
        icon: "smartphone",
        keywords: ["devices", "phone", "browser", "telegram", "feishu", "wechat", "bot", "chat"],
        anchors: [],
      },
      {
        id: "openbitfun",
        labelKey: "settings.page.openbitfun",
        descriptionKey: "settings.page.openbitfunDesc",
        icon: "sparkles",
        keywords: ["openbitfun", "super agent", "cloud", "agent", "conversation"],
        anchors: [],
      },
      {
        id: "activity",
        labelKey: "settings.page.activity",
        descriptionKey: "settings.page.activityDesc",
        icon: "activity",
        keywords: ["activity", "heatmap", "tokens", "insights"],
        anchors: [],
      },
    ],
  },
  {
    id: "device",
    labelKey: "settings.scope.device",
    pages: [
      {
        id: "models",
        labelKey: "settings.page.models",
        descriptionKey: "settings.page.modelsDesc",
        icon: "cpu",
        keywords: ["model", "provider", "api key", "base url", "proxy", "subscription", "pool", "default", "primary", "fast"],
        anchors: [
          { id: "default-models", labelKey: "settings.defaultModels.title" },
          { id: "models", labelKey: "settings.models.title" },
          { id: "subscriptions", labelKey: "settings.subscriptions.title" },
          { id: "pools", labelKey: "settings.pools.title" },
          { id: "network", labelKey: "settings.section.network" },
        ],
      },
      {
        id: "permissions",
        labelKey: "settings.page.permissions",
        descriptionKey: "settings.page.permissionsDesc",
        icon: "shield",
        keywords: ["permission", "approval", "rules", "allow", "deny", "full access", "openbitfun"],
        anchors: [],
      },
      {
        id: "execution",
        labelKey: "settings.page.execution",
        descriptionKey: "settings.page.executionDesc",
        icon: "play",
        keywords: ["tool", "presentation", "ptc", "timeout", "parallel", "subagent", "swarm", "quick actions", "hooks", "automation"],
        anchors: [
          { id: "quick-actions", labelKey: "settings.quickActions.title" },
          { id: "agent-hooks", labelKey: "settings.section.agentHooks" },
        ],
      },
      {
        id: "session-memory",
        labelKey: "settings.page.sessionMemory",
        descriptionKey: "settings.page.sessionMemoryDesc",
        icon: "sparkles",
        keywords: ["session", "memory", "title", "remember", "recall", "task model", "commit message"],
        anchors: [
          { id: "session", labelKey: "settings.section.session" },
          { id: "task-models", labelKey: "settings.taskModels.title" },
          { id: "memory", labelKey: "settings.section.memory" },
        ],
      },
      {
        id: "editor",
        labelKey: "settings.page.editor",
        descriptionKey: "settings.page.editorDesc",
        icon: "code",
        keywords: ["editor", "font", "indent", "minimap", "word wrap"],
        anchors: [],
      },
      {
        id: "terminal",
        labelKey: "settings.page.terminal",
        descriptionKey: "settings.page.terminalDesc",
        icon: "terminal-square",
        keywords: ["terminal", "shell", "pwsh", "powershell", "zsh", "bash", "cursor"],
        anchors: [],
      },
      {
        id: "workspace",
        labelKey: "settings.page.workspace",
        descriptionKey: "settings.page.workspaceDesc",
        icon: "git-branch",
        keywords: ["workspace", "git", "worktree", "isolation", "branch", "search", "commit"],
        anchors: [
          { id: "workspace", labelKey: "settings.section.workspace" },
          { id: "workspace-search", labelKey: "settings.section.workspaceSearch" },
          { id: "git", labelKey: "settings.section.git" },
        ],
      },
      {
        id: "mcp",
        labelKey: "settings.page.mcp",
        descriptionKey: "settings.page.mcpDesc",
        icon: "plug",
        keywords: ["mcp", "server", "tools", "oauth", "acp", "external agent", "claude code", "codex", "gemini"],
        anchors: [
          { id: "mcp", labelKey: "settings.page.mcp" },
          { id: "acp", labelKey: "settings.page.externalAgents" },
        ],
      },
      {
        id: "web-search",
        labelKey: "settings.page.webSearch",
        descriptionKey: "settings.page.webSearchDesc",
        icon: "globe",
        keywords: ["web search", "exa", "tavily", "deepseek", "keenable", "provider", "api key"],
        anchors: [],
      },
      {
        id: "desktop-control",
        labelKey: "settings.page.desktopControl",
        descriptionKey: "settings.page.desktopControlDesc",
        icon: "monitor",
        keywords: ["computer use", "browser", "desktop", "chrome", "HTTP", "token"],
        anchors: [{ id: "external-control", labelKey: "externalControl.title" }],
      },
      {
        id: "external-import",
        labelKey: "settings.page.externalImport",
        descriptionKey: "settings.page.externalImportDesc",
        icon: "download",
        keywords: ["external import", "opencode", "claude code", "codex"],
        anchors: [],
      },
      {
        id: "usage",
        labelKey: "settings.page.usage",
        descriptionKey: "settings.page.usageDesc",
        icon: "bar-chart",
        keywords: ["usage", "tokens", "cost", "statistics"],
        anchors: [],
      },
      {
        id: "storage",
        labelKey: "settings.page.storage",
        descriptionKey: "settings.page.storageDesc",
        icon: "hard-drive",
        keywords: ["storage", "disk", "snapshot", "cleanup", "space"],
        anchors: [
          { id: "snapshot-cleanup", labelKey: "storage.cleanup" },
        ],
      },
      {
        id: "archived",
        labelKey: "settings.page.archived",
        descriptionKey: "settings.page.archivedDesc",
        icon: "folder",
        keywords: ["archived", "archive", "restore", "session"],
        anchors: [],
      },
      {
        id: "diagnostics",
        labelKey: "settings.page.diagnostics",
        descriptionKey: "settings.page.diagnosticsDesc",
        icon: "activity",
        keywords: ["log", "diagnostics", "debug", "export"],
        anchors: [],
      },
    ],
  },
];

/**
 * Page ids older callers (the agent's "open this screen", the search) still
 * name: automation lives on Execution and external agents on MCP servers now.
 */
const SETTINGS_PAGE_ALIASES: Partial<Record<SettingsPageId, { pageId: SettingsPageId; anchor: string }>> = {
  automation: { pageId: "execution", anchor: "quick-actions" },
  "external-agents": { pageId: "mcp", anchor: "acp" },
};

/** The page an id draws on (an alias resolves to the page that hosts it). */
export function resolveSettingsPage(id: SettingsPageId): SettingsPageId {
  // wave23-E: Account › Super Agent is gated off (`productGates.ts`); a request for it opens Profile.
  if (id === "openbitfun" && !superAgentUi()) return "profile";
  return SETTINGS_PAGE_ALIASES[id]?.pageId ?? id;
}

const ALL_SETTINGS_PAGES: readonly SettingsPageEntry[] = SETTINGS_PAGE_GROUPS.flatMap(group => group.pages);

/** The scope a page belongs to. */
export function settingsScopeOf(id: SettingsPageId): SettingsScope {
  const resolved = resolveSettingsPage(id);
  return SETTINGS_PAGE_GROUPS.find(group => group.pages.some(page => page.id === resolved))?.id ?? "preferences";
}

function settingsPageVisible(page: SettingsPageEntry): boolean {
  if (page.id === "openbitfun" && !superAgentUi()) return false; // wave23-E: Super Agent gated off
  if (page.nativeOnly && windowShellId() !== "nsh-desktop") return false;
  if (page.id === "pet" && compactLayout() && !companionAvailableHere()) return false;
  return true;
}

/** The pages a scope lists on this window (hiding desktop-only pet on compact phones). */
export function visibleSettingsPages(group: SettingsPageGroup): readonly SettingsPageEntry[] {
  return group.pages.filter(settingsPageVisible);
}

export function settingsPageEntry(id: SettingsPageId): SettingsPageEntry {
  const resolved = resolveSettingsPage(id);
  return ALL_SETTINGS_PAGES.find(page => page.id === resolved) ?? ALL_SETTINGS_PAGES[0];
}

/** The page Settings shows; General when it opens, as on the desktop. */
export const selectedSettingsPage = signal<SettingsPageId>("general");
/** What the settings navigation's search field holds. */
export const settingsSearchQuery = signal("");

export interface SettingsSearchHit {
  /** A stable key for the row. */
  key: string;
  pageId: SettingsPageId;
  /** The text that matched: a page, a section or a field label. */
  label: string;
  /** The page it lives on, shown under a field or section hit. */
  context: string;
  /** The section to reveal once the page is open. */
  anchor?: string;
}

/**
 * Searches page names, page keywords, section titles and the label, hint and
 * keywords of every field, in the active language. A page hit comes first; a
 * field hit names the page it lives on and reveals its section.
 */
export function settingsSearchResults(): SettingsSearchHit[] {
  return settingsSearchHits();
}

/** One search per query (and language): the results list, its count and Enter read it. */
const settingsSearchHits = computed<SettingsSearchHit[]>(() => searchSettings());

function searchSettings(): SettingsSearchHit[] {
  const needle = settingsSearchQuery().trim().toLowerCase();
  if (!needle) return [];
  const matches = (...texts: Array<string | undefined>): boolean =>
    texts.some(text => (text ?? "").toLowerCase().includes(needle));
  const hits: SettingsSearchHit[] = [];
  for (const page of ALL_SETTINGS_PAGES) {
    if (!settingsPageVisible(page)) continue;
    const pageLabel = tr(page.labelKey);
    if (matches(pageLabel, tr(page.descriptionKey), ...page.keywords)) {
      hits.push({ key: `page:${page.id}`, pageId: page.id, label: pageLabel, context: tr(page.descriptionKey) });
    }
    for (const anchor of page.anchors) {
      const title = tr(anchor.labelKey);
      if (matches(title) && !matches(pageLabel)) {
        hits.push({ key: `anchor:${page.id}:${anchor.id}`, pageId: page.id, label: title, context: pageLabel, anchor: anchor.id });
      }
    }
  }
  for (const section of SETTINGS_SECTIONS) {
    const pageLabel = tr(settingsPageEntry(section.page).labelKey);
    const sectionPage = resolveSettingsPage(section.page);
    for (const field of section.fields) {
      if (matches(fieldLabel(field), fieldHint(field), ...(field.keywords ?? []))) {
        hits.push({
          key: `field:${field.id}`,
          pageId: sectionPage,
          label: fieldLabel(field),
          context: sectionTitle(section) === pageLabel ? pageLabel : `${pageLabel} · ${sectionTitle(section)}`,
          anchor: section.id,
        });
      }
    }
  }
  return hits.slice(0, 30);
}

/** Views of the sections on the open page, so the navigation can reveal one. */
const sectionAnchorRefs: Record<string, ViewRef | null> = {};
/** The section to reveal once the page that holds it has rendered. */
let pendingAnchor: string | null = null;

function registerSectionAnchor(id: string, ref: ViewRef | null): void {
  sectionAnchorRefs[id] = ref;
  if (ref && pendingAnchor === id) {
    pendingAnchor = null;
    ref.reveal({ vertical: "start" });
  }
}

/** Sub-tab active inside `Settings › Models` so providers, subscriptions, pools and network stay compact. */
type ModelsPageTab = "models" | "subscriptions" | "pools" | "network";
const modelsPageTab = signal<ModelsPageTab>("models");

function syncModelsTabForAnchor(id: string): void {
  if (id === "models" || id === "default-models") modelsPageTab.set("models");
  else if (id === "subscriptions") modelsPageTab.set("subscriptions");
  else if (id === "pools") modelsPageTab.set("pools");
  else if (id === "network") modelsPageTab.set("network");
}

/** Scrolls the open page to one of its sections. */
export function revealSettingsSection(id: string): void {
  syncModelsTabForAnchor(id);
  const ref = sectionAnchorRefs[id];
  if (ref) {
    ref.reveal({ vertical: "start" });
  } else {
    pendingAnchor = id;
  }
}

/** The page or device switch the unsaved-changes prompt is holding back. */
type PendingSettingsNavigation =
  | { kind: "page"; pageId: SettingsPageId; anchor?: string }
  | { kind: "device"; deviceId: string };

const pendingNavigation = signal<PendingSettingsNavigation | null>(null);

/** Tracks which device each device-scoped section last loaded for, and whether scope switched. */
const loadedDeviceForSection = new Map<string, string>();
let deviceScopeSwitchedInSettings = false;

function useDeviceScopedLoad(sectionKey: string, ensureInitial: () => void, reloadForDevice: () => void): void {
  effect(() => {
    const ctx = deviceContext();
    untracked(() => {
      const prev = loadedDeviceForSection.get(sectionKey);
      if (prev === undefined) {
        loadedDeviceForSection.set(sectionKey, ctx);
        if (deviceScopeSwitchedInSettings) {
          reloadForDevice();
        } else {
          ensureInitial();
        }
      } else if (prev !== ctx) {
        loadedDeviceForSection.set(sectionKey, ctx);
        reloadForDevice();
      }
    });
  });
}

/**
 * Opens a settings page. Text typed into a field and not saved yet would be lost
 * by the page change, so the change waits for Save / Discard / Keep editing.
 */
export function requestSettingsPage(requested: SettingsPageId, requestedAnchor?: string): void {
  const alias = SETTINGS_PAGE_ALIASES[requested];
  const pageId = alias?.pageId ?? requested;
  const anchor = requestedAnchor ?? alias?.anchor;
  if (pageId === selectedSettingsPage()) {
    compactPageOpen.set(true);
    if (anchor) revealSettingsSection(anchor);
    return;
  }
  if (dirtyFields().length > 0) {
    pendingNavigation.set({ kind: "page", pageId, anchor });
    return;
  }
  goToSettingsPage(pageId, anchor);
}

function goToSettingsPage(pageId: SettingsPageId, anchor?: string): void {
  pendingNavigation.set(null);
  compactPageOpen.set(true);
  selectedSettingsPage.set(pageId);
  if (anchor) revealSettingsSection(anchor);
}

/** Switches the active device scope, guarding any unsaved text drafts first. */
function requestDeviceScope(deviceId: string): void {
  if (!deviceId || deviceId === deviceContext()) return;
  if (dirtyFields().length > 0) {
    pendingNavigation.set({ kind: "device", deviceId });
    return;
  }
  applyDeviceScope(deviceId);
}

function applyDeviceScope(deviceId: string): void {
  pendingNavigation.set(null);
  drafts.set({});
  approvalDrafts.set({});
  deviceScopeSwitchedInSettings = true;
  void selectDeviceContext(deviceId);
}

function applyPendingNavigation(pending: PendingSettingsNavigation): void {
  if (pending.kind === "device") {
    applyDeviceScope(pending.deviceId);
  } else {
    goToSettingsPage(pending.pageId, pending.anchor);
  }
}

/** Opens what a search row names and clears the query. */
export function openSettingsSearchHit(hit: SettingsSearchHit): void {
  settingsSearchQuery.set("");
  requestSettingsPage(hit.pageId, hit.anchor);
}

const APPEARANCE_PRESET_KEYS: Record<AppearanceId, MessageKey> = {
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

const FONT_LEVEL_KEYS: Record<FontLevel, MessageKey> = {
  compact: "settings.appearance.fontCompact",
  small: "settings.appearance.fontSmall",
  default: "settings.appearance.fontDefault",
  medium: "settings.appearance.fontMedium",
  large: "settings.appearance.fontLarge",
  custom: "settings.appearance.fontCustom",
};

const PERMISSION_MODE_META: Record<
  PermissionMode,
  { labelKey: MessageKey; hintKey: MessageKey; icon: IconName }
> = {
  ask: {
    labelKey: "perm.ask",
    hintKey: "perm.askBody",
    icon: "shield",
  },
  auto: {
    labelKey: "settings.permissions.modeAuto",
    hintKey: "settings.permissions.modeAutoHint",
    icon: "sparkles",
  },
  full_access: {
    labelKey: "perm.full",
    hintKey: "perm.fullBody",
    icon: "zap",
  },
};

const PERMISSION_EFFECT_KEYS: Record<PermissionEffect, MessageKey> = {
  allow: "settings.permissions.effectAllow",
  ask: "settings.permissions.effectAsk",
  deny: "settings.permissions.effectDeny",
};

const MID_TURN_KEYS: Record<MidTurnSendPolicy, { labelKey: MessageKey; hintKey: MessageKey }> = {
  immediate: { labelKey: "settings.sendPolicy.steerNow", hintKey: "settings.sendPolicy.steerNowHint" },
  queue: { labelKey: "settings.sendPolicy.queue", hintKey: "settings.sendPolicy.queueHint" },
};

const WEB_SEARCH_PROVIDER_KEYS: Record<
  WebSearchProviderId,
  { labelKey: MessageKey; hintKey: MessageKey }
> = {
  exa_mcp_free: {
    labelKey: "settings.webSearch.providerExaFree",
    hintKey: "settings.webSearch.providerExaFreeHint",
  },
  exa_search_api: {
    labelKey: "settings.webSearch.providerExaApi",
    hintKey: "settings.webSearch.providerExaApiHint",
  },
  tavily: {
    labelKey: "settings.webSearch.providerTavily",
    hintKey: "settings.webSearch.providerTavilyHint",
  },
  deepseek: {
    labelKey: "settings.webSearch.providerDeepseek",
    hintKey: "settings.webSearch.providerDeepseekHint",
  },
  keenable: {
    labelKey: "settings.webSearch.providerKeenable",
    hintKey: "settings.webSearch.providerKeenableHint",
  },
  openbitfun_search_http: {
    labelKey: "settings.webSearch.providerHttp",
    hintKey: "settings.webSearch.providerHttpHint",
  },
};

const WEB_SEARCH_AUTH_KEYS: Record<string, MessageKey> = {
  none: "settings.webSearch.authNone",
  bearer: "settings.webSearch.authBearer",
  header: "settings.webSearch.authHeader",
};

const POOL_STRATEGY_KEYS: Record<string, { labelKey: MessageKey; hintKey: MessageKey }> = {
  ordered: {
    labelKey: "settings.pools.strategyOrdered",
    hintKey: "settings.pools.strategyOrderedHint",
  },
  balanced: {
    labelKey: "settings.pools.strategyBalanced",
    hintKey: "settings.pools.strategyBalancedHint",
  },
};

const TASK_MODEL_KEYS: Record<string, MessageKey> = {
  session_title: "settings.taskModels.sessionTitle",
  git_commit: "settings.taskModels.commitMessage",
};

const MODEL_CATEGORY_KEYS: Record<string, MessageKey> = {
  general_chat: "settings.models.categoryChat",
  multimodal: "settings.models.categoryMultimodal",
  speech_recognition: "settings.models.categorySpeech",
};

const TASK_MODEL_HINT_KEYS: Record<string, MessageKey> = {
  session_title: "settings.taskModels.sessionTitleHint",
  git_commit: "settings.taskModels.commitMessageHint",
};

const USAGE_RANGE_KEYS: Record<string, MessageKey> = {
  last24Hours: "settings.usage.range24h",
  today: "settings.usage.rangeToday",
  thisWeek: "settings.usage.rangeWeek",
  thisMonth: "settings.usage.rangeMonth",
  all: "settings.usage.rangeAll",
};

const USAGE_DISTRIBUTION_KEYS: Record<string, MessageKey> = {
  model: "settings.usage.byModel",
  group: "settings.usage.byGroup",
};


/** Text being typed into the automatic-approval fields, before it is saved. */
const approvalDrafts = signal<Record<string, string>>({});

const PROVIDER_FORMATS = MODEL_FORMATS;
const rowMenuId = signal<string | null>(null);
/** Whether the diagnostics bundle export is waiting for the privacy confirmation. */
const diagnosticsExportPending = signal(false);
/** The MCP server a delete is waiting to be confirmed for. */
const mcpDeletePending = signal<string | null>(null);
const rowMenuAnchors = signal<Record<string, ViewRef | null>>({});

function setRowAnchor(key: string, el: ViewRef | null): void {
  rowMenuAnchors.update(current => (current[key] === el ? current : { ...current, [key]: el }));
}

function usePresenceFlag(predicate: () => boolean): () => boolean {
  const flag = signal(predicate());
  effect(() => {
    const next = predicate();
    if (flag() !== next) flag.set(next);
  });
  return flag;
}

/** Text typed into a field and not saved yet, by field id. */
const drafts = signal<Record<string, string>>({});

/** What a field's input shows when nothing is being typed: the stored value. */
function storedInputText(spec: FieldSpec): string {
  const value = fieldDisplay(spec);
  if (value === undefined || value === null) return "";
  return String(value);
}

function draftOf(spec: FieldSpec): string {
  const typed = drafts()[spec.id];
  return typed === undefined ? storedInputText(spec) : typed;
}

/** A field whose typed text differs from what is stored. */
function fieldDirty(spec: FieldSpec): boolean {
  const typed = drafts()[spec.id];
  return typed !== undefined && typed.trim() !== storedInputText(spec).trim();
}

function setDraft(spec: FieldSpec, value: string): void {
  drafts.update(current => ({ ...current, [spec.id]: value }));
}

function clearDraft(spec: FieldSpec): void {
  drafts.update(current => {
    if (!(spec.id in current)) return current;
    const next = { ...current };
    delete next[spec.id];
    return next;
  });
}

const ALL_FIELDS: readonly FieldSpec[] = SETTINGS_SECTIONS.flatMap(section => section.fields);

/** Fields with typed, unsaved text: what the unsaved-changes prompt is about. */
function dirtyFields(): FieldSpec[] {
  return ALL_FIELDS.filter(spec => fieldDirty(spec));
}

function clampNumber(spec: FieldSpec, value: number): number {
  const min = minForField(spec) ?? Number.NEGATIVE_INFINITY;
  const max = maxForField(spec) ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** A step that moves a wide range in useful increments. */
function stepFor(spec: FieldSpec): number {
  const span = (maxForField(spec) ?? 0) - (minForField(spec) ?? 0);
  if (span >= 10000) return 100;
  if (span >= 1000) return 10;
  return 1;
}

/**
 * Saves what is typed in a field. A number is clamped to what the host accepts;
 * an empty or zero value of a field the host keeps as `Option` stores `null`.
 */
async function commitDraft(spec: FieldSpec): Promise<boolean> {
  if (!fieldDirty(spec)) {
    clearDraft(spec);
    return true;
  }
  const raw = draftOf(spec).trim();
  if (spec.kind === "number") {
    if (!raw || (spec.clearable && Number(raw) === 0)) {
      if (!spec.clearable) {
        clearDraft(spec);
        return true;
      }
      const ok = await writeField(spec, null);
      if (ok) clearDraft(spec);
      return ok;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      const section = sectionOfField(spec);
      const message = tr("settings.notice.needsNumber", { label: fieldLabel(spec) });
      if (section) setSectionNotice(section.id, message);
      return false;
    }
    const ok = await writeField(spec, clampNumber(spec, parsed));
    if (ok) clearDraft(spec);
    return ok;
  }
  const ok = await writeField(spec, raw);
  if (ok) clearDraft(spec);
  return ok;
}

/** Steps a number field and saves at once, as the desktop's steppers do. */
function stepNumber(spec: FieldSpec, direction: 1 | -1): void {
  const current = Number(fieldDisplay(spec));
  const base = Number.isFinite(current) && fieldDisplay(spec) !== null
    ? current
    : Number(defaultForField(spec) ?? minForField(spec) ?? 0);
  clearDraft(spec);
  void writeField(spec, clampNumber(spec, base + direction * stepFor(spec)));
}

/** The account's name from the backend's identity projection (`accountDisplay`). */
function signedInAccountDisplay(): string {
  return accountDisplay().identity?.displayName || tr("home.signedIn");
}

// --- Settings layout (calm inset grouped lists) -----------------------------
// Page: 680 column, 32 gutter (16 compact), 28 top, 26/600 large title.
// Sections: a 13/600 secondary header, 8 below, then one inset grouped list
// (radius 12, panelRaised, hairline borderSubtle, no shadow) whose rows are at
// least 48 tall with 0x16 padding and separators inset 16 from the left.

const SETTINGS_CONTENT_MAX = layout.settingsWidth;
const SETTINGS_ROW_MIN = 48;
const SETTINGS_ROW_INSET = space.lg;
/** The left list (visual spec §4.9): 240 wide, rows 30. */
const SETTINGS_LIST_WIDTH = layout.navMediumWidth;
const SETTINGS_LIST_ROW = controlHeight.sm + space.hair;

/** The scene's own laid-out width (used to tune list width and gutters at narrow desktop sizes). */
const settingsSceneWidth = signal(0);
/** Compact layout: the page list is shown until a page is pushed over it. */
const compactPageOpen = signal(false);

function trackSettingsWidth(event: { bounds: { size: { width: number } } }): void {
  const width = Math.round(event.bounds.size.width);
  if (width > 0 && width !== untracked(() => settingsSceneWidth())) settingsSceneWidth.set(width);
}

/** True when the window uses the compact phone list->push layout (<720px). */
export function settingsCompact(): boolean {
  return compactLayout() || horizontalSizeClass() === "compact";
}

function settingsListWidth(): number {
  const width = settingsSceneWidth();
  if (width > 0 && width < 800) return 216;
  return SETTINGS_LIST_WIDTH;
}

function settingsGutter(): number {
  if (settingsCompact()) return layout.phoneGutter;
  const width = settingsSceneWidth();
  if (width > 0 && width < 800) return space.xl;
  return layout.pageGutter;
}

/** A hairline separator inset 16 from the left, drawn over the top or bottom edge of a row. */
function RowSeparator(props: { edge: "top" | "bottom"; inset?: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: props.edge === "top" ? 0 : undefined,
        bottom: props.edge === "bottom" ? 0 : undefined,
        left: props.inset ?? SETTINGS_ROW_INSET,
        right: 0,
        height: 1,
        backgroundColor: palette().borderSubtle,
        pointerEvents: "none",
      }}
    />
  );
}

/** The row's text column: a 14 label and a 12 muted description. */
function RowText(props: { label: string; description?: string; tabular?: boolean; grow: boolean }) {
  return (
    <View
      style={{
        flexGrow: props.grow ? 1 : 0,
        flexShrink: 1,
        flexBasis: props.grow ? 180 : undefined,
        minWidth: 0,
        gap: space.hair,
      }}
    >
      <Text style={{ ...textStyle("body"), fontWeight: "500" }}>
        {props.label}
      </Text>
      <If when={props.description ?? ""}>
        {description => (
          <Text
            style={{
              ...textStyle("caption", { tabular: props.tabular }),
              lineHeight: textLineHeight(12, 1.45),
              maxWidth: 460,
            }}
          >
            {description()}
          </Text>
        )}
      </If>
    </View>
  );
}

/**
 * One row of a settings list: label and description on the left, the control
 * on the right (or under the text when `stacked`). At compact width the control
 * wraps under the text when both do not fit.
 */
function SettingsRow(props: {
  wrap?: boolean;
  label: string;
  description?: string;
  first?: boolean;
  /** Puts the control under the text instead of beside it (long lists, editors). */
  stacked?: boolean;
  children?: JSX.Element;
}) {
  return (
    <View
      style={{
        position: "relative",
        flexDirection: props.stacked ? "column" : "row",
        flexWrap: props.stacked || props.wrap === false ? undefined : "wrap",
        alignItems: props.stacked ? "stretch" : "center",
        columnGap: space.lg,
        rowGap: space.sm,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
        minHeight: SETTINGS_ROW_MIN,
        ...paintTransition(MOTION_DURATION.fast),
      }}
    >
      <If when={!props.first}>
        <RowSeparator edge="top" />
      </If>
      <RowText label={props.label} description={props.description} grow={!props.stacked} />
      <If when={Boolean(props.children)}>
        <View
          style={{
            // Stacked content takes the row's width, so a wrapping grid inside it
            // wraps; as an item of a wrapping row it would keep its one-line width.
            flexDirection: props.stacked ? "column" : "row",
            flexWrap: props.stacked ? undefined : "wrap",
            alignItems: props.stacked ? "stretch" : "center",
            justifyContent: props.stacked ? "flex-start" : "flex-end",
            flexShrink: props.stacked ? 0 : 1,
            minWidth: 0,
            maxWidth: props.stacked || settingsCompact() ? "100%" : "60%",
            marginLeft: props.stacked ? undefined : "auto",
            gap: space.sm,
          }}
        >
          {props.children}
        </View>
      </If>
    </View>
  );
}

function noticeTone(notice: string): "danger" | "warning" | "success" {
  return settingsNoticeTone(notice);
}

/** True when a section title only repeats the open page's large title. */
function repeatsPageTitle(title: string): boolean {
  return title === tr(settingsPageEntry(selectedSettingsPage()).labelKey);
}

/**
 * A section's header: its 16/600 title, the line that explains it right under
 * the title (read before the controls, not after them), and the section's own
 * actions on the right. With no title (the page title already says it) the
 * explanation and the actions share the line.
 */
function SectionHeader(props: { title: string; description?: string; extra?: JSX.Element }) {
  return (
    <View
      style={{
        flexDirection: "row",
        // On a narrow window the actions move under the explanation instead of squeezing it.
        flexWrap: "wrap",
        alignItems: props.description ? "flex-end" : "center",
        columnGap: space.md,
        rowGap: space.sm,
        minHeight: space.xl,
        marginBottom: space.md,
      }}
    >
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, gap: space.xs }}>
        <If when={props.title}>
          <Text role="header" style={textStyle("sectionTitle")}>
            {props.title}
          </Text>
        </If>
        <If when={props.description ?? ""}>
          {description => (
            <Text
              style={{
                ...textStyle("caption"),
                lineHeight: textLineHeight(12, 1.5),
                maxWidth: 600,
              }}
            >
              {description()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.extra)}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginLeft: "auto" }}>{props.extra}</View>
      </If>
    </View>
  );
}

/** An empty list inside a section: a quiet glyph tile over one line, with room around it. */
function SettingsEmptyState(props: { icon: IconName; message: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.xl,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radii.md,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette().buttonSecondaryBg,
        }}
      >
        <Icon name={props.icon} size={16} color={palette().textMuted} />
      </View>
      <Text style={{ ...textStyle("label", { color: palette().textSecondary }), textAlign: "center", maxWidth: 420 }}>
        {props.message}
      </Text>
    </View>
  );
}

/** A 12 muted line inside a page (an empty search, a filter with no rows). */
function SectionFootnote(props: { text: string }) {
  return (
    <Text
      style={{
        ...textStyle("caption"),
        marginTop: space.sm,
        paddingHorizontal: space.xs,
        maxWidth: 600,
      }}
    >
      {props.text}
    </Text>
  );
}

/**
 * The one place a settings section reports the outcome of its own load or
 * write: a banner between its header and its list, localized, in its status
 * tone. A success clears itself after a few seconds; a failure stays until it
 * is dismissed. Never drawn inside a header beside the section's controls.
 */
function SectionNoticeBanner(props: { notice: string; onDismiss?: () => void }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  effect(() => {
    const notice = props.notice;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (notice && noticeTone(notice) === "success" && props.onDismiss) {
      const dismiss = props.onDismiss;
      timer = setTimeout(() => {
        timer = null;
        dismiss();
      }, 4500);
    }
  });
  cleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });
  return (
    <If when={props.notice}>
      {notice => (
        <View style={{ marginBottom: space.sm }}>
          <InlineBanner tone={noticeTone(notice())} message={localizeHostError(notice())} onDismiss={props.onDismiss} />
        </View>
      )}
    </If>
  );
}

/** A row's trailing value: 13 secondary, tabular. */
function RowValue(props: { text: string }) {
  return (
    <Text
      style={{
        ...textStyle("label", { color: palette().textSecondary, tabular: true }),
        fontWeight: "400",
        numberOfLines: 1,
        textOverflow: "ellipsis",
      }}
    >
      {props.text}
    </Text>
  );
}

/** The inset grouped list surface: radius 12, panelRaised, one hairline, no shadow. */
function insetGroupStyle(padding = 0) {
  return {
    borderRadius: radii.lg,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: palette().borderSubtle,
    backgroundColor: palette().panelRaised,
    padding,
    overflow: "hidden" as const,
    minWidth: 0,
  };
}

/**
 * A titled settings list. Its own notice is drawn under the title, so the
 * outcome of a write shows beside the section that made it; a success clears
 * itself after a few seconds, a failure stays until it is dismissed.
 */
function SettingsGroup(props: {
  id: string;
  title: string;
  /** The page title already says it (a page with one section): draw no header. */
  hideTitle?: boolean;
  description?: string;
  notice?: string;
  onDismissNotice?: () => void;
  extra?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <View ref={el => registerSectionAnchor(props.id, el)} style={{ minWidth: 0 }}>
      <If when={!props.hideTitle || Boolean(props.extra) || Boolean(props.description)}>
        <SectionHeader
          title={props.hideTitle ? "" : props.title}
          description={props.description}
          extra={props.extra}
        />
      </If>
      <SectionNoticeBanner notice={props.notice ?? ""} onDismiss={props.onDismissNotice} />
      <View style={insetGroupStyle()}>{props.children}</View>
    </View>
  );
}

const SettingsInsetContext = context<number>(0);

/**
 * A section drawn by its own component (permissions, MCP, usage, ...): the same
 * header and inset list as `SettingsGroup`, with an optional inner padding for
 * freeform content. `SettingsConfigRow`s inside reach the list's edges.
 */
function SettingsSection(props: {
  title: string;
  subtitle?: string;
  extra?: JSX.Element;
  /** The outcome of this section's own load or write (`SectionNoticeBanner`). */
  notice?: string;
  onDismissNotice?: () => void;
  bodyPadding?: number;
  flush?: boolean;
  children?: JSX.Element;
}) {
  const inset = (): number => (props.flush ? 0 : (props.bodyPadding ?? 16));
  return (
    <View style={{ minWidth: 0 }}>
      <If when={!repeatsPageTitle(props.title) || Boolean(props.extra) || Boolean(props.subtitle)}>
        <SectionHeader
          title={repeatsPageTitle(props.title) ? "" : props.title}
          description={props.subtitle}
          extra={props.extra}
        />
      </If>
      <SectionNoticeBanner notice={props.notice ?? ""} onDismiss={props.onDismissNotice} />
      <View style={insetGroupStyle(inset())}>
        <SettingsInsetContext.Provider value={inset()}>{props.children}</SettingsInsetContext.Provider>
      </View>
    </View>
  );
}

/** A row inside a `SettingsSection`: the list row geometry with explicit dividers. */
function SettingsConfigRow(props: {
  label: string;
  description?: string;
  /** Bottom hairline (default `true`); pass `false` on the last row. */
  divider?: boolean;
  topDivider?: boolean;
  controlWidth?: number;
  controlAlign?: "end" | "stretch";
  descriptionTabular?: boolean;
  children?: JSX.Element;
}) {
  const stretch = (): boolean => props.controlAlign === "stretch";
  return (
    <View
      style={{
        position: "relative",
        marginHorizontal: -SettingsInsetContext(),
        minHeight: SETTINGS_ROW_MIN,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: space.lg,
        rowGap: space.sm,
      }}
    >
      <If when={Boolean(props.topDivider)}>
        <RowSeparator edge="top" />
      </If>
      <RowText label={props.label} description={props.description} tabular={props.descriptionTabular} grow={true} />
      <If when={Boolean(props.children)}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: stretch() ? "flex-start" : "flex-end",
            flexShrink: 1,
            minWidth: 0,
            marginLeft: "auto",
            width: settingsCompact() ? undefined : props.controlWidth,
            maxWidth: "100%",
            gap: space.sm,
          }}
        >
          {props.children}
        </View>
      </If>
      <If when={props.divider !== false}>
        <RowSeparator edge="bottom" />
      </If>
    </View>
  );
}

/**
 * The real Save button beside a field, shown once the typed text differs from
 * what is stored. It answers to `Save <label>` and to `<field id>-save`.
 */
function RowSaveButton(props: { spec: FieldSpec; onPress: () => void }) {
  const spec = props.spec;
  return (
    <View
      role="button"
      testID={`${spec.id}-save`}
      accessibilityLabel={tr("settings.field.saveField", { label: fieldLabel(spec) })}
      disabled={fieldSaving(spec)}
      hitSlop={touchSlop(controlHeight.sm)}
      onPress={props.onPress}
      style={{
        minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
        paddingHorizontal: space.md,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: palette().actionPrimaryBg,
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().actionPrimaryHover }}
      activeStyle={tactileActiveStyle()}
      focusVisibleStyle={focusRingStyle()}
    >
      <If when={fieldSaving(spec)}>
        <Spinner size={11} color={palette().actionPrimaryFg} />
      </If>
      <Text
        style={{
          ...textStyle("caption", { color: palette().actionPrimaryFg }),
          fontWeight: "600",
        }}
      >
        {tr("settings.field.saveShort")}
      </Text>
    </View>
  );
}

function fieldOptions(spec: FieldSpec) {
  return spec.dynamicOptions ? spec.dynamicOptions() : (spec.options ?? []);
}

/** Whether a choice list is short enough for a segmented control. */
function segmentedFits(spec: FieldSpec): boolean {
  if (spec.dynamicOptions) return false;
  const options = fieldOptions(spec);
  return options.length <= 3 && options.every(option => optionLabel(option).length <= 12);
}

function ChoiceControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const current = () => String(fieldDisplay(spec) ?? "") || (spec.emptyMeans ?? "");
  const options = () =>
    fieldOptions(spec).map(option => ({
      value: option.value,
      label: optionLabel(option),
      accessibilityLabel: `${spec.id}-${option.value}`,
    }));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: "100%" }}>
      <If when={fieldSaving(spec)}>
        <Spinner size={12} color={palette().accent} />
      </If>
      <If when={segmentedFits(spec)}>
        <SegmentedTabs size="sm" value={current()} options={options()} onChange={value => void writeField(spec, value)} />
      </If>
      <If when={!segmentedFits(spec)}>
        <SelectDropdown
          size="sm"
          value={current()}
          options={options()}
          accessibilityLabel={spec.id}
          disabled={fieldSaving(spec)}
          minWidth={NUMBER_STEPPER_WIDTH}
          maxWidth={settingsCompact() ? undefined : 280}
          align="end"
          onChange={value => void writeField(spec, value)}
        />
      </If>
    </View>
  );
}

/**
 * A configured-model field: follow (null), the two roles, or one of the
 * enabled chat models by `name · model`. An id the host no longer configures is
 * kept visible as such instead of reading as "follow".
 */
function ModelChoiceControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const current = (): string => {
    const value = fieldDisplay(spec);
    return value === undefined || value === null ? "" : String(value);
  };
  const options = () => {
    const rows: Array<{ value: string; label: string; description?: string; accessibilityLabel: string }> = [
      {
        value: "",
        label: fieldEmptyLabel(spec) ?? tr("settings.field.followSessionModel"),
        accessibilityLabel: `${spec.id}-inherit`,
      },
      { value: "primary", label: tr("settings.field.primaryRole"), accessibilityLabel: `${spec.id}-primary` },
      { value: "fast", label: tr("settings.field.fastRole"), accessibilityLabel: `${spec.id}-fast` },
      ...selectableChatModels().map(model => ({
        value: model.id,
        label: modelOptionText(model),
        accessibilityLabel: `${spec.id}-${model.id}`,
      })),
    ];
    const selected = current();
    if (selected && !rows.some(row => row.value === selected)) {
      rows.push({
        value: selected,
        label: tr("settings.field.notConfiguredSuffix", { name: selected }),
        accessibilityLabel: `${spec.id}-${selected}`,
      });
    }
    return rows;
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: "100%" }}>
      <If when={fieldSaving(spec)}>
        <Spinner size={12} color={palette().accent} />
      </If>
      <SelectDropdown
        size="sm"
        value={current()}
        options={options()}
        searchable={options().length > 8}
        accessibilityLabel={spec.id}
        disabled={fieldSaving(spec)}
        minWidth={settingsCompact() ? NUMBER_STEPPER_WIDTH : 220}
        maxWidth={settingsCompact() ? undefined : 300}
        align="end"
        onChange={value => void writeField(spec, value || null)}
      />
    </View>
  );
}

/**
 * Every number row's stepper has this width, so the boxes of all number rows
 * share one right-aligned column and their values line up.
 */
/** Same width as a settings select, so steppers and selects share one right rail. */
const NUMBER_STEPPER_WIDTH = 200;

/**
 * The one number control of the settings pages: `−` value unit `+` in a box of
 * fixed width flush with the row's right edge. Editable when `onChangeText` is
 * given (Return saves). The empty value shows `placeholder`: the backend's
 * default, or what an empty value means ("No limit"). `leading` (a spinner,
 * Save, Reset, No limit) sits left of the box, so it never moves the column.
 */
function SettingsNumberStepper(props: {
  /** Accessibility base: the value is `id`, the buttons `id-decrease` / `id-increase`. */
  id: string;
  text: string;
  placeholder?: string;
  unit?: string;
  dirty?: boolean;
  readonly?: boolean;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onChangeText?: (value: string) => void;
  onSubmit?: () => void;
  leading?: JSX.Element;
}) {
  const editable = (): boolean => Boolean(props.onChangeText) && !props.readonly;
  const stepButton = () => ({
    width: compactLayout() ? 36 : controlHeight.xs,
    minHeight: compactLayout() ? 36 : controlHeight.xs,
    paddingHorizontal: 0,
  });
  const valueStyle = () => ({
    ...textStyle("label", { color: palette().text, tabular: true }),
    fontWeight: "600" as const,
  });
  const unit = (): string => props.unit ?? "";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm, maxWidth: "100%" }}>
      {props.leading}
      <View
        style={{
          boxSizing: "border-box",
          width: NUMBER_STEPPER_WIDTH,
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
          flexDirection: "row",
          alignItems: "center",
          padding: space.hair,
          gap: space.hair,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: props.dirty ? palette().accent : palette().borderSubtle,
          backgroundColor: palette().inputBg,
          flexShrink: 0,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        focusWithinStyle={{ borderColor: palette().fieldFocusBorder }}
      >
        <ActionButton
          label="−"
          variant="ghost"
          size="xs"
          accessibilityLabel={`${props.id}-decrease`}
          disabled={props.decreaseDisabled}
          style={stepButton()}
          onPress={props.onDecrease}
        />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs }}>
          <If when={editable()}>
            <Input
              value={props.text}
              accessibilityLabel={props.id}
              placeholder={props.placeholder ?? ""}
              keyboardType="number-pad"
              onChange={event => props.onChangeText?.(event.value)}
              onSubmit={() => props.onSubmit?.()}
              style={{
                ...valueStyle(),
                flex: 1,
                minWidth: 0,
                minHeight: compactLayout() ? 36 : controlHeight.xs,
                paddingHorizontal: 0,
                textAlign: unit() ? "right" : "center",
                placeholderColor: palette().textMuted,
                caretColor: palette().accent,
                fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(13),
                backgroundColor: "transparent",
                borderWidth: 0,
              }}
            />
          </If>
          <If when={!editable()}>
            <Text
              accessibilityLabel={props.id}
              style={{
                ...valueStyle(),
                color: props.text ? palette().text : palette().textMuted,
                flex: unit() ? 1 : undefined,
                textAlign: unit() ? "right" : "center",
                numberOfLines: 1,
              }}
            >
              {props.text || props.placeholder || ""}
            </Text>
          </If>
          <If when={unit()}>
            {value => (
              <Text style={{ ...textStyle("caption", { tabular: true }), flex: 1, minWidth: 0, numberOfLines: 1 }}>
                {value()}
              </Text>
            )}
          </If>
        </View>
        <ActionButton
          label="+"
          variant="ghost"
          size="xs"
          accessibilityLabel={`${props.id}-increase`}
          disabled={props.increaseDisabled}
          style={stepButton()}
          onPress={props.onIncrease}
        />
      </View>
    </View>
  );
}

/** A quiet icon button left of a number box (reset to the default, remove the limit); the tooltip names it. */
function StepperAccessory(props: { icon: IconName; tooltip: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <IconButton
      icon={props.icon}
      size="sm"
      tooltip={props.tooltip}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
    />
  );
}

/**
 * A number field: `−` / `+` step and save at once (clamped), and the value can
 * also be typed — Return or the Save that appears beside it saves the typed
 * value. Empty shows the backend's default (`get_settings_schema`), or "No
 * limit" for a value the host keeps as `Option` and holds unset; such a value
 * can be set back to no limit, any other back to the backend's default.
 */
function NumberControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const unavailable = () => fieldMissing(spec) && defaultForField(spec) === undefined && !spec.clearable;
  const value = (): number | null => {
    const raw = fieldDisplay(spec);
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const backendDefault = (): number | null => {
    const fallback = defaultForField(spec);
    return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : null;
  };
  /** An `Option` value held unset: the host applies no limit. */
  const noLimit = (): boolean => spec.clearable === true && value() === null;
  const placeholder = (): string => {
    if (noLimit()) return tr("settings.placeholder.noLimit");
    const fallback = backendDefault();
    return fallback !== null ? String(fallback) : fieldPlaceholder(spec);
  };
  const showsUnit = (): boolean => !(noLimit() && draftOf(spec).trim() === "");
  const min = () => minForField(spec);
  const max = () => maxForField(spec);
  const resettable = (): boolean => {
    const fallback = backendDefault();
    return !spec.clearable && fallback !== null && value() !== null && value() !== fallback;
  };
  return (
    <SettingsNumberStepper
      id={spec.id}
      text={draftOf(spec)}
      placeholder={placeholder()}
      unit={showsUnit() ? fieldUnit(spec) : undefined}
      dirty={fieldDirty(spec)}
      readonly={unavailable()}
      decreaseDisabled={unavailable() || fieldSaving(spec) || (value() !== null && value()! <= (min() ?? Number.NEGATIVE_INFINITY))}
      increaseDisabled={unavailable() || fieldSaving(spec) || (value() !== null && max() !== undefined && value()! >= max()!)}
      onDecrease={() => stepNumber(spec, -1)}
      onIncrease={() => stepNumber(spec, 1)}
      onChangeText={text => setDraft(spec, text)}
      onSubmit={() => void commitDraft(spec)}
      leading={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <If when={fieldSaving(spec)}>
            <Spinner size={12} color={palette().accent} />
          </If>
          <If when={fieldDirty(spec)}>
            <RowSaveButton spec={spec} onPress={() => void commitDraft(spec)} />
          </If>
          <If when={!fieldDirty(spec) && spec.clearable === true && value() !== null}>
            <StepperAccessory
              icon="close"
              tooltip={tr("settings.field.clearLimit")}
              accessibilityLabel={`${spec.id}-clear`}
              onPress={() => void writeField(spec, null)}
            />
          </If>
          <If when={!fieldDirty(spec) && resettable()}>
            <StepperAccessory
              icon="undo"
              tooltip={tr("settings.field.resetToDefault", { value: String(backendDefault() ?? "") })}
              accessibilityLabel={`${spec.id}-reset`}
              onPress={() => void writeField(spec, backendDefault())}
            />
          </If>
        </View>
      }
    />
  );
}

/** A text field prefilled with what is stored; Save appears once it differs. */
function TextControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const unavailable = () => fieldMissing(spec) && defaultForField(spec) === undefined;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        width: settingsCompact() ? "100%" : 300,
        flexShrink: 1,
        maxWidth: "100%",
      }}
    >
      <InputBox
        size="sm"
        value={draftOf(spec)}
        placeholder={unavailable() ? tr("common.unavailable").toLowerCase() : fieldPlaceholder(spec)}
        masked={spec.masked === true}
        readonly={unavailable()}
        disabled={unavailable()}
        accessibilityLabel={spec.id}
        style={{ flex: 1, minWidth: 0 }}
        onChange={value => setDraft(spec, value)}
        onSubmit={() => void commitDraft(spec)}
      />
      <If when={fieldDirty(spec)}>
        <RowSaveButton spec={spec} onPress={() => void commitDraft(spec)} />
      </If>
    </View>
  );
}

function fieldDescription(spec: FieldSpec): string {
  return fieldHint(spec) ?? "";
}

/** Fields the desktop sets through product control, which also applies them on the host. */
const GENERAL_CONTROL_FOR: Record<string, GeneralControlOption> = {
  "auto-update": "auto-update",
  "prevent-sleep": "prevent-sleep",
};

function FieldRow(props: { spec: FieldSpec; first?: boolean }) {
  const spec = props.spec;
  const control = GENERAL_CONTROL_FOR[spec.id];
  const controlled = (): boolean => Boolean(control) && generalControlValue(control) !== undefined;
  const checked = (): boolean => (controlled() ? generalControlValue(control) === true : fieldDisplay(spec) === true);
  const saving = (): boolean => fieldSaving(spec) || (Boolean(control) && generalControlSaving() === control);
  const description = (): string => (controlled() ? (fieldHint(spec) ?? "") : fieldDescription(spec));
  return (
    <SettingsRow label={fieldLabel(spec)} description={description()} first={props.first}>
      <If when={spec.kind === "boolean"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={saving()}>
            <Spinner size={12} color={palette().accent} />
          </If>
          <ToggleSwitch
            value={checked()}
            accessibilityLabel={spec.id}
            disabled={saving()}
            onChange={next => void (controlled() ? setGeneralControl(control, next) : writeField(spec, next))}
          />
        </View>
      </If>
      <If when={spec.kind === "select"}>
        <ChoiceControl spec={spec} />
      </If>
      <If when={spec.kind === "model"}>
        <ModelChoiceControl spec={spec} />
      </If>
      <If when={spec.kind === "number"}>
        <NumberControl spec={spec} />
      </If>
      <If when={spec.kind === "text"}>
        <TextControl spec={spec} />
      </If>
    </SettingsRow>
  );
}

/** A field section from the table, drawn as one card with its own notice. */
function FieldSection(props: { sectionId: string; children?: JSX.Element; leading?: JSX.Element }) {
  const section = SETTINGS_SECTIONS.find(entry => entry.id === props.sectionId);
  if (!section) return null;
  const hasLeading = Boolean(props.leading);
  return (
    <SettingsGroup
      id={section.id}
      title={sectionTitle(section)}
      hideTitle={sectionTitle(section) === tr(settingsPageEntry(section.page).labelKey)}
      notice={sectionNotice(section.id)}
      onDismissNotice={() => setSectionNotice(section.id, "")}
    >
      {props.leading}
      <Each of={section.fields} key={field => field.id}>
        {(field, index) => <FieldRow spec={field()} first={!hasLeading && index() === 0} />}
      </Each>
      {props.children}
    </SettingsGroup>
  );
}

function matchesNoticeTemplate(text: string, templateKey: MessageKey, placeholder: string): boolean {
  const sentinel = "\u0000";
  const rendered = tr(templateKey, { [placeholder]: sentinel });
  const idx = rendered.indexOf(sentinel);
  if (idx < 0) return text === rendered;
  const prefix = rendered.slice(0, idx);
  const suffix = rendered.slice(idx + sentinel.length);
  return text.length >= prefix.length + suffix.length && text.startsWith(prefix) && text.endsWith(suffix);
}

function settingsNoticeTone(notice: string): "danger" | "warning" | "success" {
  if (
    notice === tr("settings.memory.resetDone") ||
    matchesNoticeTemplate(notice, "settings.notice.savedField", "label") ||
    matchesNoticeTemplate(notice, "settings.notice.languageSaved", "label")
  ) {
    return "success";
  }
  if (
    notice === tr("settings.notice.memoryWindowRefusal") ||
    notice === tr("settings.notice.hostUpdateRequired") ||
    notice === tr("settings.permissions.timeoutValidation") ||
    matchesNoticeTemplate(notice, "settings.notice.needsNumber", "label")
  ) {
    return "danger";
  }
  if (notice === tr("settings.notice.languageNotPersisted")) {
    return "warning";
  }
  const lower = notice.toLowerCase();
  if (
    lower.includes("needs a number") ||
    lower.includes("cannot") ||
    lower.includes("failed") ||
    lower.includes("error") ||
    lower.includes("invalid") ||
    lower.includes("refused") ||
    lower.includes("at most") ||
    lower.includes("must be")
  ) {
    return "danger";
  }
  if (lower.includes("warning") || lower.includes("unavailable")) {
    return "warning";
  }
  return "success";
}

/** Calm bordered toggle button used for inline option selectors in Settings editors. */
function SelectableChip(props: {
  label: string;
  active: boolean;
  tone?: "accent" | "warning" | "danger";
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const activeBg = (): string => {
    if (!props.active) return "transparent";
    if (props.tone === "danger") return palette().dangerSoft;
    if (props.tone === "warning") return palette().warningSoft;
    return palette().accentSoft;
  };
  const activeBorder = (): string => {
    if (!props.active) return palette().borderSubtle;
    if (props.tone === "danger") return palette().dangerBorder;
    if (props.tone === "warning") return palette().warningBorder;
    return palette().accentBorder;
  };
  const activeColor = (): string => {
    if (!props.active) return palette().textSecondary;
    if (props.tone === "danger") return stateColor("failed");
    if (props.tone === "warning") return stateColor("needs_you");
    return palette().text;
  };
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ selected: props.active }}
      hitSlop={touchSlop(controlHeight.sm)}
      onPress={props.onPress}
      style={{
        minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: activeBorder(),
        backgroundColor: activeBg(),
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.active ? activeBg() : palette().surfaceSubtle }}
      activeStyle={tactileActiveStyle(0.98)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{
          ...textStyle("caption"),
          color: activeColor(),
          fontWeight: props.active ? "600" : "500",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function poolMemberTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status.trim().toLowerCase();
  if (s === "healthy" || s === "available" || s === "ready" || s === "ok" || s === "active") {
    return "success";
  }
  if (s.includes("cool") || s.includes("degrad") || s.includes("rate") || s.includes("throt") || s === "busy") {
    return "warning";
  }
  if (s.includes("fail") || s.includes("err") || s.includes("unavail") || s.includes("unhealthy") || s === "disabled") {
    return "danger";
  }
  return "neutral";
}

function formatResetAt(raw: string | number): string {
  const text = String(raw).trim();
  if (!text) return "";
  const isIso = /^\d{4}-\d{2}-\d{2}T/.test(text);
  const numeric = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  const isEpoch = Number.isFinite(numeric) && numeric >= 1_000_000_000;
  if (!isIso && !isEpoch) {
    return tr("settings.subscriptions.resetsAt", { time: text });
  }
  const ms = isEpoch ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : Date.parse(text);
  if (!Number.isFinite(ms)) {
    return tr("settings.subscriptions.resetsAt", { time: text });
  }
  const diffMs = ms - Date.now();
  if (diffMs > 0 && diffMs < 48 * 3_600_000) {
    if (diffMs < 60_000) return tr("settings.subscriptions.resetsSoon");
    // Strict carry policy via `formatDuration`: rounds seconds/minutes cleanly so `1h 60m` never renders.
    const formatted = formatDuration(Math.round(diffMs / 60_000) * 60_000);
    return tr("settings.subscriptions.resetsIn", { time: formatted });
  }
  const d = new Date(ms);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return tr("settings.subscriptions.resetsAt", { time: stamp });
}

/** A choice drawn as a list row with a trailing check when it is the current one. */
function ChoiceRow(props: {
  label: string;
  detail?: string;
  icon?: IconName;
  selected: boolean;
  /** The check and label take the warning color (a risky choice). */
  warning?: boolean;
  first: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.selected, disabled: Boolean(props.disabled) }}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={{
        position: "relative",
        minHeight: SETTINGS_ROW_MIN,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        cursor: props.disabled ? undefined : "pointer",
        userSelect: "none",
        opacity: props.disabled ? 0.5 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: palette().panelHover }}
      activeStyle={props.disabled ? undefined : tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <If when={!props.first}>
        <RowSeparator edge="top" inset={props.icon ? 44 : SETTINGS_ROW_INSET} />
      </If>
      {/* Glyph and check sit on the label line; the detail hangs under the label. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <If when={props.icon ?? ""}>
          {icon => (
            <View style={{ height: settingsRowLabelLineHeight(), flexShrink: 0, justifyContent: "center" }}>
              <Icon
                name={icon() as IconName}
                size={16}
                color={props.selected && props.warning ? stateColor("needs_you") : palette().textMuted}
              />
            </View>
          )}
        </If>
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <Text
            style={{
              ...textStyle("body", {
                color: props.selected && props.warning ? stateColor("needs_you") : palette().text,
              }),
              fontWeight: props.selected ? "500" : "400",
            }}
          >
            {props.label}
          </Text>
          <If when={props.detail ?? ""}>
            {detail => (
              <Text style={textStyle("caption")}>
                {detail()}
              </Text>
            )}
          </If>
        </View>
        <View style={{ width: 16, height: settingsRowLabelLineHeight(), alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <If when={props.selected}>
            <Icon name="check" size={14} color={props.warning ? stateColor("needs_you") : palette().accent} />
          </If>
        </View>
      </View>
    </View>
  );
}

/** Line height of a settings row's label (`body`); glyphs and the check centre on it. */
function settingsRowLabelLineHeight(): number {
  return textStyle("body").lineHeight as number;
}

function PermissionsSection() {
  useDeviceScopedLoad("permissions", ensurePermissions, () => {
    void loadPermissions();
    void loadDecisionModel();
  });
  const rulesModalOpen = usePresenceFlag(() => ruleDraft() !== null);
  const modeLabel = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].labelKey);
  const modeHint = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].hintKey);

  return (
    <If when={permissionsSupported() !== false}>
      <View style={{ gap: layout.sectionGap }}>
        <SettingsSection
          title={tr("settings.permissions.title")}
          flush={true}
          subtitle={
            permissionMode() === null ? tr("settings.permissions.reading") : tr("settings.permissions.modeIntro")
          }
          notice={permissionsNotice()}
          onDismissNotice={() => permissionsNotice.set("")}
        >
          <Each of={PERMISSION_MODES} key={entry => entry.value}>
            {(entry, index) => (
              <ChoiceRow
                label={modeLabel(entry().value)}
                detail={modeHint(entry().value)}
                icon={PERMISSION_MODE_META[entry().value].icon}
                selected={permissionMode() === entry().value}
                first={index() === 0}
                accessibilityLabel={`permission-mode-${entry().value}`}
                onPress={() => void choosePermissionMode(entry().value)}
              />
            )}
          </Each>
          <If when={pendingFullAccess()}>
            <View
              style={{
                position: "relative",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
                minHeight: SETTINGS_ROW_MIN,
              }}
            >
              <RowSeparator edge="top" />
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, flex: 1, minWidth: 200 }}>
                <View style={{ flexShrink: 0, marginTop: space.hair }}>
                  <Icon name="info" size={14} color={palette().textSecondary} />
                </View>
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().textSecondary }),
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {tr("settings.permissions.fullAccessWarning")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 0, gap: space.sm, marginLeft: "auto" }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="cancel-full-access"
                  onPress={() => cancelFullAccess()}
                />
                <Button
                  label={tr("settings.permissions.allowEverything")}
                  variant="primary"
                  size="sm"
                  accessibilityLabel="confirm-full-access"
                  onPress={() => void choosePermissionMode("full_access")}
                />
              </View>
            </View>
          </If>
        </SettingsSection>

        <SettingsSection title={tr("settings.polish.globalRules")} flush={true}>
          <SettingsConfigRow
            label={tr("settings.permissions.globalRulesTitle")}
            description={formatPlural(
              permissionRuleCount(),
              "settings.permissions.rulesInForceOne",
              "settings.permissions.rulesInForceOther",
            )}
            divider={permissionModeControl() !== null}
            descriptionTabular={true}
          >
            <Button
              label={tr("settings.permissions.editRules")}
              variant="secondary"
              size="sm"
              accessibilityLabel="edit-permission-rules"
              onPress={() => beginRulesDraft()}
            />
          </SettingsConfigRow>
          <If when={permissionModeControl() !== null}>
            <SettingsConfigRow
              label={
                permissionModeControl() === true
                  ? tr("settings.permissions.composerSwitchOn")
                  : tr("settings.permissions.composerSwitchOff")
              }
              description={tr("settings.permissions.composerSwitchHint")}
              divider={false}
            >
              <ToggleSwitch
                value={permissionModeControl() === true}
                accessibilityLabel="permission-mode-control"
                onChange={next => void setPermissionModeControl(next)}
              />
            </SettingsConfigRow>
          </If>
        </SettingsSection>

        <ModalDialog
          open={rulesModalOpen()}
          title={tr("settings.permissions.globalRulesTitle")}
          subtitle={tr("settings.permissions.globalRulesHint")}
          size="lg"
          accessibilityLabel="permission-rules-modal"
          onClose={() => discardRuleDraft()}
          footer={
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
              <Button
                label={tr("settings.permissions.addRule")}
                variant="secondary"
                size="md"
                leadingIcon="plus"
                accessibilityLabel="add-permission-rule"
                onPress={() => addPermissionRule()}
              />
              <Text
                style={{
                  ...textStyle("caption"),
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {localizeHostError(rulesNotice())}
              </Text>
              <Button
                label={tr("common.discardChanges")}
                variant="ghost"
                size="md"
                accessibilityLabel="discard-permission-rules"
                onPress={() => discardRuleDraft()}
              />
              <Button
                label={tr("settings.permissions.saveRules")}
                variant="primary"
                size="md"
                accessibilityLabel="save-permission-rules"
                onPress={() => void saveRuleDraft()}
              />
            </View>
          }
        >
          <If when={ruleDraft() !== null}>
            <View style={{ gap: space.md }}>
              <View
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text style={textStyle("mono", { color: palette().textMuted })}>
                  {tr("settings.permissions.validActions", {
                    actions: PERMISSION_ACTIONS.join(" · "),
                  })}
                </Text>
              </View>
              <If when={(ruleDraft() ?? []).length === 0}>
                <Text style={textStyle("caption")}>
                  {tr("settings.permissions.noCustomRules")}
                </Text>
              </If>
              <Each of={ruleDraft() ?? []} key={rule => rule.localId}>
                {(rule, index) => (
                  <View
                    style={{
                      gap: space.md,
                      paddingTop: index() === 0 ? space.xs : space.md,
                      paddingBottom: space.hair,
                      borderTopWidth: index() === 0 ? 0 : 1,
                      borderColor: palette().borderSubtle,
                    }}
                  >
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
                      <Badge label={`#${index() + 1}`} tone="neutral" />
                      <Each of={PERMISSION_EFFECTS} key={effect => effect.value}>
                        {effect => (
                          <SelectableChip
                            label={tr(PERMISSION_EFFECT_KEYS[effect().value])}
                            active={rule().effect === effect().value}
                            tone={
                              rule().effect === effect().value
                                ? effect().value === "deny"
                                  ? "danger"
                                  : effect().value === "allow"
                                    ? "accent"
                                    : "warning"
                                : undefined
                            }
                            accessibilityLabel={`permission-rule-${rule().localId}-effect-${effect().value}`}
                            onPress={() => patchPermissionRule(rule().localId, { effect: effect().value })}
                          />
                        )}
                      </Each>
                      <View style={{ flex: 1 }} />
                      <IconButton
                        icon="arrow-up"
                        size="xs"
                        tooltip={tr("common.up")}
                        disabled={index() === 0}
                        accessibilityLabel={`permission-rule-${rule().localId}-up`}
                        onPress={() => movePermissionRule(rule().localId, -1)}
                      />
                      <IconButton
                        icon="chevron-down"
                        size="xs"
                        tooltip={tr("common.down")}
                        disabled={index() >= (ruleDraft()?.length ?? 1) - 1}
                        accessibilityLabel={`permission-rule-${rule().localId}-down`}
                        onPress={() => movePermissionRule(rule().localId, 1)}
                      />
                      <IconButton
                        icon="trash"
                        size="xs"
                        tone="danger"
                        tooltip={tr("common.remove")}
                        accessibilityLabel={`permission-rule-${rule().localId}-remove`}
                        onPress={() => removePermissionRule(rule().localId)}
                      />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      <View style={{ flex: 1, minWidth: 140, gap: 5 }}>
                        <Text style={textStyle("label", { color: palette().textSecondary })}>
                          {tr("settings.permissions.action")}
                        </Text>
                        <SelectDropdown
                          size="md"
                          fullWidth={true}
                          searchable={true}
                          value={rule().action}
                          placeholder={tr("settings.permissions.actionPlaceholder")}
                          options={[
                            ...PERMISSION_ACTIONS.map(action => ({
                              value: action,
                              label: action === "*" ? tr("settings.permissions.anyAction") : action,
                              accessibilityLabel: `permission-rule-${rule().localId}-action-${action}`,
                            })),
                            // An action a tool reported that the list does not name stays selectable.
                            ...(rule().action && !PERMISSION_ACTIONS.includes(rule().action)
                              ? [
                                  {
                                    value: rule().action,
                                    label: rule().action,
                                    accessibilityLabel: `permission-rule-${rule().localId}-action-${rule().action}`,
                                  },
                                ]
                              : []),
                          ]}
                          accessibilityLabel={`permission-rule-${rule().localId}-action`}
                          onChange={val => patchPermissionRule(rule().localId, { action: val })}
                        />
                      </View>
                      <InputBox
                        label={tr("settings.permissions.resourcePattern")}
                        size="md"
                        monospace
                        value={rule().resource}
                        placeholder={tr("settings.permissions.resourcePlaceholder")}
                        accessibilityLabel={`permission-rule-${rule().localId}-resource`}
                        style={{ flex: 2, minWidth: 200 }}
                        onChange={val => patchPermissionRule(rule().localId, { resource: val })}
                      />
                    </View>
                  </View>
                )}
              </Each>
            </View>
          </If>
        </ModalDialog>

        <ApprovalSection />
      </View>
    </If>
  );
}

function ApprovalSection() {
  const kind = (): "chat" | "decision" => approvalSettings()?.modelKind ?? "chat";
  const pick = (field: string, fallback = ""): string => approvalDrafts()[field] ?? fallback;
  const approvalTimeoutDirty = (): boolean => {
    const typed = approvalDrafts().timeout;
    return typed !== undefined && typed.trim() !== String(approvalSettings()?.timeoutSeconds ?? "");
  };
  const clearTimeoutDraft = (): void =>
    approvalDrafts.update(current => {
      if (!("timeout" in current)) return current;
      const next = { ...current };
      delete next.timeout;
      return next;
    });
  // The host bounds the timeout and answers with what it stored.
  const saveApprovalTimeout = (): void => {
    const typed = pick("timeout").trim();
    if (!typed) {
      clearTimeoutDraft();
      return;
    }
    const seconds = Number.parseInt(typed, 10);
    if (!Number.isFinite(seconds)) {
      approvalNotice.set(tr("settings.permissions.timeoutValidation"));
      return;
    }
    clearTimeoutDraft();
    void saveApproval({ timeoutSeconds: seconds });
  };
  const stepApprovalTimeout = (direction: 1 | -1): void => {
    const current = approvalSettings()?.timeoutSeconds;
    if (current === undefined) return;
    clearTimeoutDraft();
    void saveApproval({ timeoutSeconds: Math.max(1, current + direction) });
  };
  return (
    // Until Auto is chosen there is nothing to set here: the title and the line
    // that says so, without an empty card under them.
    <If
      when={permissionMode() === "auto"}
      else={
        <View style={{ minWidth: 0 }}>
          <SectionHeader title={tr("settings.permissions.autoTitle")} description={tr("settings.permissions.autoHint")} />
          <SectionNoticeBanner notice={approvalNotice()} onDismiss={() => approvalNotice.set("")} />
        </View>
      }
    >
      <SettingsSection
        title={tr("settings.permissions.autoTitle")}
        flush={true}
        notice={approvalNotice()}
        onDismissNotice={() => approvalNotice.set("")}
      >
        <SettingsConfigRow label={tr("settings.polish.assessedBy")}>
          <SegmentedTabs
            size="sm"
            value={kind()}
            options={[
              {
                value: "chat",
                label: tr("settings.permissions.chatModel"),
                accessibilityLabel: "approval-kind-chat",
              },
              {
                value: "decision",
                label: tr("settings.permissions.decisionModel"),
                accessibilityLabel: "approval-kind-decision",
              },
            ]}
            onChange={value => void saveApproval({ modelKind: value as "chat" | "decision" })}
          />
        </SettingsConfigRow>
        <If when={kind() === "chat"}>
          <View style={{ position: "relative" }}>
            <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingTop: 10, paddingBottom: 6 }}>
              <Text style={textStyle("caption")}>
                {approvalModels().length === 0
                  ? tr("settings.permissions.noApprovalModels")
                  : tr("settings.permissions.chatApprovalHint")}
              </Text>
            </View>
            <Each of={approvalModels()} key={option => option.value}>
              {(option, index) => (
                <ChoiceRow
                  label={option().label}
                  detail={option().hint}
                  selected={approvalSettings()?.chatModelId === option().value}
                  first={index() === 0}
                  disabled={Boolean(option().disabled)}
                  accessibilityLabel={`approval-model-${option().value}`}
                  onPress={() => void saveApproval({ chatModelId: option().value })}
                />
              )}
            </Each>
            <RowSeparator edge="bottom" />
          </View>
        </If>
        <If when={kind() === "decision"}>
          <SettingsConfigRow
            label={tr("settings.permissions.decisionModel")}
            description={tr("settings.permissions.decisionModelHint")}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <InputBox
                size="sm"
                value={pick("decision-name")}
                placeholder={decisionModel()?.modelName || tr("settings.permissions.decisionModelNamePlaceholder")}
                accessibilityLabel="approval-decision-name"
                style={{ flex: 1, minWidth: 120 }}
                onChange={val => approvalDrafts.update(current => ({ ...current, "decision-name": val }))}
              />
              <InputBox
                size="sm"
                monospace
                value={pick("decision-endpoint")}
                placeholder={decisionModel()?.endpoint || tr("settings.permissions.decisionEndpointPlaceholder")}
                accessibilityLabel="approval-decision-endpoint"
                style={{ flex: 2, minWidth: 160 }}
                onChange={val => approvalDrafts.update(current => ({ ...current, "decision-endpoint": val }))}
              />
              <Button
                label={tr("settings.field.saveShort")}
                variant="secondary"
                size="sm"
                disabled={pick("decision-name").trim().length === 0 && pick("decision-endpoint").trim().length === 0}
                accessibilityLabel="save-approval-decision"
                onPress={() =>
                  void saveDecisionModel(
                    pick("decision-name") || (decisionModel()?.modelName ?? ""),
                    pick("decision-endpoint") || (decisionModel()?.endpoint ?? ""),
                  )
                }
              />
            </View>
          </SettingsConfigRow>
          <If when={decisionCredential() !== null}>
            <SettingsConfigRow label={tr("settings.polish.decisionKey")}>
              <InputBox
                size="sm"
                leadingIcon="key"
                masked
                value={pick("decision-secret")}
                placeholder={
                  decisionCredential()
                    ? tr("settings.permissions.keyConfiguredReplace")
                    : tr("settings.permissions.decisionKeyPlaceholder")
                }
                accessibilityLabel="approval-decision-secret"
                style={{ flex: 1, minWidth: 140, maxWidth: settingsCompact() ? "100%" : 220 }}
                onChange={val => approvalDrafts.update(current => ({ ...current, "decision-secret": val }))}
              />
              <Button
                label={tr("settings.field.saveShort")}
                variant="secondary"
                size="sm"
                disabled={pick("decision-secret").trim().length === 0}
                accessibilityLabel="save-approval-decision-key"
                onPress={() => void saveDecisionCredential(pick("decision-secret"))}
              />
              <If when={decisionCredential() === true}>
                <IconButton
                  icon="trash"
                  size="sm"
                  tone="danger"
                  tooltip={tr("settings.permissions.removeKey")}
                  accessibilityLabel="clear-approval-decision-key"
                  onPress={() => void clearDecisionCredential()}
                />
              </If>
            </SettingsConfigRow>
          </If>
        </If>
        <SettingsConfigRow label={tr("settings.permissions.timeout")}>
          <SettingsNumberStepper
            id="approval-timeout"
            text={pick("timeout", approvalSettings() ? String(approvalSettings()!.timeoutSeconds) : "")}
            unit={tr("settings.unit.seconds")}
            dirty={approvalTimeoutDirty()}
            readonly={!approvalSettings()}
            decreaseDisabled={!approvalSettings() || (approvalSettings()?.timeoutSeconds ?? 0) <= 1}
            increaseDisabled={!approvalSettings()}
            onDecrease={() => stepApprovalTimeout(-1)}
            onIncrease={() => stepApprovalTimeout(1)}
            onChangeText={val => approvalDrafts.update(current => ({ ...current, timeout: val }))}
            onSubmit={() => saveApprovalTimeout()}
            leading={
              <If when={approvalTimeoutDirty()}>
                <Button
                  label={tr("settings.field.saveShort")}
                  variant="secondary"
                  size="sm"
                  accessibilityLabel="save-approval-timeout"
                  onPress={() => saveApprovalTimeout()}
                />
              </If>
            }
          />
        </SettingsConfigRow>
        <SettingsConfigRow label={tr("settings.permissions.whenUnsure")}>
          <SegmentedTabs
            size="sm"
            value={approvalSettings()?.onAsk ?? "user"}
            options={[
              { value: "user", label: tr("settings.permissions.askMe"), accessibilityLabel: "approval-on-ask-user" },
              { value: "reject", label: tr("sessions.reject"), accessibilityLabel: "approval-on-ask-reject" },
            ]}
            onChange={val => void saveApproval({ onAsk: val === "reject" ? "reject" : "user" })}
          />
        </SettingsConfigRow>
        <SettingsConfigRow label={tr("settings.permissions.whenFails")} divider={false}>
          <SegmentedTabs
            size="sm"
            value={approvalSettings()?.onError ?? "ask"}
            options={[
              { value: "ask", label: tr("settings.permissions.askMe"), accessibilityLabel: "approval-on-error-ask" },
              { value: "reject", label: tr("sessions.reject"), accessibilityLabel: "approval-on-error-reject" },
            ]}
            onChange={val => void saveApproval({ onError: val === "reject" ? "reject" : "ask" })}
          />
        </SettingsConfigRow>
      </SettingsSection>
    </If>
  );
}

function SendPolicySection() {
  useDeviceScopedLoad("send-policy", ensureSendPolicy, () => void loadSendPolicy());
  const currentHint = (): string => {
    const entry = MID_TURN_KEYS[midTurnSendPolicy()];
    return entry ? tr(entry.hintKey) : tr("settings.sendPolicy.queueHint");
  };
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.sendPolicy.title")}
      subtitle={tr("settings.sendPolicy.subtitle")}
      notice={sendPolicyNotice()}
      onDismissNotice={() => sendPolicyNotice.set("")}
    >
      <SettingsConfigRow
        label={tr("settings.sendPolicy.duringTurn")}
        description={currentHint()}
        divider={false}
      >
        <SegmentedTabs
          size="sm"
          value={midTurnSendPolicy()}
          options={MID_TURN_POLICIES.map(entry => ({
            value: entry.value,
            label: tr(MID_TURN_KEYS[entry.value].labelKey),
            accessibilityLabel: `mid-turn-policy-${entry.value}`,
          }))}
          onChange={value => void chooseMidTurnSendPolicy(value)}
        />
      </SettingsConfigRow>
    </SettingsSection>
  );
}

function DraftRow(props: {
  id: string;
  label: string;
  hint: string;
  action: string;
  placeholder?: string;
  monospace?: boolean;
  onSave: (value: string) => void;
}) {
  const value = (): string => drafts()[props.id] ?? "";
  return (
    <SettingsConfigRow
      label={props.label}
      description={props.hint}
      topDivider={true}
      divider={false}
      controlWidth={settingsCompact() ? undefined : 300}
      controlAlign="stretch"
    >
      <InlineFieldSaveGroup
        value={value()}
        onChange={val => drafts.update(current => ({ ...current, [props.id]: val }))}
        onSave={() => props.onSave(value())}
        placeholder={props.placeholder ?? tr("settings.field.newValuePlaceholder")}
        saveLabel={tr("settings.field.saveShort")}
        size="sm"
        monospace={props.monospace}
        dirty={value().trim().length > 0}
        inputAccessibilityLabel={props.id}
        saveAccessibilityLabel={`${props.id}-save`}
      />
    </SettingsConfigRow>
  );
}

function WebSearchSection() {
  useDeviceScopedLoad("web-search", ensureWebSearch, () => void loadWebSearch());
  const providerId = (): string => selectedProvider();
  const providerEntry = () => providerOf(providerId());
  const providerMeta = (id: string) =>
    WEB_SEARCH_PROVIDER_KEYS[id as WebSearchProviderId] ?? null;
  const keyedProvider = (): boolean =>
    ["exa_search_api", "tavily", "deepseek", "keenable"].includes(providerId());
  const isHttp = (): boolean => providerId() === "openbitfun_search_http";
  const http = () => httpProvider();
  const credentialLine = (): string => {
    const status = webSearchCredential();
    if (!status || status.provider !== providerId()) return "";
    return status.configured
      ? tr("settings.webSearch.keyStored")
      : tr("settings.webSearch.noKeyStored");
  };
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.webSearch.title")}
      subtitle={tr("settings.webSearch.subtitle")}
      notice={webSearchNotice()}
      onDismissNotice={() => webSearchNotice.set("")}
    >
      <View>
        <SettingsConfigRow
          label={tr("settings.webSearch.provider")}
          description={
            providerMeta(providerId())
              ? tr(providerMeta(providerId())!.hintKey)
              : tr("settings.webSearch.defaultDesc")
          }
          divider={false}
          controlWidth={300}
          controlAlign="stretch"
        >
          <SelectDropdown
            options={WEB_SEARCH_PROVIDERS.map(entry => ({
              value: entry.value,
              label: tr(WEB_SEARCH_PROVIDER_KEYS[entry.value].labelKey),
              description: tr(WEB_SEARCH_PROVIDER_KEYS[entry.value].hintKey),
              icon: "globe" as const,
              accessibilityLabel: `search-provider-${entry.value}`,
            }))}
            value={providerId()}
            placeholder={tr("settings.webSearch.selectProvider")}
            fullWidth={true}
            accessibilityLabel="search-provider-select"
            onChange={value =>
              void chooseSearchProvider(value as (typeof WEB_SEARCH_PROVIDERS)[number]["value"])
            }
          />
        </SettingsConfigRow>
        <If when={keyedProvider()}>
          <DraftRow
            id="search-credential-id"
            label={tr("settings.webSearch.credentialId")}
            hint={tr("settings.webSearch.credentialIdHint", { id: credentialIdFor(providerId()) })}
            action={tr("settings.webSearch.saveCredentialId")}
            placeholder={credentialIdFor(providerId()) || providerId()}
            monospace
            onSave={value => void setProviderCredentialId(providerId(), value.trim())}
          />
        </If>
        <If when={isHttp()}>
          <View>
            <DraftRow
              id="search-http-endpoint"
              label={tr("settings.webSearch.endpoint")}
              hint={tr("settings.webSearch.endpointHint")}
              action={tr("settings.webSearch.saveEndpoint")}
              placeholder={http().endpoint || "https://search.example/v1/query"}
              monospace
              onSave={value => void setHttpEndpoint(value.trim())}
            />
            <SettingsConfigRow
              label={tr("settings.webSearch.auth")}
              topDivider={true}
              divider={false}
            >
              <SegmentedTabs
                size="sm"
                value={http().auth.mode}
                options={WEB_SEARCH_AUTH_MODES.map(mode => ({
                  value: mode.value,
                  label: WEB_SEARCH_AUTH_KEYS[mode.value]
                    ? tr(WEB_SEARCH_AUTH_KEYS[mode.value])
                    : mode.label,
                  accessibilityLabel: `search-auth-${mode.value}`,
                }))}
                onChange={mode =>
                  void setHttpAuth({
                    mode: mode as (typeof WEB_SEARCH_AUTH_MODES)[number]["value"],
                  })
                }
              />
            </SettingsConfigRow>
            <If when={http().auth.mode === "header"}>
              <DraftRow
                id="search-http-header"
                label={tr("settings.webSearch.headerName")}
                hint={tr("settings.webSearch.headerNameHint")}
                action={tr("settings.webSearch.saveHeader")}
                placeholder={http().auth.headerName || "X-API-Key"}
                monospace
                onSave={value => void setHttpAuth({ headerName: value.trim() })}
              />
            </If>
            <If when={http().auth.mode !== "none"}>
              <DraftRow
                id="search-http-credential-id"
                label={tr("settings.webSearch.credentialId")}
                hint={tr("settings.webSearch.credentialIdHint", { id: credentialIdFor(providerId()) })}
                action={tr("settings.webSearch.saveCredentialId")}
                placeholder={credentialIdFor(providerId()) || "openbitfun_search_http"}
                monospace
                onSave={value => void setHttpAuth({ credentialId: value.trim() })}
              />
            </If>
          </View>
        </If>
        <If when={providerEntry()?.needsCredential === true || providerEntry()?.credentialOptional === true}>
          <View
            style={{
              position: "relative",
              minHeight: SETTINGS_ROW_MIN,
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              columnGap: space.lg,
              rowGap: space.sm,
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingVertical: space.md,
            }}
          >
            <RowSeparator edge="top" />
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: space.hair }}>
              <Text style={{ ...textStyle("body"), fontWeight: "500" }}>
                {tr("settings.models.apiKey")}
              </Text>
              <If when={credentialLine()}>
                {line => (
                  <Text style={textStyle("caption", { color: palette().textSecondary })}>
                    {line()}
                  </Text>
                )}
              </If>
              <Text style={textStyle("caption")}>
                {tr("settings.webSearch.vaultHint")}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                flexShrink: 1,
                marginLeft: "auto",
                width: settingsCompact() ? "100%" : 300,
                maxWidth: "100%",
              }}
            >
              <InputBox
                size="sm"
                leadingIcon="key"
                masked
                value={drafts()["search-secret"] ?? ""}
                placeholder={tr("settings.webSearch.pasteKey")}
                accessibilityLabel="search-secret"
                style={{ flex: 1, minWidth: 0 }}
                onChange={val => drafts.update(current => ({ ...current, "search-secret": val }))}
                onSubmit={() => void saveSearchCredential(drafts()["search-secret"] ?? "")}
              />
              <Button
                label={tr("settings.field.saveShort")}
                variant={(drafts()["search-secret"] ?? "").trim().length > 0 ? "primary" : "secondary"}
                size="sm"
                accessibilityLabel="search-save-key"
                onPress={() => void saveSearchCredential(drafts()["search-secret"] ?? "")}
              />
              <IconButton
                icon="trash"
                size="sm"
                tone="danger"
                tooltip={tr("common.remove")}
                accessibilityLabel="search-clear-key"
                onPress={() => void clearSearchCredential()}
              />
            </View>
          </View>
        </If>
      </View>
    </SettingsSection>
  );
}

function QuickActionsSection() {
  useDeviceScopedLoad("quick-actions", ensureQuickActions, () => void loadQuickActions());
  const draft = () => quickActionDraft();
  const quickActionModalOpen = usePresenceFlag(() => Boolean(quickActionDraft()));
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.quickActions.title")}
      subtitle={tr("settings.quickActions.subtitle")}
      notice={quickActionsNotice()}
      onDismissNotice={() => quickActionsNotice.set("")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button
            label={tr("common.add")}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            accessibilityLabel="quick-action-add"
            onPress={() => openQuickActionDraft()}
          />
        </View>
      }
    >
      <View>
        <Each of={quickActions()} key={action => action.id}>
          {(action, index) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
                position: "relative",
                opacity: action().enabled ? 1 : 0.65,
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            >
              <If when={index() !== 0}>
                <RowSeparator edge="top" />
              </If>
              <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                <Text
                  style={{
                    ...textStyle("body"),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {action().label}
                </Text>
                <Text
                  style={{
                    ...textStyle("caption"),
                    numberOfLines: 2,
                    textOverflow: "ellipsis",
                  }}
                >
                  {action().prompt}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.sm }}>
                <ToggleSwitch
                  value={action().enabled}
                  accessibilityLabel={`quick-action-toggle-${action().id}`}
                  onChange={() => void toggleQuickAction(action().id)}
                />
                <View ref={el => setRowAnchor(`qa:${action().id}`, el)} style={{ flexShrink: 0 }}>
                  <IconButton
                    icon="more"
                    size="sm"
                    tooltip={tr("settings.quickActions.options")}
                    active={rowMenuId() === `qa:${action().id}`}
                    accessibilityLabel={`quick-action-actions-${action().id}`}
                    onPress={() =>
                      rowMenuId.set(
                        rowMenuId() === `qa:${action().id}` ? null : `qa:${action().id}`,
                      )
                    }
                  />
                </View>
              </View>
              <DropdownMenu
                open={rowMenuId() === `qa:${action().id}`}
                anchor={rowMenuAnchors()[`qa:${action().id}`] ?? null}
                align="end"
                minWidth={150}
                items={[
                  {
                    id: "up",
                    label: tr("common.up"),
                    icon: "arrow-up",
                    accessibilityLabel: `quick-action-up-${action().id}`,
                    onSelect: () => void moveQuickAction(action().id, -1),
                  },
                  {
                    id: "down",
                    label: tr("common.down"),
                    icon: "arrow-down",
                    accessibilityLabel: `quick-action-down-${action().id}`,
                    onSelect: () => void moveQuickAction(action().id, 1),
                  },
                  {
                    id: "edit",
                    label: tr("common.edit"),
                    icon: "edit",
                    accessibilityLabel: `quick-action-edit-${action().id}`,
                    onSelect: () => openQuickActionDraft(action()),
                  },
                  {
                    id: "delete",
                    label: tr("common.delete"),
                    icon: "trash",
                    danger: true,
                    accessibilityLabel: `quick-action-delete-${action().id}`,
                    onSelect: () => void deleteQuickAction(action().id),
                  },
                ]}
                onClose={() => rowMenuId.set(null)}
              />
            </View>
          )}
        </Each>
        <ModalDialog
          open={quickActionModalOpen()}
          title={
            draft()?.id
              ? tr("settings.quickActions.editTitle", { name: draft()?.label || draft()?.id || "" })
              : tr("settings.quickActions.newTitle")
          }
          subtitle={tr("settings.quickActions.modalSubtitle")}
          size="md"
          accessibilityLabel="quick-action-modal"
          onClose={() => closeQuickActionDraft()}
          footer={
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <Button
                label={tr("common.cancel")}
                variant="secondary"
                size="md"
                accessibilityLabel="quick-action-cancel"
                onPress={() => closeQuickActionDraft()}
              />
              <Button
                label={tr("common.save")}
                variant="primary"
                size="md"
                accessibilityLabel="quick-action-save"
                onPress={() => void saveQuickActionDraft()}
              />
            </View>
          }
        >
          <If when={Boolean(draft())}>
            <View style={{ gap: space.md }}>
              <InputBox
                label={tr("common.label")}
                value={draft()?.label ?? ""}
                placeholder={tr("common.label")}
                accessibilityLabel="quick-action-label"
                onChange={val => updateQuickActionDraft({ label: val })}
              />
              <InputBox
                label={tr("devices.prompt")}
                multiline
                minHeight={88}
                value={draft()?.prompt ?? ""}
                placeholder={tr("settings.quickActions.promptPlaceholder")}
                accessibilityLabel="quick-action-prompt"
                onChange={val => updateQuickActionDraft({ prompt: val })}
                onSubmit={() => void saveQuickActionDraft()}
              />
            </View>
          </If>
        </ModalDialog>
      </View>
    </SettingsSection>
  );
}

function McpSection() {
  useDeviceScopedLoad("mcp", ensureMcp, () => reloadMcpForDevice());
  void loadAccountRecords();
  const draft = () => mcpDraft();
  const mcpModalOpen = usePresenceFlag(() => Boolean(mcpDraft()));
  const mcpDocumentUsable = (): boolean => mcpDocument() !== null;
  const mcpIsInitialLoading = (): boolean =>
    mcpAvailable() === null || (mcpLoading() && mcpServerRows().length === 0 && !mcpDocumentLoaded());
  const stopped = (status: string): boolean => {
    const name = status.trim().toLowerCase();
    return name === "stopped" || name === "uninitialized" || name === "failed";
  };
  const canStart = (row: ReturnType<typeof mcpServerRows>[number]): boolean =>
    row.startSupported && row.commandAvailable !== false;
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.mcp.title")}
      subtitle={tr("settings.mcp.subtitle")}
      extra={
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          <If when={mcpDocumentUsable()}>
            <Button
              label={tr("settings.mcp.addServer")}
              variant="primary"
              size="sm"
              leadingIcon="plus"
              accessibilityLabel="mcp-add"
              onPress={() => openMcpDraft()}
            />
          </If>
          <If when={mcpDocumentUsable()}>
            <Button
              label={tr("common.import")}
              variant="secondary"
              size="sm"
              accessibilityLabel="mcp-import"
              onPress={() => (mcpImportOpen() ? closeMcpImport() : openMcpImport())}
            />
          </If>
          <Button
            label={tr("settings.mcp.json")}
            variant="ghost"
            size="sm"
            accessibilityLabel="mcp-json-toggle"
            onPress={() => (mcpJsonOpen() ? closeMcpJson() : openMcpJson())}
          />
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("settings.mcp.reload")}
            accessibilityLabel="mcp-reload"
            onPress={() => {
              void refreshMcpServers();
              void loadMcpDocument();
            }}
          />
        </View>
      }
    >
      <View>
        <If when={mcpNotice()}>
          {notice => (
            <View
              style={{
                position: "relative",
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
              }}
            >
              <RowSeparator edge="bottom" />
              <Text style={textStyle("caption")}>{localizeHostError(notice())}</Text>
            </View>
          )}
        </If>

        <If when={mcpIsInitialLoading()}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingVertical: space.lg,
              minHeight: SETTINGS_ROW_MIN,
            }}
          >
            <Spinner size={14} color={palette().textMuted} />
            <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
          </View>
        </If>

        <If when={mcpAvailable() === false}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.lg }}>
            <Text style={textStyle("caption")}>{tr("settings.mcp.unavailable")}</Text>
          </View>
        </If>

        <If when={mcpAvailable() === true && mcpDocumentLoaded() && !mcpDocumentUsable()}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.lg }}>
            <Text style={textStyle("caption")}>{tr("settings.mcp.configReadError")}</Text>
          </View>
        </If>

        <Each of={mcpServerRows()} key={row => row.id}>
          {(row, index) => (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
                minHeight: SETTINGS_ROW_MIN,
                position: "relative",
                opacity: row().enabled ? 1 : 0.72,
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            >
              <If when={index() !== 0}>
                <RowSeparator edge="top" />
              </If>
              <If when={row().enabled && row().status.trim().toLowerCase() === "failed"}>
                <View style={{ alignSelf: "flex-start", height: settingsRowLabelLineHeight(), justifyContent: "center" }}>
                  <StateMark state="failed" size={12} />
                </View>
              </If>
              <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
                <Text
                  style={{
                    ...textStyle("body"),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${row().name} · ${row().id}`}
                </Text>
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textMuted }),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {`${row().transport || tr("settings.mcp.unknownTransport")} · ${
                    row().command || row().url || row().statusMessage || ""
                  }`}
                </Text>
                <If when={!row().enabled && row().statusMessage ? row().statusMessage : ""}>
                  {hint => <Text style={textStyle("caption")}>{hint()}</Text>}
                </If>
                <If when={mcpSecretsNote(row().id)}>
                  {note => (
                    <Text style={textStyle("caption")} accessibilityLabel={`mcp-needs-secret-${row().id}`}>
                      {note()}
                    </Text>
                  )}
                </If>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 1, minWidth: 0, gap: space.sm }}>
                <Text
                  style={textStyle("caption", {
                    color:
                      row().enabled && row().status.trim().toLowerCase() === "failed"
                        ? stateColor("failed")
                        : palette().textSecondary,
                  })}
                >
                  {row().enabled ? row().status : tr("common.disabled")}
                </Text>
                <If when={!!row().url}>
                  <Button
                    label={
                      row().authConfigured === true
                        ? tr("settings.mcp.reauthorize")
                        : tr("settings.mcp.authorize")
                    }
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`mcp-auth-${row().id}`}
                    onPress={() =>
                      mcpOAuthServer() === row().id ? closeMcpAuth() : openMcpAuth(row().id)
                    }
                  />
                </If>
                <If when={stopped(row().status)}>
                  <Button
                    label={
                      canStart(row())
                        ? row().enabled
                          ? tr("common.start")
                          : tr("settings.mcp.enableAndStart")
                        : tr("common.unavailable")
                    }
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`mcp-start-${row().id}`}
                    onPress={() => {
                      if (!canStart(row())) {
                        openMcpDraft(row().id);
                      } else if (row().enabled) {
                        void startMcpServer(row().id);
                      } else {
                        // The host refuses to start a disabled server: enable it first.
                        void enableMcpServer(row().id, { start: true });
                      }
                    }}
                  />
                </If>
                <If when={!stopped(row().status) && row().enabled}>
                  <Button
                    label={tr("settings.mcp.resources")}
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`mcp-resources-${row().id}`}
                    onPress={() =>
                      mcpResourcesServer() === row().id
                        ? closeMcpResources()
                        : void openMcpResources(row().id)
                    }
                  />
                </If>
                <View ref={el => setRowAnchor(`mcp:${row().id}`, el)} style={{ flexShrink: 0 }}>
                  <IconButton
                    icon="more"
                    size="sm"
                    tooltip={tr("settings.mcp.serverActions")}
                    active={rowMenuId() === `mcp:${row().id}`}
                    accessibilityLabel={`mcp-actions-${row().id}`}
                    onPress={() =>
                      rowMenuId.set(
                        rowMenuId() === `mcp:${row().id}` ? null : `mcp:${row().id}`,
                      )
                    }
                  />
                </View>
              </View>
              <DropdownMenu
                open={rowMenuId() === `mcp:${row().id}`}
                anchor={rowMenuAnchors()[`mcp:${row().id}`] ?? null}
                align="end"
                minWidth={170}
                items={[
                  ...(!row().enabled
                    ? [
                        {
                          id: "enable",
                          label: tr("common.enable"),
                          icon: "check" as const,
                          accessibilityLabel: `mcp-enable-${row().id}`,
                          onSelect: () => void enableMcpServer(row().id),
                        },
                      ]
                    : []),
                  {
                    id: "edit",
                    label: tr("common.edit"),
                    icon: "edit",
                    accessibilityLabel: `mcp-edit-${row().id}`,
                    onSelect: () => openMcpDraft(row().id),
                  },
                  ...(!stopped(row().status)
                    ? [
                        {
                          id: "stop",
                          label: tr("common.stop"),
                          icon: "stop" as const,
                          accessibilityLabel: `mcp-stop-${row().id}`,
                          onSelect: () => void stopMcpServer(row().id),
                        },
                      ]
                    : []),
                  {
                    id: "restart",
                    label: tr("common.restart"),
                    icon: "refresh",
                    accessibilityLabel: `mcp-restart-${row().id}`,
                    onSelect: () =>
                      canStart(row()) ? void restartMcpServer(row().id) : openMcpDraft(row().id),
                  },
                  {
                    id: "status",
                    label: tr("settings.mcp.refreshStatus"),
                    icon: "info",
                    accessibilityLabel: `mcp-status-${row().id}`,
                    onSelect: () => void refreshMcpServers(),
                  },
                  {
                    id: "delete",
                    label: tr("common.delete"),
                    icon: "trash",
                    danger: true,
                    confirmDelete: true,
                    confirmAccessibilityLabel: `mcp-delete-confirm-${row().id}`,
                    accessibilityLabel: `mcp-delete-${row().id}`,
                    onSelect: () => {
                      mcpDeletePending.set(null);
                      void deleteMcpServer(row().id);
                    },
                  },
                ]}
                onClose={() => rowMenuId.set(null)}
              />
            </View>
          )}
        </Each>
        <If when={mcpServerRows().length === 0 && mcpAvailable() === true && !mcpLoading()}>
          <SettingsEmptyState icon="plug" message={tr("settings.mcp.noServers")} />
        </If>
        <If when={mcpBusy()}>
          {busy => (
            <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingBottom: space.md }}>
              <Text style={textStyle("caption")}>
                {tr("settings.mcp.working", { task: busy() })}
              </Text>
            </View>
          )}
        </If>
      </View>

      {/* MCP Raw JSON Modal */}
      <ModalDialog
        open={mcpJsonOpen()}
        title={tr("settings.mcp.jsonModalTitle")}
        subtitle={tr("settings.mcp.jsonModalSubtitle")}
        size="lg"
        accessibilityLabel="mcp-json-modal"
        onClose={() => closeMcpJson()}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
            <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>
              {mcpJsonState()}
            </Text>
            <Button
              label={tr("common.discard")}
              variant="secondary"
              size="md"
              accessibilityLabel="mcp-json-cancel"
              onPress={() => closeMcpJson()}
            />
            <Button
              label={tr("settings.mcp.saveJson")}
              variant="primary"
              size="md"
              accessibilityLabel="mcp-json-save"
              onPress={() => void saveMcpJson()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <If when={mcpJsonNotice()}>
            {notice => <InlineBanner tone="danger" message={localizeHostError(notice())} />}
          </If>
          <InputBox
            multiline
            monospace
            minHeight={220}
            value={mcpJsonText()}
            accessibilityLabel="mcp-json"
            onChange={val => updateMcpJson(val)}
          />
        </View>
      </ModalDialog>

      {/* MCP OAuth Modal */}
      <ModalDialog
        open={Boolean(mcpOAuthServer())}
        title={tr("settings.mcp.authorizeTitle", { server: mcpOAuthServer() ?? "" })}
        subtitle={tr("settings.mcp.oauthStatus", { status: mcpOAuthStatusLabel(mcpOAuthSession()) })}
        size="md"
        accessibilityLabel="mcp-auth-modal"
        // Authorization finishes in the browser: the click that returns to this window must not end it.
        keepOpenOnBackdrop={Boolean(mcpOAuthSession()) && !["authorized", "failed", "cancelled"].includes(mcpOAuthSession()!.status)}
        onClose={() => closeMcpAuth()}
        footer={
          <Button
            label={tr("common.close")}
            variant="secondary"
            size="md"
            accessibilityLabel="mcp-auth-close"
            onPress={() => closeMcpAuth()}
          />
        }
      >
        <View style={{ gap: space.md }}>
          <View style={{ gap: space.sm }}>
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {tr("settings.mcp.browserOAuth")}
            </Text>
            <If when={mcpOAuthSession()?.redirectUri ?? ""}>
              {uri => (
                <Text style={textStyle("mono", { color: palette().textMuted })}>
                  {tr("settings.mcp.oauthRedirect", { uri: uri() })}
                </Text>
              )}
            </If>
            <If when={mcpOAuthSession()?.message ?? ""}>
              {message => <Text style={textStyle("caption")}>{message()}</Text>}
            </If>
            <If when={mcpOAuthUrlUnopened() ? (mcpOAuthSession()?.authorizationUrl ?? "") : ""}>
              {url => (
                <View style={{ gap: space.sm }}>
                  <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                    {tr("settings.mcp.oauthOpenFailed")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.md,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      borderRadius: radii.md,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <Text
                      style={{
                        ...textStyle("mono", { color: palette().text }),
                        flex: 1,
                        minWidth: 0,
                        numberOfLines: 2,
                        textOverflow: "ellipsis-middle",
                      }}
                    >
                      {url()}
                    </Text>
                    <Button
                      label={tr("settings.mcp.copyAddress")}
                      variant="secondary"
                      size="sm"
                      leadingIcon="copy"
                      accessibilityLabel="mcp-auth-copy-url"
                      onPress={() => copyMcpOAuthUrl()}
                    />
                  </View>
                </View>
              )}
            </If>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <Button
                label={
                  mcpOAuthSession()?.status === "authorized"
                    ? tr("settings.mcp.authorizeAgain")
                    : tr("settings.mcp.authorizeInBrowser")
                }
                variant="primary"
                size="sm"
                loading={mcpOAuthBusy()}
                accessibilityLabel="mcp-auth-start"
                onPress={() => void startMcpRemoteOAuth()}
              />
              <Button
                label={tr("settings.mcp.cancelAuth")}
                variant="ghost"
                size="sm"
                accessibilityLabel="mcp-auth-cancel"
                onPress={() => void cancelMcpRemoteOAuth()}
              />
            </View>
          </View>
          <View
            style={{
              gap: space.md,
              paddingTop: space.md,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {tr("settings.mcp.manualAuth")}
            </Text>
            <Text style={textStyle("caption")}>{tr("settings.mcp.manualAuthHint")}</Text>
            <InputBox
              size="md"
              leadingIcon="key"
              masked
              value={mcpAuthValue()}
              placeholder={tr("settings.mcp.tokenPlaceholder")}
              accessibilityLabel="mcp-auth-value"
              onChange={val => setMcpAuthValue(val)}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <Button
                label={tr("settings.mcp.saveValue")}
                variant="secondary"
                size="sm"
                accessibilityLabel="mcp-auth-save-value"
                onPress={() => void saveMcpRemoteAuth()}
              />
              <Button
                label={tr("settings.mcp.clearAuth")}
                variant="danger"
                size="sm"
                accessibilityLabel="mcp-auth-clear"
                onPress={() => void clearMcpRemoteAuth()}
              />
              <View style={{ flex: 1 }} />
              <If when={mcpOAuthNotice()}>
                {notice => <Text style={textStyle("caption")}>{localizeHostError(notice())}</Text>}
              </If>
            </View>
          </View>
        </View>
      </ModalDialog>

      {/* MCP Import Modal */}
      <ModalDialog
        open={mcpImportOpen()}
        title={tr("settings.mcp.importTitle")}
        subtitle={tr("settings.mcp.importSubtitle")}
        size="lg"
        accessibilityLabel="mcp-import-modal"
        onClose={() => closeMcpImport()}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.preview")}
              variant="secondary"
              size="md"
              accessibilityLabel="mcp-import-preview"
              onPress={() => previewMcpImport()}
            />
            <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>
              {localizeHostError(mcpImportNotice())}
            </Text>
            <Button
              label={tr("common.close")}
              variant="ghost"
              size="md"
              accessibilityLabel="mcp-import-close"
              onPress={() => closeMcpImport()}
            />
            <Button
              label={tr("settings.mcp.importSelected")}
              variant="primary"
              size="md"
              disabled={mcpImportCandidates() === null}
              accessibilityLabel="mcp-import-save"
              onPress={() => void importMcpServers()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <InputBox
            multiline
            monospace
            minHeight={140}
            value={mcpImportText()}
            placeholder={'{\n  "mcpServers": {\n    "name": { "command": "npx", "args": ["-y", "pkg"] }\n  }\n}'}
            accessibilityLabel="mcp-import-text"
            onChange={val => setMcpImportText(val)}
          />
          <Each of={mcpImportCandidates() ?? []} key={candidate => candidate.sourceId}>
            {candidate => (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                <SelectableChip
                  label={
                    candidate().unsupported
                      ? tr("settings.mcp.unsupported")
                      : candidate().selected
                        ? tr("common.import")
                        : tr("settings.mcp.skip")
                  }
                  active={candidate().selected && !candidate().unsupported}
                  accessibilityLabel={`mcp-import-select-${candidate().sourceId}`}
                  onPress={() =>
                    candidate().unsupported
                      ? undefined
                      : updateMcpImportCandidate(candidate().sourceId, { selected: !candidate().selected })
                  }
                />
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textMuted }),
                    minWidth: 96,
                    maxWidth: 160,
                    flexShrink: 1,
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {candidate().sourceId}
                </Text>
                <InputBox
                  size="sm"
                  monospace
                  value={candidate().targetId}
                  readonly={candidate().unsupported !== ""}
                  accessibilityLabel={`mcp-import-target-${candidate().sourceId}`}
                  style={{ flex: 1, minWidth: 140 }}
                  onChange={val =>
                    updateMcpImportCandidate(candidate().sourceId, { targetId: val })
                  }
                />
                <If when={candidate().unsupported}>
                  {reason => (
                    <Text
                      style={{
                        ...textStyle("caption", { color: stateColor("needs_you") }),
                        flex: 1,
                        minWidth: 140,
                      }}
                    >
                      {reason()}
                    </Text>
                  )}
                </If>
              </View>
            )}
          </Each>
        </View>
      </ModalDialog>

      {/* MCP Resources Modal */}
      <ModalDialog
        open={Boolean(mcpResourcesServer())}
        title={tr("settings.mcp.resourcesOf", { server: mcpResourcesServer() ?? "" })}
        size="lg"
        accessibilityLabel="mcp-resources-modal"
        onClose={() => closeMcpResources()}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.refresh")}
              variant="secondary"
              size="md"
              accessibilityLabel="mcp-resources-refresh"
              onPress={() => void loadMcpResources()}
            />
            <Button
              label={tr("common.close")}
              variant="secondary"
              size="md"
              accessibilityLabel="mcp-resources-close"
              onPress={() => closeMcpResources()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <SearchInput
            value={mcpResourceQuery()}
            onChange={value => setMcpResourceQuery(value)}
            placeholder={tr("settings.mcp.filterResources")}
            accessibilityLabel="mcp-resources-filter"
          />
          <If when={mcpResourcesBusy()}>
            <Text style={textStyle("caption")}>{tr("settings.mcp.readingResources")}</Text>
          </If>
          <If when={mcpResourcesNotice()}>
            {notice => <InlineBanner tone="danger" message={localizeHostError(notice())} />}
          </If>
          <If
            when={
              mcpResourcesLoaded() &&
              !mcpResourcesBusy() &&
              mcpResourcesRows().length === 0 &&
              !mcpResourcesNotice()
            }
          >
            <Text style={textStyle("caption")}>{tr("settings.mcp.noResources")}</Text>
          </If>
          <If when={mcpResourcesLoaded() && mcpResourcesRows().length > 0 && mcpResourceVisibleRows().length === 0}>
            <Text style={textStyle("caption", { tabular: true })}>
              {tr("settings.mcp.noMatchingResources", { count: mcpResourcesRows().length })}
            </Text>
          </If>
          <Each of={mcpResourceVisibleRows()} key={row => row.uri}>
            {row => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <SelectableChip
                  label={row().title ?? row().name}
                  active={mcpResourceSelected()?.uri === row().uri}
                  accessibilityLabel={`mcp-resource-${row().slot}`}
                  onPress={() => void openMcpResource(row())}
                />
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textMuted }),
                    flex: 1,
                    minWidth: 0,
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {`${row().uri}${row().mimeType ? ` · ${row().mimeType}` : ""}`}
                </Text>
              </View>
            )}
          </Each>
          <If when={mcpResourceSelected()}>
            {selected => (
              <View
                style={{
                  gap: space.sm,
                  padding: space.md,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().text }),
                    fontWeight: "600",
                  }}
                >
                  {`${selected().name}${selected().mimeType ? ` · ${selected().mimeType}` : ""}`}
                </Text>
                <If when={mcpResourceContentBusy()}>
                  <Text style={textStyle("caption")}>{tr("common.reading")}</Text>
                </If>
                <If when={!mcpResourceContentBusy() && mcpResourceContent() ? mcpResourceContent() : ""}>
                  {content => (
                    <Scroll style={{ maxHeight: 240, minHeight: 0, flexShrink: 1 }}>
                      <Text style={textStyle("mono", { color: palette().textSecondary })}>
                        {content()}
                      </Text>
                    </Scroll>
                  )}
                </If>
              </View>
            )}
          </If>
        </View>
      </ModalDialog>

      {/* MCP Add/Edit Server Modal */}
      <ModalDialog
        open={mcpModalOpen()}
        title={
          draft()?.originalId
            ? tr("settings.mcp.editServerTitle", { id: draft()!.originalId! })
            : tr("settings.mcp.newServerTitle")
        }
        subtitle={tr("settings.mcp.serverModalSubtitle")}
        size="md"
        accessibilityLabel="mcp-draft-modal"
        onClose={() => closeMcpDraft()}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
            <If when={!draft()?.originalId}>
              <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>
                {tr("settings.mcp.storedDisabledHint")}
              </Text>
            </If>
            <If when={Boolean(draft()?.originalId)}>
              <View style={{ flex: 1 }} />
            </If>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              accessibilityLabel="mcp-draft-cancel"
              onPress={() => closeMcpDraft()}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="md"
              accessibilityLabel="mcp-draft-save"
              onPress={() => void saveMcpDraft()}
            />
          </View>
        }
      >
        <If when={Boolean(draft())}>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <InputBox
                label={tr("common.name")}
                value={draft()?.name ?? ""}
                placeholder={tr("common.name")}
                accessibilityLabel="mcp-draft-name"
                style={{ flex: 1, minWidth: 160 }}
                onChange={val => updateMcpDraft({ name: val })}
              />
              <InputBox
                label={tr("settings.mcp.serverId")}
                monospace
                value={draft()?.id ?? ""}
                placeholder={
                  draft()?.originalId
                    ? draft()!.originalId!
                    : tr("settings.mcp.idFromNamePlaceholder")
                }
                readonly={Boolean(draft()?.originalId)}
                accessibilityLabel="mcp-draft-id"
                style={{ flex: 1, minWidth: 160 }}
                onChange={val => updateMcpDraft({ id: val })}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.mcp.transport")}
              </Text>
              <SegmentedTabs
                size="sm"
                value={draft()?.transport ?? "stdio"}
                options={MCP_TRANSPORTS.map(transport => ({
                  value: transport.value,
                  label: transport.label,
                  accessibilityLabel: `mcp-draft-transport-${transport.value}`,
                }))}
                onChange={transport => updateMcpDraft({ transport })}
              />
            </View>
            <If when={draft()?.transport === "stdio"}>
              <View style={{ gap: 10 }}>
                <InputBox
                  label={tr("settings.mcp.command")}
                  monospace
                  value={draft()?.command ?? ""}
                  placeholder={tr("settings.mcp.commandPlaceholder")}
                  accessibilityLabel="mcp-draft-command"
                  onChange={val => updateMcpDraft({ command: val })}
                />
                <InputBox
                  label={tr("settings.mcp.args")}
                  multiline
                  monospace
                  minHeight={68}
                  value={draft()?.args ?? ""}
                  placeholder={tr("settings.mcp.argsPlaceholder")}
                  accessibilityLabel="mcp-draft-args"
                  onChange={val => updateMcpDraft({ args: val })}
                />
                <InputBox
                  label={tr("settings.mcp.env")}
                  multiline
                  monospace
                  minHeight={68}
                  value={draft()?.env ?? ""}
                  placeholder={tr("settings.mcp.envPlaceholder")}
                  accessibilityLabel="mcp-draft-env"
                  onChange={val => updateMcpDraft({ env: val })}
                />
                <InputBox
                  label={tr("settings.mcp.cwd")}
                  monospace
                  value={draft()?.workingDirectory ?? ""}
                  placeholder={tr("settings.mcp.cwdPlaceholder")}
                  accessibilityLabel="mcp-draft-cwd"
                  onChange={val => updateMcpDraft({ workingDirectory: val })}
                />
              </View>
            </If>
            <If when={Boolean(draft()) && draft()?.transport !== "stdio"}>
              <View style={{ gap: 10 }}>
                <InputBox
                  label={tr("settings.mcp.serverUrl")}
                  monospace
                  value={draft()?.url ?? ""}
                  placeholder="https://host/mcp"
                  accessibilityLabel="mcp-draft-url"
                  onChange={val => updateMcpDraft({ url: val })}
                />
                <InputBox
                  label={tr("settings.mcp.headers")}
                  multiline
                  monospace
                  minHeight={68}
                  value={draft()?.headers ?? ""}
                  placeholder={tr("settings.mcp.headersPlaceholder")}
                  accessibilityLabel="mcp-draft-headers"
                  onChange={val => updateMcpDraft({ headers: val })}
                />
              </View>
            </If>
            <View style={{ gap: 6 }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.mcp.startupTimeout")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
                <SelectableChip
                  label={draft()?.enabled ? tr("common.enabled") : tr("common.disabled")}
                  active={Boolean(draft()?.enabled)}
                  accessibilityLabel="mcp-draft-enabled"
                  onPress={() => updateMcpDraft({ enabled: !(draft()?.enabled ?? false) })}
                />
                <SelectableChip
                  label={
                    draft()?.autoStart
                      ? tr("settings.mcp.startsWithApp")
                      : tr("settings.mcp.startedByHand")
                  }
                  active={Boolean(draft()?.autoStart)}
                  accessibilityLabel="mcp-draft-autostart"
                  onPress={() => updateMcpDraft({ autoStart: !(draft()?.autoStart ?? false) })}
                />
                <InputBox
                  size="sm"
                  value={draft()?.startupSeconds ?? ""}
                  placeholder={tr("settings.mcp.startupSecondsPlaceholder")}
                  accessibilityLabel="mcp-draft-startup"
                  style={{ width: 112 }}
                  onChange={val => updateMcpDraft({ startupSeconds: val })}
                />
              </View>
            </View>
          </View>
        </If>
      </ModalDialog>
    </SettingsSection>
  );
}

function AcpSection() {
  useDeviceScopedLoad(
    "acp",
    () => {
      ensureAcp();
      void probeAcpClients();
    },
    () => {
      void loadAcpClients();
      void probeAcpClients(true);
    },
  );
  return (
    <If when={acpSupported() !== false}>
      <SettingsSection
        flush={true}
        title={tr("settings.acp.title")}
        subtitle={tr("settings.acp.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <If when={acpProbing()}>
              <Spinner size={13} color={palette().accent} />
            </If>
            <Button
              label={tr("settings.mcp.json")}
              variant="ghost"
              size="sm"
              accessibilityLabel="acp-json-toggle"
              onPress={() => void openAcpJson()}
            />
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={acpProbing() ? tr("settings.acp.probing") : tr("settings.acp.reload")}
              accessibilityLabel="acp-reload"
              onPress={() => {
                void loadAcpClients();
                void probeAcpClients(true);
              }}
            />
          </View>
        }
      >
        <View>
          <If when={acpNotice()}>
            {notice => (
              <View
                style={{
                  position: "relative",
                  paddingHorizontal: SETTINGS_ROW_INSET,
                  paddingVertical: space.md,
                }}
              >
                <RowSeparator edge="bottom" />
                <Text style={textStyle("caption")}>{localizeHostError(notice())}</Text>
              </View>
            )}
          </If>

          <If when={acpClients().length === 0}>
            <SettingsEmptyState icon="bot" message={tr("settings.acp.empty")} />
          </If>
          <Each of={acpClients()} key={client => client.id}>
            {(client, index) => (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: space.md,
                  paddingHorizontal: SETTINGS_ROW_INSET,
                  paddingVertical: space.md,
                  minHeight: SETTINGS_ROW_MIN,
                  position: "relative",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              >
                <If when={index() !== 0}>
                  <RowSeparator edge="top" />
                </If>
                <If when={client().status === "running" || client().status === "starting"}>
                  <View style={{ alignSelf: "flex-start", height: settingsRowLabelLineHeight(), justifyContent: "center" }}>
                    <StateMark state="working" size={12} />
                  </View>
                </If>
                <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
                  <Text
                    style={{
                      ...textStyle("body"),
                      fontWeight: "500",
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${client().name} · ${client().id}`}
                  </Text>
                  <Text
                    style={{
                      ...textStyle("mono", { color: palette().textMuted }),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {`${[client().command, ...client().args].filter(Boolean).join(" ") || tr("settings.acp.noCommand")} · ${acpRowStatus(client())}`}
                  </Text>
                  <If when={acpProbes()[client().id] && !acpProbes()[client().id].runnable}>
                    <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                      {acpProbes()[client().id].notes.join(" · ")}
                    </Text>
                  </If>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 1, minWidth: 0, gap: space.sm }}>
                  <Text style={textStyle("caption", { color: palette().textSecondary })}>
                    {client().enabled ? tr("common.enabled").toLowerCase() : tr("common.disabled").toLowerCase()}
                  </Text>
                  <SelectDropdown
                    size="sm"
                    value={client().permissionMode === "allow_once" ? "allow_once" : "ask"}
                    options={ACP_PERMISSION_MODES.map(mode => ({
                      value: mode,
                      label: mode === "allow_once" ? tr("settings.acp.permissionAllowOnce") : tr("settings.acp.permissionAsk"),
                      accessibilityLabel: `acp-permission-${client().id}-${mode}`,
                    }))}
                    accessibilityLabel={`acp-permission-${client().id}`}
                    disabled={acpBusy() === client().id}
                    minWidth={settingsCompact() ? 140 : 180}
                    align="end"
                    onChange={mode => void setAcpPermissionMode(client().id, mode)}
                  />
                  <If when={client().status === "running" || client().status === "starting"}>
                    <Button
                      label={tr("common.stop")}
                      variant="secondary"
                      size="sm"
                      accessibilityLabel={`acp-stop-${client().id}`}
                      onPress={() => void stopAcpClient(client().id)}
                    />
                  </If>
                  <If when={acpProbes()[client().id] && !acpProbes()[client().id].runnable}>
                    <Button
                      label={
                        acpBusy() === client().id
                          ? tr("common.installing")
                          : tr("settings.acp.installCli")
                      }
                      variant="secondary"
                      size="sm"
                      accessibilityLabel={`acp-install-${client().id}`}
                      onPress={() => void installAcpClient(client().id)}
                    />
                  </If>
                </View>
              </View>
            )}
          </Each>
        </View>

        <ModalDialog
          open={acpJsonOpen()}
          title={tr("settings.acp.jsonTitle")}
          subtitle={tr("settings.acp.jsonSubtitle")}
          size="lg"
          accessibilityLabel="acp-json-modal"
          onClose={() => closeAcpJson()}
          footer={
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
              <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>
                {acpJsonDirty()
                  ? tr("settings.acp.unsavedChanges")
                  : acpJsonText()
                    ? tr("settings.acp.loaded")
                    : tr("common.loading")}
              </Text>
              <Button
                label={tr("common.discard")}
                variant="secondary"
                size="md"
                accessibilityLabel="acp-json-discard"
                onPress={() => closeAcpJson()}
              />
              <Button
                label={tr("settings.mcp.saveJson")}
                variant="primary"
                size="md"
                accessibilityLabel="acp-json-save"
                onPress={() => void saveAcpJson()}
              />
            </View>
          }
        >
          <View style={{ gap: 10 }}>
            <If when={acpJsonNotice()}>
              {notice => <InlineBanner tone="danger" message={localizeHostError(notice())} />}
            </If>
            <InputBox
              multiline
              monospace
              minHeight={220}
              value={acpJsonText()}
              accessibilityLabel="acp-json"
              onChange={val => editAcpJson(val)}
            />
          </View>
        </ModalDialog>
      </SettingsSection>
    </If>
  );
}

const TREND_BUCKETS = 12;
const USAGE_DAY_ROWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HEATMAP_HEIGHT = 96;
const HEATMAP_PADDING_INNER = 0.22;

const hoveredUsageActivityIdx = signal<number | null>(null);
const hoveredUsageTrendIdx = signal<number | null>(null);

function heatmapPlotWidth(weekCount: number): number {
  const pitch = HEATMAP_HEIGHT / (USAGE_DAY_ROWS.length - HEATMAP_PADDING_INNER);
  return Math.max(120, Math.round((Math.max(1, weekCount) - HEATMAP_PADDING_INNER) * pitch));
}

/** Shared 5-step heatmap color ramp used 1:1 by `<Plot><Cell />` and legend swatches. */
function usageHeatmapStepColors(): string[] {
  const p = palette();
  return [
    p.heatmapZero,
    p.accentSoft,
    p.accentBorder,
    p.accentHover,
    p.accent,
  ];
}

interface UsageTrendPlotRow {
  bucket: string;
  shortLabel: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

function trendBars(): UsageTrendPlotRow[] {
  const hourly = usageGranularity() === "hour";
  return usageBuckets()
    .slice(-TREND_BUCKETS)
    .map(bucket => {
      const formatted = formatBucket(bucket.bucket, hourly);
      const shortLabel = hourly
        ? formatted.split(" ").pop() || formatted
        : formatted.replace(/^\d{4}-/, "");
      return {
        bucket: bucket.bucket,
        shortLabel,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        cachedTokens: bucket.cachedTokens,
        totalTokens: bucket.inputTokens + bucket.outputTokens,
      };
    });
}

interface UsageHeatmapPlotRow {
  weekKey: string;
  dow: string;
  levelKey: string;
  dateKey: string;
  tokens: number;
}

function usageHeatmapPlotData(): { weeks: string[]; rows: UsageHeatmapPlotRow[] } {
  const activity = usageActivity();
  if (!activity) return { weeks: [], rows: [] };
  const weekCount = Math.max(1, activity.weekCount);
  const weeks = Array.from({ length: weekCount }, (_, idx) => `w${idx}`);
  const rows: UsageHeatmapPlotRow[] = [];
  activity.days.forEach((day, idx) => {
    if (!day.inRange) return;
    const col = Math.floor(idx / 7);
    const row = idx % 7;
    rows.push({
      weekKey: `w${col}`,
      dow: USAGE_DAY_ROWS[row] ?? "Mon",
      levelKey: String(day.level),
      dateKey: day.key,
      tokens: day.tokens,
    });
  });
  return { weeks, rows };
}

function activitySpan(): string {
  const activity = usageActivity();
  if (!activity) return "";
  const days = activity.days.filter(day => day.inRange);
  if (days.length === 0) return "";
  return `${days[0].key} – ${days[days.length - 1].key}`;
}

function activityTotal(): string {
  const activity = usageActivity();
  if (!activity) return "";
  return formatTokens(activity.totalTokens);
}

function UsageSection() {
  useDeviceScopedLoad("usage", () => void loadUsage(), () => void loadUsage(true));
  const hourly = (): boolean => usageGranularity() === "hour";
  const hitRate = (): string => {
    const totals = usageTotals();
    if (!totals) return "";
    return formatPercent(usageCacheHitRate(totals), 1);
  };
  const hoveredActivityDay = (): UsageHeatmapPlotRow | null => {
    const idx = hoveredUsageActivityIdx();
    if (idx === null) return null;
    const { rows } = usageHeatmapPlotData();
    return rows[idx] ?? null;
  };
  const hoveredTrendRow = (): UsageTrendPlotRow | null => {
    const idx = hoveredUsageTrendIdx();
    if (idx === null) return null;
    return trendBars()[idx] ?? null;
  };
  const distributionPeak = (): number =>
    usageVisibleRows().rows.reduce((max, row) => Math.max(max, row.tokens), 0);
  const localizedDayAxis = (): string[] => {
    const labels = weekdayShortLabels(true);
    return [labels[0] ?? "Mon", "", labels[2] ?? "Wed", "", labels[4] ?? "Fri", "", ""];
  };

  return (
    <View style={{ gap: layout.sectionGap }}>
      <SettingsSection
        title={tr("settings.usage.title")}
        flush={true}
        subtitle={tr("settings.usage.subtitle")}
        notice={usageNotice()}
        onDismissNotice={() => usageNotice.set("")}
        extra={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, maxWidth: "100%" }}>
            <Scroll horizontal style={{ maxWidth: "100%", flexShrink: 1 }}>
              <SegmentedTabs
                size="sm"
                value={usageRange()}
                options={USAGE_RANGES.map(range => ({
                  value: range.value,
                  label: USAGE_RANGE_KEYS[range.value] ? tr(USAGE_RANGE_KEYS[range.value]) : range.label,
                  accessibilityLabel: `usage-range-${range.value}`,
                }))}
                onChange={value => void chooseUsageRange(value)}
              />
            </Scroll>
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("settings.usage.reload")}
              accessibilityLabel="usage-reload"
              onPress={() => void loadUsage(true)}
            />
          </View>
        }
      >
        <If when={usageUnsupported()}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.md, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("settings.usage.unsupported")}</Text>
          </View>
        </If>
        <If when={!usageUnsupported() && !usageTotals() && !usageNotice()}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.md, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
          </View>
        </If>
        <If when={usageTotals()}>
          {totals => (
            <View
              style={{
                minHeight: SETTINGS_ROW_MIN,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: space.lg,
                rowGap: space.sm,
              }}
            >
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: space.hair }}>
                <Text style={textStyle("body", { tabular: true })}>
                  {tr("settings.usage.summaryRequestsTokens", {
                    requests: formatCount(totals().requests),
                    tokens: formatTokens(totals().tokens),
                  })}
                </Text>
                <Text style={textStyle("caption", { tabular: true })}>
                  {tr("settings.usage.tokenBreakdown", {
                    input: formatTokens(totals().inputTokens),
                    output: formatTokens(totals().outputTokens),
                    cached: formatTokens(totals().cachedTokens),
                    cacheWrites: formatTokens(totals().cacheWriteTokens),
                  })}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: space.hair, marginLeft: "auto", flexShrink: 0 }}>
                <If when={hitRate()}>
                  {rate => (
                    <Text style={{ ...textStyle("label", { color: palette().textSecondary, tabular: true }), fontWeight: "400" }}>
                      {tr("settings.usage.cacheHitRate", { rate: rate() })}
                    </Text>
                  )}
                </If>
                <If when={totals().failedRequests > 0 || totals().unknownRequests > 0}>
                  <Text
                    style={textStyle("caption", {
                      color: totals().failedRequests > 0 ? stateColor("needs_you") : palette().textMuted,
                      tabular: true,
                    })}
                  >
                    {tr("settings.usage.failedUnknown", {
                      failed: totals().failedRequests,
                      unknown: totals().unknownRequests,
                    })}
                  </Text>
                </If>
              </View>
            </View>
          )}
        </If>
      </SettingsSection>

      {/* Six-month activity heatmap: every cell is one host bucket. */}
      <View style={{ minWidth: 0 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: space.sm,
            minHeight: space.xl,
            marginBottom: space.sm,
            paddingHorizontal: space.xs,
          }}
        >
          <Text role="header" style={textStyle("label", { tabular: true, color: palette().textSecondary })}>
            {tr("settings.usage.activityHeading", {
              span: activitySpan() || tr("settings.usage.lastSixMonths"),
            })}
          </Text>
          <If when={Boolean(usageActivity())}>
            <Text
              style={{
                ...textStyle("caption", {
                  color: hoveredActivityDay() ? palette().text : palette().textMuted,
                  tabular: true,
                }),
                fontWeight: hoveredActivityDay() ? "600" : "400",
              }}
            >
              {hoveredActivityDay()
                ? tr("settings.usage.dayTokens", {
                    date: hoveredActivityDay()!.dateKey,
                    tokens: formatTokens(hoveredActivityDay()!.tokens) || "0",
                  })
                : tr("settings.usage.hoverToInspect")}
            </Text>
          </If>
        </View>
        <View style={[insetGroupStyle(space.lg), { gap: space.md }]}>
          <If when={usageActivity()}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ width: 28, height: HEATMAP_HEIGHT, flexShrink: 0, justifyContent: "space-between" }}>
                <Each of={localizedDayAxis()} key="index">
                  {label => (
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      <Text style={textStyle("micro")}>
                        {label()}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
              <Scroll horizontal style={{ flex: 1, minWidth: 0 }}>
                <Plot<UsageHeatmapPlotRow>
                  data={usageHeatmapPlotData().rows}
                  xScale={{
                    type: "band",
                    domain: usageHeatmapPlotData().weeks,
                    paddingInner: HEATMAP_PADDING_INNER,
                    paddingOuter: 0,
                  }}
                  yScale={{
                    type: "band",
                    domain: [...USAGE_DAY_ROWS],
                    paddingInner: HEATMAP_PADDING_INNER,
                    paddingOuter: 0,
                  }}
                  colorScale={{
                    type: "ordinal",
                    domain: ["0", "1", "2", "3", "4"],
                    range: usageHeatmapStepColors(),
                  }}
                  accessibilityLabel="usage-activity-heatmap"
                  onHoverChange={event => hoveredUsageActivityIdx.set(event.index)}
                  style={{
                    width: heatmapPlotWidth(usageHeatmapPlotData().weeks.length),
                    height: HEATMAP_HEIGHT,
                  }}
                >
                  <Cell
                    x="weekKey"
                    y="dow"
                    color="levelKey"
                    cornerRadii={radii.xs}
                    hoverCellStyle={{
                      borderWidth: 1.5,
                      borderColor: palette().text,
                      borderRadius: radii.xs,
                    }}
                  />
                </Plot>
              </Scroll>
            </View>
          </If>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: space.sm,
            }}
          >
            <Text style={textStyle("caption")}>
              {activityTotal()
                ? isLightAppearance()
                  ? tr("settings.usage.heatmapCaptionLightWithTotal", { total: activityTotal() })
                  : tr("settings.usage.heatmapCaptionDarkWithTotal", { total: activityTotal() })
                : isLightAppearance()
                  ? tr("settings.usage.heatmapCaptionLight")
                  : tr("settings.usage.heatmapCaptionDark")}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.xs }}>
              <Text style={textStyle("micro")}>{tr("common.less")}</Text>
              <Each of={[0, 1, 2, 3, 4]} key={lvl => String(lvl)}>
                {lvl => (
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: radii.xs,
                      backgroundColor: usageHeatmapStepColors()[lvl()],
                    }}
                  />
                )}
              </Each>
              <Text style={textStyle("micro")}>{tr("common.more")}</Text>
            </View>
          </View>
          <If when={usageActivityNotice()}>
            {notice => (
              <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                {localizeHostError(notice())}
              </Text>
            )}
          </If>
        </View>
      </View>

      <If when={trendBars().length > 0}>
        <View style={{ minWidth: 0 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: space.sm,
              minHeight: space.xl,
              marginBottom: space.sm,
              paddingHorizontal: space.xs,
            }}
          >
            <Text role="header" style={textStyle("label", { tabular: true, color: palette().textSecondary })}>
              {hourly()
                ? tr("settings.usage.trendHours", { count: trendBars().length })
                : tr("settings.usage.trendDays", { count: trendBars().length })}
            </Text>
            <If
              when={hoveredTrendRow()}
              else={
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: radii.xs,
                        backgroundColor: palette().accent,
                      }}
                    />
                    <Text style={textStyle("micro")}>{tr("settings.usage.output")}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: radii.xs,
                        backgroundColor: palette().accentBorder,
                      }}
                    />
                    <Text style={textStyle("micro")}>{tr("settings.usage.input")}</Text>
                  </View>
                </View>
              }
            >
              {row => (
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().text, tabular: true }),
                    fontWeight: "600",
                  }}
                >
                  {tr("settings.usage.trendHover", {
                    bucket: formatBucket(row().bucket, hourly()),
                    input: formatTokens(row().inputTokens) || "0",
                    output: formatTokens(row().outputTokens) || "0",
                    total: formatTokens(row().totalTokens) || "0",
                  })}
                </Text>
              )}
            </If>
          </View>
          <View style={insetGroupStyle(space.md)}>
            <View style={{ paddingLeft: 48, paddingRight: space.sm, paddingTop: space.sm, paddingBottom: space.xl }}>
              <Plot<UsageTrendPlotRow>
                data={trendBars()}
                xScale={{
                  type: "band",
                  paddingInner: 0.38,
                  paddingOuter: 0.14,
                  maxBandWidth: 40,
                }}
                yScale={{
                  type: "linear",
                  domain: trendBars().some(b => b.totalTokens > 0) ? undefined : [0, 1],
                }}
                crossLineStyle={{
                  backgroundColor: palette().surfaceSubtle,
                  borderRadius: radii.xs,
                }}
                accessibilityLabel="usage-trend-chart"
                onHoverChange={event => hoveredUsageTrendIdx.set(event.index)}
                style={{ width: "100%", height: 140 }}
              >
                <Grid
                  ticks={4}
                  style={{
                    stroke: palette().borderSubtle,
                    strokeWidth: 1,
                    strokeDasharray: "3 3",
                  }}
                />
                <PlotAxis
                  placement="left"
                  ticks={4}
                  format={value => (value <= 0 ? "0" : formatTokens(value))}
                  labelStyle={{
                    ...textStyle("micro", { tabular: true }),
                    paddingRight: space.sm,
                  }}
                />
                <PlotAxis
                  placement="bottom"
                  ticks={Math.min(6, Math.max(1, trendBars().length))}
                  format={value => {
                    const row = trendBars()[Math.round(value)];
                    return row ? row.shortLabel : "";
                  }}
                  labelStyle={{
                    ...textStyle("micro", { tabular: true }),
                    paddingTop: space.sm,
                  }}
                />
                <Bar
                  stack="tokens"
                  value="inputTokens"
                  cornerRadii={{ bottomLeft: radii.xs, bottomRight: radii.xs }}
                  inactiveOpacity={0.42}
                  style={{ fill: palette().accentBorder }}
                />
                <Bar
                  stack="tokens"
                  value="outputTokens"
                  cornerRadii={{ topLeft: radii.xs, topRight: radii.xs }}
                  inactiveOpacity={0.42}
                  style={{ fill: palette().accent }}
                />
              </Plot>
            </View>
          </View>
        </View>
      </If>

      <If when={usageModels().length > 0 || usageGroups().length > 0}>
        <View style={{ minWidth: 0, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <SegmentedTabs
              size="sm"
              value={usageDistribution()}
              options={USAGE_DISTRIBUTIONS.map(kind => ({
                value: kind.value,
                label: USAGE_DISTRIBUTION_KEYS[kind.value]
                  ? tr(USAGE_DISTRIBUTION_KEYS[kind.value])
                  : kind.label,
                accessibilityLabel: `usage-distribution-${kind.value}`,
              }))}
              onChange={value => chooseUsageDistribution(value)}
            />
            <View style={{ minWidth: 190, maxWidth: 240, flexShrink: 1 }}>
              <SearchInput
                size="sm"
                value={usageEntryFilter()}
                onChange={setUsageEntryFilter}
                placeholder={tr("settings.usage.filterRows")}
                accessibilityLabel="usage-entry-filter"
              />
            </View>
          </View>
          <If when={usageVisibleRows().total === 0}>
            <SectionFootnote text={tr("settings.usage.noMatchingRows")} />
          </If>
          <If when={usageVisibleRows().rows.length > 0}>
            <View style={insetGroupStyle()}>
              <Each of={usageVisibleRows().rows} key="index">
                {(entry, index) => (
                  <View
                    style={{
                      gap: 6,
                      paddingHorizontal: SETTINGS_ROW_INSET,
                      paddingVertical: 10,
                      minHeight: SETTINGS_ROW_MIN,
                      justifyContent: "center",
                      position: "relative",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                  >
                    <If when={index() !== 0}>
                      <RowSeparator edge="top" />
                    </If>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(14),
                          lineHeight: textLineHeight(14, 1.38),
                          flex: 1,
                          minWidth: 0,
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {`${entry().name}${entry().providerName ? ` · ${entry().providerName}` : ""}`}
                      </Text>
                      <Text
                        style={{
                          flexShrink: 0,
                          color: palette().textSecondary,
                          fontSize: textSize(12),
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {tr("settings.usage.rowMetrics", {
                          requests: formatCount(entry().requests),
                          tokens: formatTokens(entry().tokens),
                        })}
                      </Text>
                      <If when={entry().cacheHitRate !== null}>
                        <Text
                          style={{
                            flexShrink: 0,
                            color: palette().textMuted,
                            fontSize: textSize(12),
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {tr("settings.usage.cacheBadge", {
                            rate: formatPercent(entry().cacheHitRate, 0),
                          })}
                        </Text>
                      </If>
                    </View>
                    <View
                      style={{
                        height: 3,
                        borderRadius: radii.pill,
                        backgroundColor: palette().segmentedTrackBg,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: "100%",
                          width: `${distributionPeak() > 0 ? Math.max(2, Math.round((entry().tokens / distributionPeak()) * 100)) : 0}%`,
                          borderRadius: radii.pill,
                          backgroundColor: palette().accent,
                          opacity: 0.82,
                        }}
                      />
                    </View>
                  </View>
                )}
              </Each>
            </View>
          </If>
          <If when={usageVisibleRows().hidden}>
            <View style={{ alignItems: "flex-start" }}>
              <Button
                label={
                  usageExpanded()
                    ? tr("common.showLess")
                    : tr("settings.usage.showAllCount", { count: usageVisibleRows().total })
                }
                variant="secondary"
                size="sm"
                accessibilityLabel="usage-distribution-expand"
                onPress={toggleUsageExpanded}
              />
            </View>
          </If>
        </View>
      </If>

      <If when={usageEndpoints().length > 0}>
        <View style={{ minWidth: 0 }}>
          <SectionHeader title={tr("settings.usage.byEndpoint")} />
          <View style={insetGroupStyle()}>
            <Each of={usageEndpoints()} key="index">
              {(endpoint, index) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: SETTINGS_ROW_INSET,
                    paddingVertical: 10,
                    minHeight: SETTINGS_ROW_MIN,
                    position: "relative",
                  }}
                >
                  <If when={index() !== 0}>
                    <RowSeparator edge="top" />
                  </If>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(14),
                      lineHeight: textLineHeight(14, 1.38),
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {`${endpoint().name}${endpoint().providerName ? ` · ${endpoint().providerName}` : ""}`}
                  </Text>
                  <Text style={textStyle("caption", { tabular: true })}>
                    {tr("settings.usage.rowMetrics", {
                      requests: formatCount(endpoint().requests),
                      tokens: formatTokens(endpoint().tokens),
                    })}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </View>
      </If>

      <If when={usageBuckets().length > 0}>
        <View style={{ minWidth: 0 }}>
          <SectionHeader title={hourly() ? tr("settings.usage.byHour") : tr("settings.usage.byDay")} />
          <View style={insetGroupStyle()}>
            <Each of={usageBuckets().slice(-12)} key={bucket => bucket.bucket}>
              {(bucket, index) => (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: SETTINGS_ROW_INSET,
                    paddingVertical: space.md,
                    minHeight: SETTINGS_ROW_MIN,
                    position: "relative",
                  }}
                >
                  <If when={index() !== 0}>
                    <RowSeparator edge="top" />
                  </If>
                  <Text
                    style={{
                      ...textStyle("mono", { color: palette().textMuted, tabular: true }),
                      minWidth: 112,
                      flexShrink: 0,
                    }}
                  >
                    {formatBucket(bucket().bucket, hourly())}
                  </Text>
                  <Text
                    style={{
                      ...textStyle("caption", { color: palette().text, tabular: true }),
                      flex: 1,
                      minWidth: 160,
                    }}
                  >
                    {tr("settings.usage.bucketBreakdown", {
                      input: formatTokens(bucket().inputTokens),
                      output: formatTokens(bucket().outputTokens),
                      cached: formatTokens(bucket().cachedTokens),
                    })}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </View>
      </If>
    </View>
  );
}

function TaskModelsSection() {
  useDeviceScopedLoad("task-models", ensureTaskModels, () => void loadTaskModels());
  const valueOf = (task: string): string => {
    const choice: TaskModelChoice = taskModels()[task] ?? { kind: "inherit", modelId: "" };
    return choice.kind === "inherit" ? "inherit" : choice.modelId;
  };
  const optionsFor = (task: string) => {
    const rows: Array<{ value: string; label: string; description?: string; accessibilityLabel: string }> = [
      {
        value: "inherit",
        label: tr("settings.taskModels.inheritsSession"),
        accessibilityLabel: `task-model-inherit-${task}`,
      },
      { value: "primary", label: tr("settings.field.primaryRole"), accessibilityLabel: `task-model-choice-${task}-primary` },
      { value: "fast", label: tr("settings.field.fastRole"), accessibilityLabel: `task-model-choice-${task}-fast` },
      ...selectableChatModels().map(model => ({
        value: model.id,
        label: modelOptionText(model),
        accessibilityLabel: `task-model-choice-${task}-${model.id}`,
      })),
    ];
    const current = valueOf(task);
    if (current && !rows.some(row => row.value === current)) {
      rows.push({
        value: current,
        label: tr("settings.field.notConfiguredSuffix", { name: current }),
        accessibilityLabel: `task-model-choice-${task}-${current}`,
      });
    }
    return rows;
  };
  // The section's notice already says the host stores none yet; rows keep their own line.
  const descriptionOf = (task: string, fallback: string): string =>
    TASK_MODEL_HINT_KEYS[task] ? tr(TASK_MODEL_HINT_KEYS[task]) : fallback;
  return (
    <If when={taskModelsSupported() !== false}>
      <SettingsGroup
        id="task-models"
        title={tr("settings.taskModels.title")}
        description={tr("settings.taskModels.subtitle")}
        notice={taskModelsNotice()}
        onDismissNotice={() => taskModelsNotice.set("")}
      >
        <If when={taskModelsSupported() === null}>
          <View style={{ padding: space.lg }}>
            <Text style={textStyle("caption")}>{tr("settings.taskModels.reading")}</Text>
          </View>
        </If>
        <If when={taskModelsSupported() === true}>
          <Each of={TASK_MODEL_ROWS} key={row => row.id}>
            {(row, index) => (
              <SettingsRow
                label={TASK_MODEL_KEYS[row().id] ? tr(TASK_MODEL_KEYS[row().id]) : row().label}
                description={descriptionOf(row().id, row().hint)}
                first={index() === 0}
              >
                <SelectDropdown
                  size="sm"
                  value={valueOf(row().id)}
                  options={optionsFor(row().id)}
                  searchable={optionsFor(row().id).length > 8}
                  accessibilityLabel={`task-model-${row().id}`}
                  minWidth={settingsCompact() ? NUMBER_STEPPER_WIDTH : 220}
                  maxWidth={settingsCompact() ? undefined : 300}
                  align="end"
                  onChange={value =>
                    void chooseTaskModel(
                      row().id,
                      value === "inherit" ? { kind: "inherit", modelId: "" } : { kind: "fixed", modelId: value },
                    )
                  }
                />
              </SettingsRow>
            )}
          </Each>
        </If>
      </SettingsGroup>
    </If>
  );
}

function ModelRow(props: { model: () => ReturnType<typeof storedModels>[number]; index: () => number }) {
  const compactMeta = (): string => {
    const m = props.model();
    // The model leads the row already; the meta line names it only when it differs.
    const parts: string[] = m.model_name === modelOptionLabel(m) ? [] : [m.model_name];
    if (m.context_window) {
      parts.push(
        tr("settings.models.ctxCompact", { value: formatTokens(m.context_window) }),
      );
    }
    if (m.max_tokens) {
      parts.push(
        tr("settings.models.outCompact", { value: formatTokens(m.max_tokens) }),
      );
    }
    return parts.filter(Boolean).join(" · ");
  };
  const outcome = () => modelTestOutcomes()[props.model().id] ?? { status: "idle" as const };
  const testing = (): boolean => outcome().status === "testing";
  const disabled = () => props.model().enabled === false;
  const menuKey = () => `model-${props.model().id}`;
  return (
    <View
      style={{
        gap: space.sm,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        position: "relative",
        opacity: disabled() ? 0.62 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <If when={props.index() !== 0}>
        <RowSeparator edge="top" />
      </If>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: space.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, minWidth: 0 }}>
            <Text
              style={{
                ...textStyle("body"),
                flexShrink: 1,
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {modelOptionLabel(props.model())}
            </Text>
            <If when={modelOptionDetail(props.model())}>
              <Text style={textStyle("caption")}>
                {modelOptionDetail(props.model())}
              </Text>
            </If>
            <If when={outcome().status === "testing"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Spinner size={11} color={palette().accent} />
                <Text style={textStyle("micro")}>{tr("common.testing")}</Text>
              </View>
            </If>
            <If when={outcome().status === "success"}>
              <Text style={textStyle("caption", { color: palette().textSecondary })}>
                {outcome().message || tr("common.connected")}
              </Text>
            </If>
            <If when={outcome().status === "error"}>
              <Text style={textStyle("caption", { color: stateColor("failed") })}>
                {tr("common.failed")}
              </Text>
            </If>
          </View>
          <Text
            style={{
              ...textStyle("caption", { color: palette().textMuted, tabular: true }),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {compactMeta()}
          </Text>
          <If when={outcome().status === "error" && outcome().errorDetails ? outcome().errorDetails! : ""}>
            {detail => (
              <Text style={textStyle("caption", { color: stateColor("failed") })}>
                {localizeHostError(detail())}
              </Text>
            )}
          </If>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.sm, marginLeft: "auto" }}>
          <Button
            label={testing() ? tr("common.testing") : tr("common.test")}
            variant="secondary"
            size="sm"
            disabled={testing()}
            accessibilityLabel={`model-test-${props.model().id}`}
            onPress={() => void testSavedModelConnection(props.model())}
          />
          <ToggleSwitch
            checked={!disabled()}
            accessibilityLabel={`model-enabled-${props.model().id}`}
            onChange={next => void setModelEnabled(props.model().id, next)}
          />
          <View ref={el => setRowAnchor(menuKey(), el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              tooltip={tr("settings.models.options")}
              accessibilityLabel={`model-actions-${props.model().id}`}
              onPress={() => rowMenuId.set(rowMenuId() === menuKey() ? null : menuKey())}
            />
          </View>
        </View>
        <DropdownMenu
          open={rowMenuId() === menuKey()}
          anchor={rowMenuAnchors()[menuKey()] ?? null}
          onClose={() => rowMenuId.set(null)}
          items={[
            {
              id: "edit",
              label: tr("common.edit"),
              icon: "edit",
              accessibilityLabel: `model-edit-${props.model().id}`,
              onSelect: () => {
                rowMenuId.set(null);
                resetRemoteDiscovery();
                openModelEditor(props.model().id);
              },
            },
            {
              id: "limits",
              label: tr("settings.models.editLimits"),
              icon: "sliders",
              accessibilityLabel: `model-limits-${props.model().id}`,
              onSelect: () => {
                rowMenuId.set(null);
                openModelLimits(props.model().id);
              },
            },
            {
              id: "remove",
              label: tr("settings.models.removeModel"),
              icon: "trash",
              danger: true,
              confirmDelete: true,
              confirmAccessibilityLabel: `model-delete-confirm-${props.model().id}`,
              accessibilityLabel: `remove-model-${props.model().id}`,
              onSelect: () => {
                rowMenuId.set(null);
                requestModelDelete(null);
                void deleteModel(props.model().id);
              },
            },
          ]}
        />
      </View>
    </View>
  );
}

function ModelFormField(props: {
  label: string;
  value: string;
  placeholder: string;
  secret?: boolean;
  monospace?: boolean;
  accessibilityLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputBox
      label={props.label}
      size="md"
      value={props.value}
      placeholder={props.placeholder}
      masked={props.secret === true}
      monospace={props.monospace}
      accessibilityLabel={props.accessibilityLabel}
      onChange={props.onChange}
    />
  );
}

function LogFilesSection() {
  useDeviceScopedLoad("logging", ensureRuntimeLogging, () => void loadRuntimeLogging());
  return (
    <SettingsSection
      title={tr("settings.logs.title")}
      flush={true}
      subtitle={tr("settings.logs.subtitle")}
      notice={loggingNotice()}
      onDismissNotice={() => loggingNotice.set("")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("settings.logs.reload")}
            accessibilityLabel="logging-reload"
            onPress={() => void loadRuntimeLogging()}
          />
        </View>
      }
    >
      <View>
        <If when={runtimeLogging()}>
          {info => (
            <View>
              <SettingsConfigRow
                label={tr("settings.logs.effectiveLevel", {
                  level: info().effectiveLevel || tr("common.unknown").toLowerCase(),
                })}
              />
              <View
                style={{
                  gap: space.xs,
                  minHeight: SETTINGS_ROW_MIN,
                  justifyContent: "center",
                  paddingHorizontal: SETTINGS_ROW_INSET,
                  paddingVertical: space.md,
                }}
              >
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textSecondary }),
                    minWidth: 0,
                    numberOfLines: 2,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {info().sessionLogDir || tr("settings.logs.noFolder")}
                </Text>
                <If when={info().appLogPath}>
                  {path => (
                    <Text
                      style={{
                        ...textStyle("mono", { color: palette().textMuted }),
                        minWidth: 0,
                        numberOfLines: 2,
                        textOverflow: "ellipsis-middle",
                      }}
                    >
                      {path()}
                    </Text>
                  )}
                </If>
              </View>
              <If when={info().previousCrash}>
                {crash => (
                  <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingBottom: 10 }}>
                  <InlineBanner
                    tone="warning"
                    message={tr("settings.logs.previousCrash", {
                      category: crash().category || tr("common.unknown").toLowerCase(),
                      dir: crash().sessionLogDir || tr("settings.logs.thatFolder"),
                    })}
                  />
                  </View>
                )}
              </If>
              <View
                style={{
                  position: "relative",
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  minHeight: SETTINGS_ROW_MIN,
                  paddingHorizontal: SETTINGS_ROW_INSET,
                  paddingVertical: 8,
                }}
              >
                <RowSeparator edge="top" />
                <Button
                  label={
                    loggingBusy() === "reveal"
                      ? tr("settings.logs.opening")
                      : tr("settings.logs.openFolder")
                  }
                  variant="secondary"
                  size="sm"
                  leadingIcon="folder-open"
                  accessibilityLabel="logging-open-folder"
                  onPress={() => void revealLogFolder()}
                />
                <Button
                  label={
                    loggingBusy() === "export"
                      ? tr("settings.logs.exporting")
                      : tr("settings.logs.exportBundle")
                  }
                  variant="primary"
                  size="sm"
                  accessibilityLabel="logging-export"
                  onPress={() => diagnosticsExportPending.set(true)}
                />
              </View>
            </View>
          )}
        </If>
        <If when={diagnosticsExportPending()}>
          <View
            testID="logging-export-confirm"
            style={{ position: "relative", paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: 12, gap: 8 }}
          >
            <RowSeparator edge="top" />
            <Text style={textStyle("label")}>{tr("settings.logs.exportConfirmTitle")}</Text>
            <InlineConfirmBar
              message={
                settingsValues()["app.logging.include_sensitive_diagnostics"] === true
                  ? tr("settings.logs.exportConfirmSensitive")
                  : tr("settings.logs.exportConfirmStandard")
              }
              confirmLabel={tr("settings.logs.exportConfirmAction")}
              danger={settingsValues()["app.logging.include_sensitive_diagnostics"] === true}
              onConfirm={() => {
                diagnosticsExportPending.set(false);
                void exportDiagnosticsBundle();
              }}
              onCancel={() => diagnosticsExportPending.set(false)}
            />
          </View>
        </If>
        <If when={!runtimeLogging()}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: 12, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("settings.logs.noLocation")}</Text>
          </View>
        </If>
      </View>
    </SettingsSection>
  );
}


function quotaPeriodLabel(seconds: number | undefined): string {
  if (!seconds) return "";
  if (seconds === 7 * 86400) return tr("settings.subscriptions.windowWeekly");
  if (seconds === 30 * 86400) return tr("settings.subscriptions.windowMonthly");
  if (seconds === 86400) return tr("settings.subscriptions.windowDaily");
  if (seconds === 5 * 3600) return tr("settings.subscriptions.window5h");
  if (seconds < 3600) return tr("settings.subscriptions.periodMinutes", { count: Math.round(seconds / 60) });
  if (seconds < 86400) return tr("settings.subscriptions.periodHours", { count: Math.round(seconds / 3600) });
  return tr("settings.subscriptions.periodDays", { count: Math.round(seconds / 86400) });
}

/** One meter as the desktop's quota panel names it: vendor name, period, percent left, reset. */
function formatQuotaMeter(meter: QuotaMeterRow): string {
  const period = quotaPeriodLabel(meter.durationSeconds);
  const vendorName =
    meter.id === "on-demand"
      ? tr("settings.subscriptions.onDemand")
      : currentLocale() === "en-US" || !meter.name
        ? meter.name
        : localizeQuotaWindowLabel(meter.name, "settings.subscriptions.primaryWindow");
  const name =
    vendorName ||
    (meter.secondary ? tr("settings.subscriptions.mcp") : period ? "" : tr("settings.subscriptions.allowance"));
  const parts: string[] = [[name, period].filter(Boolean).join(" · ")];
  if (meter.unlimited) {
    parts.push(tr("settings.subscriptions.unlimited"));
  } else if (meter.remainingPercent !== null) {
    parts.push(tr("settings.subscriptions.percentLeft", { percent: meter.remainingPercent }));
  }
  if (meter.resetsAt !== null && String(meter.resetsAt).trim()) {
    parts.push(formatResetAt(meter.resetsAt));
  }
  return parts.filter(Boolean).join(" · ");
}

/** Why a connected account shows no meter: the host's own state, never a zero. */
function quotaUnknownText(quota: SubscriptionQuotaSummary | null): string {
  if (!quota) return "";
  if (quota.state === "unsupported") return tr("settings.subscriptions.quotaUnsupported");
  if (quota.state === "query_failed") return tr("settings.subscriptions.quotaFailed");
  return tr("settings.subscriptions.quotaUnknown");
}

function quotaBarColor(percent: number): string {
  if (percent < 15) return stateColor("failed");
  if (percent < 40) return stateColor("needs_you");
  return palette().accent;
}

/**
 * The sign-in in progress for one provider: what to do in the browser, the
 * device code when the provider uses one, the address when it could not be
 * opened here, and a way to stop it.
 */
function SubscriptionLoginPanel() {
  const login = () => subscriptionLogin();
  const statusText = (): string => {
    const current = login();
    if (!current) return "";
    if (current.status === "starting") return tr("settings.subscriptions.loginStarting");
    if (current.status === "pending") return current.instructions || tr("settings.subscriptions.loginPending");
    if (current.status === "authorized") return tr("settings.subscriptions.loginAuthorized");
    if (current.status === "cancelled") return tr("settings.subscriptions.loginCancelled");
    return current.error ? localizeHostError(current.error) : tr("settings.subscriptions.loginFailed");
  };
  return (
    <View
      style={{
        gap: space.sm,
        paddingLeft: space.lg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <If when={login()?.status === "pending" || login()?.status === "starting"}>
          <Spinner size={12} color={palette().accent} />
        </If>
        <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>{statusText()}</Text>
        <If when={login()?.status === "pending" || login()?.status === "starting"}>
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="sm"
            accessibilityLabel="subscription-login-cancel"
            onPress={() => void cancelSubscriptionSignIn()}
          />
        </If>
        <If when={login()?.status !== "pending" && login()?.status !== "starting"}>
          <IconButton
            icon="close"
            size="sm"
            tooltip={tr("common.close")}
            accessibilityLabel="subscription-login-dismiss"
            onPress={() => void cancelSubscriptionSignIn()}
          />
        </If>
      </View>
      <If when={login()?.userCode ?? ""}>
        {code => (
          <Text style={[textStyle("mono"), { fontSize: textSize(15), letterSpacing: 2 }]}>
            {tr("settings.subscriptions.loginCode", { code: code() })}
          </Text>
        )}
      </If>
      <If when={login()?.urlUnopened && login()?.authorizationUrl ? login()!.authorizationUrl! : ""}>
        {url => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text
              style={[textStyle("mono"), { flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis-middle" }]}
            >
              {url()}
            </Text>
            <Button
              label={tr("settings.subscriptions.copyAddress")}
              variant="secondary"
              size="sm"
              accessibilityLabel="subscription-login-copy"
              onPress={() => copySubscriptionLoginUrl()}
            />
          </View>
        )}
      </If>
    </View>
  );
}

const subscriptionSearchQuery = signal("");
const expandedSubscriptionMeters = signal<Record<string, boolean>>({});

function SubscriptionsSection() {
  useDeviceScopedLoad("subscriptions", () => void loadSubscriptions(), () => void loadSubscriptions(true));
  const filteredAccounts = () => {
    const query = subscriptionSearchQuery().trim().toLowerCase();
    const list = subscriptionAccounts();
    if (!query) return list;
    return list.filter(
      item =>
        (item.display_label || "").toLowerCase().includes(query) ||
        (item.provider || "").toLowerCase().includes(query) ||
        (item.account || "").toLowerCase().includes(query),
    );
  };
  const connectedAccounts = () => filteredAccounts().filter(item => item.connected);
  const availableAccounts = () => filteredAccounts().filter(item => !item.connected);
  const totalConnected = () => subscriptionAccounts().filter(item => item.connected).length;

  return (
    <If when={true}>
      <SettingsSection
        flush={true}
        title={tr("settings.subscriptions.title")}
        subtitle={tr("settings.subscriptions.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <If when={subscriptionAccounts().length > 0}>
              <Text style={textStyle("caption", { color: palette().textMuted, tabular: true })}>
                {`${totalConnected()} / ${subscriptionAccounts().length}`}
              </Text>
            </If>
            <If when={subscriptionsLoading()}>
              <Spinner size={13} color={palette().accent} />
            </If>
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("settings.subscriptions.refresh")}
              accessibilityLabel="subscriptions-refresh"
              onPress={() => void loadSubscriptions(true)}
            />
          </View>
        }
      >
        <View style={{ padding: SETTINGS_ROW_INSET, gap: space.md }}>
          <If when={subscriptionAccounts().length > 4}>
            <SearchInput
              value={subscriptionSearchQuery()}
              placeholder={tr("settings.subscriptions.searchPlaceholder")}
              accessibilityLabel="subscriptions-filter-search"
              onChange={value => subscriptionSearchQuery.set(value)}
            />
          </If>

          <If when={Boolean(subscriptionLogin())}>
            <SubscriptionLoginPanel />
          </If>

          <If when={!subscriptionsLoading() && subscriptionAccounts().length === 0}>
            <View style={{ paddingVertical: space.sm, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
              <Text style={textStyle("caption")}>{tr("settings.subscriptions.none")}</Text>
            </View>
          </If>

          <If when={subscriptionAccounts().length > 0 && filteredAccounts().length === 0}>
            <View style={{ paddingVertical: space.md }}>
              <Text style={textStyle("caption")}>{tr("settings.subscriptions.noFilterMatches")}</Text>
            </View>
          </If>

          {/* Connected subscriptions: compact cards with 2-column quota meters */}
          <If when={connectedAccounts().length > 0}>
            <View style={{ gap: space.sm }}>
              <Text style={{ ...textStyle("micro", { color: palette().textMuted }), fontWeight: "600" }}>
                {tr("settings.subscriptions.connectedGroup", { count: connectedAccounts().length })}
              </Text>
              <View style={{ gap: space.sm }}>
                <Each of={connectedAccounts()} key={item => item.account_id}>
                  {item => {
                    const quota = () => subscriptionQuotas()[item().account_id] ?? null;
                    const meters = () => quotaMeters(quota());
                    const showAllMeters = () => expandedSubscriptionMeters()[item().account_id] === true;
                    const visibleMeters = () => (showAllMeters() ? meters() : meters().slice(0, 2));
                    const hiddenMeterCount = () => Math.max(0, meters().length - 2);
                    return (
                      <View
                        style={{
                          gap: space.sm,
                          paddingHorizontal: space.md,
                          paddingVertical: space.md,
                          borderRadius: radii.md,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: item().reauthentication_required
                            ? palette().borderStrong
                            : palette().borderSubtle,
                          backgroundColor: palette().surfaceTertiary,
                          ...paintTransition(MOTION_DURATION.fast),
                        }}
                      >
                        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                          <If
                            when={Boolean(item().reauthentication_required)}
                            else={<StatusDot kind="success" />}
                          >
                            <StateMark state="needs_you" size={12} />
                          </If>
                          <View style={{ flex: 1, minWidth: 140, gap: space.hair }}>
                            <Text
                              style={{
                                ...textStyle("body"),
                                fontWeight: "500",
                                numberOfLines: 1,
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item().display_label || item().provider}
                            </Text>
                            <If when={item().account || quota()?.plan}>
                              <Text
                                style={{
                                  ...textStyle("caption"),
                                  numberOfLines: 1,
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {[item().account, quota()?.plan].filter(Boolean).join(" · ")}
                              </Text>
                            </If>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                            <If when={Boolean(item().reauthentication_required)}>
                              <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                                {tr("settings.subscriptions.reauthNeeded")}
                              </Text>
                              <Button
                                label={tr("settings.subscriptions.signInAgain")}
                                variant="secondary"
                                size="xs"
                                leadingIcon="log-in"
                                disabled={
                                  (subscriptionLogin()?.accountId === (item().account_id || item().provider)) &&
                                  (subscriptionLogin()?.status === "pending" || subscriptionLogin()?.status === "starting")
                                }
                                accessibilityLabel={`subscription-connect-${item().account_id || item().provider}`}
                                onPress={() =>
                                  void startSubscriptionSignIn(
                                    item().provider,
                                    isRemotePeerContext(),
                                    item().login_methods ?? [],
                                    item().account_id || item().provider,
                                  )
                                }
                              />
                            </If>
                            <Button
                              label={tr("devices.signOut")}
                              variant="ghost"
                              size="xs"
                              loading={subscriptionSigningOut() === (item().account_id || item().provider)}
                              disabled={subscriptionSigningOut() === (item().account_id || item().provider)}
                              accessibilityLabel={`subscription-signout-${item().account_id || item().provider}`}
                              onPress={() =>
                                void signOutSubscriptionAccount(item().provider, item().account_id || undefined)
                              }
                            />
                          </View>
                        </View>

                        <If when={visibleMeters().length > 0}>
                          <View
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                settingsCompact() || visibleMeters().length === 1
                                  ? "minmax(0, 1fr)"
                                  : "repeat(2, minmax(0, 1fr))",
                              gap: space.md,
                              paddingTop: space.xs,
                            }}
                          >
                            <Each of={visibleMeters()} key={meter => meter.id}>
                              {meter => (
                                <View style={{ gap: space.xs, minWidth: 0 }}>
                                  <Text
                                    style={{
                                      ...textStyle("caption", { color: palette().textSecondary, tabular: true }),
                                      fontWeight: "500",
                                      numberOfLines: 1,
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {formatQuotaMeter(meter())}
                                  </Text>
                                  <If when={meter().remainingPercent !== null}>
                                    <View
                                      style={{
                                        height: 4,
                                        borderRadius: radii.pill,
                                        backgroundColor: palette().segmentedTrackBg,
                                        overflow: "hidden",
                                      }}
                                    >
                                      <View
                                        style={{
                                          height: "100%",
                                          width: `${meter().remainingPercent ?? 0}%`,
                                          borderRadius: radii.pill,
                                          backgroundColor: quotaBarColor(meter().remainingPercent ?? 0),
                                        }}
                                      />
                                    </View>
                                  </If>
                                </View>
                              )}
                            </Each>
                          </View>
                        </If>

                        <If when={hiddenMeterCount() > 0}>
                          <View style={{ flexDirection: "row" }}>
                            <Button
                              label={
                                showAllMeters()
                                  ? tr("settings.subscriptions.fewerMeters")
                                  : tr("settings.subscriptions.moreMeters", { count: hiddenMeterCount() })
                              }
                              variant="ghost"
                              size="xs"
                              onPress={() =>
                                expandedSubscriptionMeters.update(curr => ({
                                  ...curr,
                                  [item().account_id]: !showAllMeters(),
                                }))
                              }
                            />
                          </View>
                        </If>

                        <If when={quota() && meters().length === 0 ? quotaUnknownText(quota()) : ""}>
                          {text => <Text style={textStyle("caption")}>{text()}</Text>}
                        </If>
                      </View>
                    );
                  }}
                </Each>
              </View>
            </View>
          </If>

          {/* Disconnected / available providers: compact 2-column card grid so 10+ providers stay scannable */}
          <If when={availableAccounts().length > 0}>
            <View style={{ gap: space.sm }}>
              <Text style={{ ...textStyle("micro", { color: palette().textMuted }), fontWeight: "600" }}>
                {tr("settings.subscriptions.availableGroup", { count: availableAccounts().length })}
              </Text>
              <View
                style={{
                  display: "grid",
                  gridTemplateColumns: settingsCompact() ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                  gap: space.sm,
                }}
              >
                <Each of={availableAccounts()} key={item => item.account_id}>
                  {item => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        minHeight: 54,
                        borderRadius: radii.md,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().surfaceTertiary,
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{
                        backgroundColor: palette().surfaceSubtle,
                        borderColor: palette().borderStrong,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text
                          style={{
                            ...textStyle("body"),
                            fontWeight: "500",
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item().display_label || item().provider}
                        </Text>
                        <Text
                          style={{
                            ...textStyle("caption"),
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {tr("common.disconnected")}
                        </Text>
                      </View>
                      <Button
                        label={tr("settings.subscriptions.signIn")}
                        variant="secondary"
                        size="xs"
                        leadingIcon="log-in"
                        disabled={
                          (subscriptionLogin()?.accountId === (item().account_id || item().provider)) &&
                          (subscriptionLogin()?.status === "pending" || subscriptionLogin()?.status === "starting")
                        }
                        accessibilityLabel={`subscription-connect-${item().account_id || item().provider}`}
                        onPress={() =>
                          void startSubscriptionSignIn(
                            item().provider,
                            isRemotePeerContext(),
                            item().login_methods ?? [],
                            item().account_id || item().provider,
                          )
                        }
                      />
                    </View>
                  )}
                </Each>
              </View>
            </View>
          </If>
        </View>
      </SettingsSection>
    </If>
  );
}

interface ModelProviderGroup {
  key: string;
  label: string;
  host: string;
  format: string;
  baseUrl: string;
  models: ReturnType<typeof storedModels>;
  enabledCount: number;
  hasPrimary: boolean;
}

const KNOWN_PROVIDER_HOST_LABELS: Record<string, string> = {
  "api.openai.com": "OpenAI",
  "api.anthropic.com": "Anthropic",
  "generativelanguage.googleapis.com": "Google Gemini",
  "api.deepseek.com": "DeepSeek",
  "openrouter.ai": "OpenRouter",
  "api.groq.com": "Groq",
  "api.mistral.ai": "Mistral",
  "api.x.ai": "xAI",
  "dashscope.aliyuncs.com": "Alibaba Qwen",
  "ark.cn-beijing.volces.com": "Volcengine Ark",
  "open.bigmodel.cn": "Zhipu GLM",
  "api.moonshot.cn": "Moonshot Kimi",
  "api.minimax.chat": "MiniMax",
  "api.siliconflow.cn": "SiliconFlow",
};

const FORMAT_DISPLAY_LABELS: Record<string, string> = {
  openai: "OpenAI",
  responses: "OpenAI Responses",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

function endpointHostOf(rawUrl: string | undefined): string {
  const trimmed = (rawUrl ?? "").trim().replace(/#$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.host.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";
  }
}

function providerLabelFor(format: string, host: string): string {
  if (host) {
    const known = KNOWN_PROVIDER_HOST_LABELS[host];
    if (known) return known;
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return `Local (${host})`;
    const catalogMatch = catalogProviders().find(provider =>
      provider.endpoints.some(ep => endpointHostOf(ep.baseUrl) === host),
    );
    if (catalogMatch?.name) return catalogMatch.name;
    return host;
  }
  return FORMAT_DISPLAY_LABELS[format] ?? (format || tr("settings.models.customProvider"));
}

const modelSearchQuery = signal("");
const modelStatusFilter = signal<"all" | "enabled">("all");
const providerGroupExpanded = signal<Record<string, boolean>>({});

function groupModelsByProvider(
  models: ReturnType<typeof storedModels>,
  primaryId: string | null | undefined,
): ModelProviderGroup[] {
  const byKey = new Map<string, ModelProviderGroup>();
  const order: string[] = [];
  for (const model of models) {
    const format = normalizeModelFormat(model.provider);
    const host = endpointHostOf(model.base_url);
    const key = `${format}-${host || "default"}`.replace(/[^a-z0-9.-]+/g, "-");
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: providerLabelFor(format, host),
        host,
        format,
        baseUrl: (model.base_url ?? "").trim(),
        models: [],
        enabledCount: 0,
        hasPrimary: false,
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.models.push(model);
    if (model.enabled !== false) group.enabledCount += 1;
    if (primaryId && model.id === primaryId) group.hasPrimary = true;
  }
  return order
    .map(key => byKey.get(key)!)
    .sort((a, b) => {
      if (a.hasPrimary !== b.hasPrimary) return a.hasPrimary ? -1 : 1;
      if ((a.enabledCount > 0) !== (b.enabledCount > 0)) return a.enabledCount > 0 ? -1 : 1;
      return 0;
    });
}

function ModelSection() {
  void loadModels();
  const limitsModalOpen = usePresenceFlag(() => modelLimitsDraft() !== null);
  const limitsTargetModel = () =>
    storedModels().find(model => model.id === modelLimitsDraft()?.id) ?? null;
  const discoveredMatches = () => {
    const query = discoverySearchQuery().trim().toLowerCase();
    const all = mergedDiscoveredOptions(modelDraft());
    if (!query) return all;
    return all.filter(
      opt =>
        opt.id.toLowerCase().includes(query) ||
        opt.label.toLowerCase().includes(query) ||
        (opt.description ?? "").toLowerCase().includes(query),
    );
  };
  const isDiscoveredSelected = (id: string): boolean => {
    const key = id.trim().toLowerCase();
    return selectedDiscoveredIds().some(item => item.trim().toLowerCase() === key);
  };
  const urlPreview = (): string =>
    previewRequestUrl(modelDraft().baseUrl, modelDraft().provider, modelDraft().modelName);
  const testStatus = () => draftTestOutcome();

  const filteredModels = () => {
    const query = modelSearchQuery().trim().toLowerCase();
    const status = modelStatusFilter();
    return storedModels().filter(model => {
      if (status === "enabled" && model.enabled === false) return false;
      if (!query) return true;
      const host = endpointHostOf(model.base_url);
      const format = normalizeModelFormat(model.provider);
      const label = modelOptionLabel(model).toLowerCase();
      return (
        label.includes(query) ||
        (model.name ?? "").toLowerCase().includes(query) ||
        (model.model_name ?? "").toLowerCase().includes(query) ||
        format.includes(query) ||
        host.includes(query) ||
        providerLabelFor(format, host).toLowerCase().includes(query)
      );
    });
  };

  const groups = () => groupModelsByProvider(filteredModels(), defaultModels().primary);
  const hasActiveSearch = () => modelSearchQuery().trim().length > 0;

  const isGroupExpanded = (group: ModelProviderGroup, index: number, total: number): boolean => {
    if (hasActiveSearch()) return true;
    const override = providerGroupExpanded()[group.key];
    if (override !== undefined) return override;
    return total <= 3 || index === 0;
  };

  const allGroupsExpanded = () => {
    const list = groups();
    return list.length > 0 && list.every((group, index) => isGroupExpanded(group, index, list.length));
  };

  const toggleAllGroups = () => {
    const next = !allGroupsExpanded();
    const patch: Record<string, boolean> = { ...providerGroupExpanded() };
    for (const group of groups()) patch[group.key] = next;
    providerGroupExpanded.set(patch);
  };

  const totalEnabled = () => storedModels().filter(m => m.enabled !== false).length;

  return (
    <SettingsSection
      flush={true}
      title={tr("settings.models.title")}
      subtitle={tr("settings.models.subtitle")}
      notice={modelSettingsNotice()}
      onDismissNotice={() => modelSettingsNotice.set("")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <If when={storedModels().length > 0}>
            <Text style={textStyle("caption", { color: palette().textMuted, tabular: true })}>
              {tr("settings.models.providerSummary", {
                enabled: totalEnabled(),
                total: storedModels().length,
              })}
            </Text>
          </If>
          <Button
            label={tr("settings.models.addModel")}
            leadingIcon="plus"
            variant="primary"
            size="sm"
            accessibilityLabel="add-model"
            onPress={() => {
              resetRemoteDiscovery();
              openModelForm();
            }}
          />
        </View>
      }
    >
      <View>
        <If when={!modelSettingsLoaded()}>
          <View style={{ padding: space.lg }}>
            <Text style={textStyle("caption")}>{tr("settings.models.reading")}</Text>
          </View>
        </If>
        <If when={modelSettingsLoaded() && storedModels().length === 0}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingVertical: space.lg,
            }}
          >
            <Icon name="cpu" size={16} color={palette().textMuted} />
            <Text style={textStyle("caption")}>{tr("settings.models.empty")}</Text>
          </View>
        </If>

        <If when={storedModels().length > 0}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingVertical: space.sm,
              position: "relative",
            }}
          >
            <SearchInput
              value={modelSearchQuery()}
              placeholder={tr("settings.models.searchPlaceholder")}
              accessibilityLabel="models-filter-search"
              style={{ flex: 1, minWidth: 160 }}
              onChange={value => modelSearchQuery.set(value)}
            />
            <SegmentedTabs
              size="sm"
              value={modelStatusFilter()}
              options={[
                { value: "all", label: tr("settings.models.filterAll"), accessibilityLabel: "models-filter-all" },
                { value: "enabled", label: tr("settings.models.filterEnabled"), accessibilityLabel: "models-filter-enabled" },
              ]}
              onChange={value => modelStatusFilter.set(value)}
            />
            <If when={groups().length > 1 && !hasActiveSearch()}>
              <Button
                label={allGroupsExpanded() ? tr("settings.models.collapseAll") : tr("settings.models.expandAll")}
                variant="ghost"
                size="xs"
                accessibilityLabel="models-toggle-all-groups"
                onPress={toggleAllGroups}
              />
            </If>
            <RowSeparator edge="bottom" />
          </View>
        </If>

        <If when={storedModels().length > 0 && groups().length === 0}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.lg }}>
            <Text style={textStyle("caption")}>{tr("settings.models.noFilterMatches")}</Text>
          </View>
        </If>

        <Each of={groups()} key={group => group.key}>
          {(group, groupIndex) => {
            const expanded = () => isGroupExpanded(group(), groupIndex(), groups().length);
            return (
              <View style={{ position: "relative" }}>
                <If when={groupIndex() !== 0}>
                  <RowSeparator edge="top" />
                </If>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: SETTINGS_ROW_INSET,
                    paddingVertical: space.sm,
                    minHeight: 42,
                    backgroundColor: palette().surfaceTertiary,
                  }}
                >
                  <View
                    role="button"
                    accessibilityLabel={`provider-group-toggle-${group().key}`}
                    accessibilityState={{ expanded: expanded() }}
                    onPress={() => {
                      const current = expanded();
                      providerGroupExpanded.update(prev => ({ ...prev, [group().key]: !current }));
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      paddingVertical: 2,
                      cursor: "pointer",
                      userSelect: "none",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    activeStyle={tactileActiveStyle(0.99)}
                    focusVisibleStyle={focusRingStyle()}
                  >
                    <View style={{ flexShrink: 0, ...rotatingChevronStyle(expanded()) }}>
                      <Icon name="chevron-right" size={13} color={palette().textMuted} />
                    </View>
                    <Text
                      style={{
                        ...textStyle("label"),
                        fontWeight: "600",
                        flexShrink: 1,
                        minWidth: 0,
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {group().label}
                    </Text>
                    <If when={Boolean(group().host) && group().host !== group().label}>
                      <Text
                        style={{
                          ...textStyle("caption", { color: palette().textMuted }),
                          flexShrink: 2,
                          minWidth: 0,
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {group().host}
                      </Text>
                    </If>
                  </View>
                  <Text style={textStyle("caption", { color: palette().textMuted, tabular: true })}>
                    {`${group().enabledCount}/${group().models.length}`}
                  </Text>
                  <IconButton
                    icon="plus"
                    size="xs"
                    tooltip={tr("settings.models.addInProvider", { provider: group().label })}
                    accessibilityLabel={`provider-add-model-${group().key}`}
                    onPress={() => {
                      resetRemoteDiscovery();
                      openModelForm({
                        provider: group().format,
                        baseUrl: group().baseUrl,
                      });
                    }}
                  />
                </View>
                <If when={expanded()}>
                  <View style={{ position: "relative" }}>
                    <RowSeparator edge="top" />
                    <Each of={group().models} key={model => model.id}>
                      {(model, index) => <ModelRow model={model} index={index} />}
                    </Each>
                  </View>
                </If>
              </View>
            );
          }}
        </Each>

        {/* Add Model Modal */}
        <ModalDialog
          open={modelFormOpen()}
          title={
            modelDraft().editingId
              ? tr("settings.models.editModalTitle", { name: modelDraft().name || modelDraft().modelName })
              : tr("settings.models.addModalTitle")
          }
          subtitle={
            modelDraft().editingId ? tr("settings.models.editModalSubtitle") : tr("settings.models.addModalSubtitle")
          }
          size="lg"
          accessibilityLabel="model-editor-modal"
          onClose={() => {
            resetRemoteDiscovery();
            closeModelForm();
          }}
          footer={
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.sm,
                flex: 1,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flex: 1, minWidth: 140 }}>
                <Button
                  label={testStatus().status === "testing" ? tr("common.testing") : tr("common.test")}
                  variant="secondary"
                  size="md"
                  disabled={testStatus().status === "testing"}
                  accessibilityLabel="model-draft-test"
                  onPress={() => void testDraftConnection(modelDraft())}
                />
                <If when={testStatus().status === "testing"}>
                  <Spinner size={14} color={palette().accent} />
                </If>
                <If when={testStatus().status === "success"}>
                  <Text style={textStyle("caption", { color: palette().textSecondary })}>
                    {testStatus().message || tr("common.connected")}
                  </Text>
                </If>
                <If when={testStatus().status === "error"}>
                  <Text style={textStyle("caption", { color: stateColor("failed") })}>
                    {tr("common.failed")}
                  </Text>
                </If>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 0, gap: space.sm }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="md"
                  accessibilityLabel="model-editor-cancel"
                  onPress={() => {
                    resetRemoteDiscovery();
                    closeModelForm();
                  }}
                />
                <Button
                  label={modelDraft().editingId ? tr("common.save") : tr("settings.models.addModel")}
                  variant="primary"
                  size="md"
                  accessibilityLabel="save-model"
                  onPress={() => void saveModelDraft()}
                />
              </View>
            </View>
          }
        >
          <View style={{ gap: space.md }}>
            <If when={testStatus().status === "error" && testStatus().errorDetails ? testStatus().errorDetails! : ""}>
              {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
            </If>
            <If when={!modelDraft().editingId && modelCatalogLoaded() && modelCatalog().length > 0}>
              <View
                style={{
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  backgroundColor: palette().surfaceTertiary,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <Text style={textStyle("caption")}>{tr("settings.models.discoverHint")}</Text>
                <ModelFormField
                  label={tr("common.filter")}
                  value={modelCatalogQuery()}
                  placeholder="anthropic"
                  accessibilityLabel="model-filter"
                  onChange={value => setCatalogQuery(value)}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  <Each of={catalogProviders()} key={provider => provider.id}>
                    {provider => (
                      <SelectableChip
                        label={provider().name}
                        active={modelCatalogProvider() === provider().id}
                        accessibilityLabel={`model-catalog-provider-${provider().id}`}
                        onPress={() => {
                          resetRemoteDiscovery();
                          chooseCatalogProvider(provider().id);
                        }}
                      />
                    )}
                  </Each>
                </View>
                <If when={selectedCatalogProvider() !== null}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                    <Each of={selectedCatalogProvider()?.models ?? []} key={model => model.id}>
                      {model => (
                        <SelectableChip
                          label={model().label}
                          active={modelDraft().modelName === model().id}
                          accessibilityLabel={`model-catalog-model-${model().id}`}
                          onPress={() => {
                            resetRemoteDiscovery();
                            chooseCatalogModel(model().id);
                          }}
                        />
                      )}
                    </Each>
                  </View>
                </If>
                <If when={modelCatalogNotice() !== ""}>
                  <Text style={textStyle("caption")}>{localizeHostError(modelCatalogNotice())}</Text>
                </If>
              </View>
            </If>
            <ModelFormField
              label={tr("common.name")}
              value={modelDraft().name}
              placeholder={tr("settings.models.namePlaceholder")}
              accessibilityLabel="model-name"
              onChange={value => updateDraft({ name: value })}
            />
            <View style={{ gap: 6 }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.models.providerFormat")}
              </Text>
              <SegmentedTabs
                size="sm"
                value={modelDraft().provider}
                options={PROVIDER_FORMATS.map(format => ({
                  value: format,
                  label: format,
                  accessibilityLabel: `model-format-${format}`,
                }))}
                onChange={format => {
                  resetRemoteDiscovery();
                  updateDraft({ provider: format as (typeof PROVIDER_FORMATS)[number] });
                }}
              />
            </View>
            <ModelFormField
              label={tr("settings.models.baseUrl")}
              value={modelDraft().baseUrl}
              placeholder="https://api.openai.com/v1"
              monospace
              accessibilityLabel="model-base-url"
              onChange={value => {
                resetRemoteDiscovery();
                updateDraft({ baseUrl: value });
              }}
            />
            <If when={urlPreview()}>
              {preview => (
                <View
                  style={{
                    gap: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    backgroundColor: palette().surfaceTertiary,
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                  }}
                >
                  <Text
                    accessibilityLabel="model-request-url-preview"
                    style={{
                      minWidth: 0,
                      color: palette().textSecondary,
                      fontSize: textSize(12),
                      fontFamily: fontMono,
                      lineHeight: textLineHeight(12, 1.42),
                    }}
                  >
                    {tr("settings.models.requestUrl", { url: preview() })}
                  </Text>
                  <Text style={textStyle("micro")}>{tr("settings.models.baseUrlHint")}</Text>
                </View>
              )}
            </If>
            <ModelFormField
              label={tr("settings.models.apiKey")}
              value={modelDraft().apiKey}
              placeholder={tr("settings.models.apiKeyPlaceholder")}
              secret
              accessibilityLabel="model-api-key"
              onChange={value => {
                resetRemoteDiscovery();
                updateDraft({ apiKey: value });
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <ModelFormField
                  label={tr("settings.models.modelName")}
                  value={modelDraft().modelName}
                  placeholder="gpt-4.1-mini"
                  monospace
                  accessibilityLabel="model-model-name"
                  onChange={value => updateDraft({ modelName: value })}
                />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 0, gap: space.sm }}>
                <Button
                  label={
                    remoteDiscoveryLoading()
                      ? tr("settings.models.detecting")
                      : tr("settings.models.detectModels")
                  }
                  variant="secondary"
                  size="md"
                  disabled={remoteDiscoveryLoading()}
                  accessibilityLabel="model-detect-btn"
                  onPress={() => void detectModelsForConfig(modelDraft(), true)}
                />
                <Button
                  label={`${tr("settings.models.quickAddModels")}${remoteDiscoveredModels().length > 0 ? ` (${remoteDiscoveredModels().length})` : ""}`}
                  variant="secondary"
                  size="md"
                  accessibilityLabel="settings-model-select"
                  onPress={() => openDiscoveryPicker(modelDraft())}
                />
              </View>
            </View>
            <If when={remoteDiscoveryLoading()}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Spinner size={12} color={palette().accent} />
                <Text style={textStyle("caption")}>{tr("settings.models.queryingRemote")}</Text>
              </View>
            </If>
            <If when={!remoteDiscoveryLoading() && remoteDiscoveredModels().length > 0}>
              <Text style={textStyle("caption", { color: palette().textSecondary, tabular: true })}>
                {tr("settings.models.detectedSummary", { count: remoteDiscoveredModels().length })}
              </Text>
            </If>
            <If when={remoteDiscoveryError()}>
              {err => (
                <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                  {localizeHostError(err())}
                </Text>
              )}
            </If>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 160 }}>
                <ModelFormField
                  label={tr("settings.models.contextWindow")}
                  value={modelDraft().contextWindow}
                  placeholder="200000"
                  accessibilityLabel="model-context-window"
                  onChange={value => updateDraft({ contextWindow: value })}
                />
              </View>
              <View style={{ flex: 1, minWidth: 160 }}>
                <ModelFormField
                  label={tr("settings.models.maxOutput")}
                  value={modelDraft().maxTokens}
                  placeholder="8000"
                  accessibilityLabel="model-max-output"
                  onChange={value => updateDraft({ maxTokens: value })}
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.models.category")}
              </Text>
              <SegmentedTabs
                size="sm"
                value={modelDraft().category}
                options={MODEL_CATEGORIES.map(category => ({
                  value: category,
                  label: tr(MODEL_CATEGORY_KEYS[category]),
                  accessibilityLabel: `model-category-${category}`,
                }))}
                onChange={category => updateDraft({ category })}
              />
            </View>
            <View
              style={{
                gap: 10,
                padding: 12,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.models.advanced")}
              </Text>
              <InputBox
                label={tr("settings.models.customHeaders")}
                hint={tr("settings.models.customHeadersHint")}
                size="md"
                multiline={true}
                minHeight={64}
                monospace={true}
                value={modelDraft().customHeaders}
                placeholder="X-Team: research"
                accessibilityLabel="model-custom-headers"
                onChange={value => updateDraft({ customHeaders: value })}
              />
              <If when={modelDraft().customHeaders.trim() !== ""}>
                <SegmentedTabs
                  size="sm"
                  value={modelDraft().customHeadersMode}
                  options={[
                    { value: "merge", label: tr("settings.models.headersMerge"), accessibilityLabel: "model-headers-merge" },
                    { value: "replace", label: tr("settings.models.headersReplace"), accessibilityLabel: "model-headers-replace" },
                  ]}
                  onChange={mode => updateDraft({ customHeadersMode: mode as "merge" | "replace" })}
                />
              </If>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={textStyle("label")}>{tr("settings.models.skipSsl")}</Text>
                  <Text style={textStyle("caption")}>{tr("settings.models.skipSslHint")}</Text>
                </View>
                <ToggleSwitch
                  value={modelDraft().skipSslVerify}
                  accessibilityLabel="model-skip-ssl"
                  onChange={next => updateDraft({ skipSslVerify: next })}
                />
              </View>
            </View>
          </View>
        </ModalDialog>

        {/* Model Discovery & Multi-Add Modal */}
        <ModalDialog
          open={discoveryPickerOpen()}
          title={tr("settings.models.discoverTitle")}
          subtitle={tr("settings.models.discoverSubtitle")}
          size="md"
          accessibilityLabel="model-discovery-modal"
          onClose={() => closeDiscoveryPicker()}
          footer={
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.sm,
                flex: 1,
              }}
            >
              <Text style={textStyle("caption")}>
                {tr("settings.models.selectedCount", { count: selectedDiscoveredIds().length })}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="md"
                  accessibilityLabel="model-discovery-cancel"
                  onPress={() => closeDiscoveryPicker()}
                />
                <Button
                  label={
                    selectedDiscoveredIds().length > 1
                      ? tr("settings.models.addCountModels", { count: selectedDiscoveredIds().length })
                      : tr("settings.models.useSelectedModel")
                  }
                  variant="primary"
                  size="md"
                  disabled={selectedDiscoveredIds().length === 0}
                  accessibilityLabel="model-discovery-confirm"
                  onPress={() =>
                    void addAllSelectedDiscoveredModels(modelDraft()).then(savedBatch => {
                      if (savedBatch) closeModelForm();
                    })
                  }
                />
              </View>
            </View>
          }
        >
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <SearchInput
                  size="md"
                  value={discoverySearchQuery()}
                  onChange={value => discoverySearchQuery.set(value)}
                  placeholder={tr("settings.models.discoverSearch")}
                  accessibilityLabel="model-discovery-search"
                />
              </View>
              <Button
                label={
                  remoteDiscoveryLoading()
                    ? tr("settings.models.refreshing")
                    : tr("common.refresh")
                }
                variant="secondary"
                size="md"
                disabled={remoteDiscoveryLoading()}
                accessibilityLabel="model-discovery-refresh"
                onPress={() => void detectModelsForConfig(modelDraft(), true)}
              />
            </View>
            <If when={remoteDiscoveryError()}>
              {err => (
                <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
                  {localizeHostError(err())}
                </Text>
              )}
            </If>
            <If when={discoveredMatches().length === 0}>
              <Text style={textStyle("caption")}>{tr("settings.models.noMatches")}</Text>
            </If>
            <Scroll style={{ maxHeight: 260, minHeight: 0, flexShrink: 1 }}>
              <View style={{ gap: space.sm }}>
                <Each of={discoveredMatches()} key={item => item.id}>
                  {item => {
                    const selected = () => isDiscoveredSelected(item().id);
                    return (
                      <View
                        role="button"
                        accessibilityLabel={`model-discovery-option-${item().id}`}
                        accessibilityState={{ selected: selected() }}
                        onPress={() => toggleDiscoveredModel(item().id)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.md,
                          paddingHorizontal: space.md,
                          paddingVertical: space.sm,
                          minHeight: compactLayout() ? layout.touchTarget : controlHeight.md,
                          borderRadius: radii.md,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: selected() ? palette().borderStrong : palette().borderSubtle,
                          backgroundColor: palette().surfaceTertiary,
                          cursor: "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{ backgroundColor: listRowHoverBg() }}
                        activeStyle={tactileActiveStyle(0.99)}
                        focusVisibleStyle={focusRingStyle()}
                      >
                        <ListRowContent
                          icon={selected() ? "check" : "plus"}
                          iconColor={selected() ? palette().textSecondary : palette().textMuted}
                          title={item().label}
                          titleWeight={selected() ? "500" : "400"}
                          subtitle={item().description}
                          trailing={
                            <Badge
                              label={
                                item().source === "remote"
                                  ? tr("common.remote")
                                  : tr("settings.models.catalog")
                              }
                              tone={item().source === "remote" ? "accent" : "neutral"}
                            />
                          }
                        />
                      </View>
                    );
                  }}
                </Each>
              </View>
            </Scroll>
          </View>
        </ModalDialog>

        {/* Model Token Limits & Endpoint Details Modal */}
        <ModalDialog
          open={limitsModalOpen()}
          title={tr("settings.models.limitsTitle")}
          subtitle={
            limitsTargetModel()?.name ?? tr("settings.models.limitsModalDefaultSub")
          }
          size="sm"
          accessibilityLabel="model-limits-modal"
          onClose={() => closeModelLimits()}
          onSubmit={() => void saveModelLimits()}
          footer={
            <If when={modelLimitsDraft() !== null}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                <Button
                  label={tr("common.cancel")}
                  variant="secondary"
                  size="md"
                  accessibilityLabel={`model-limits-cancel-${modelLimitsDraft()?.id ?? ""}`}
                  onPress={() => closeModelLimits()}
                />
                <Button
                  label={tr("common.save")}
                  variant="primary"
                  size="md"
                  accessibilityLabel={`model-limits-save-${modelLimitsDraft()?.id ?? ""}`}
                  onPress={() => void saveModelLimits()}
                />
              </View>
            </If>
          }
        >
          <If when={modelLimitsDraft() !== null}>
            <View style={{ gap: space.md }}>
              <If when={limitsTargetModel()?.request_url || limitsTargetModel()?.base_url || ""}>
                {endpoint => (
                  <View style={{ gap: space.xs }}>
                    <Text style={textStyle("label", { color: palette().textSecondary })}>
                      {tr("settings.models.endpointLabel")}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        borderRadius: radii.md,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().surfaceTertiary,
                      }}
                    >
                      <Text
                        style={{
                          ...textStyle("mono", { color: palette().textSecondary }),
                          numberOfLines: 2,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {endpoint()}
                      </Text>
                    </View>
                  </View>
                )}
              </If>
              <InputBox
                label={tr("settings.models.contextWindow")}
                size="md"
                value={modelLimitsDraft()?.contextWindow ?? ""}
                placeholder={tr("settings.models.tokensUnit")}
                accessibilityLabel={`model-context-${modelLimitsDraft()?.id ?? ""}`}
                onChange={val => updateModelLimitsDraft({ contextWindow: val })}
              />
              <InputBox
                label={tr("settings.models.maxOutput")}
                size="md"
                value={modelLimitsDraft()?.maxTokens ?? ""}
                placeholder={tr("settings.models.tokensUnit")}
                accessibilityLabel={`model-max-tokens-${modelLimitsDraft()?.id ?? ""}`}
                onChange={val => updateModelLimitsDraft({ maxTokens: val })}
              />
              <Text style={textStyle("caption")}>{tr("settings.models.limitsHint")}</Text>
            </View>
          </If>
        </ModalDialog>
      </View>
    </SettingsSection>
  );
}

function AppearanceSwatchGallery() {
  const outerR = radii.md;
  const pad = space.sm;
  const previewR = concentricRadius(outerR, pad);
  const canvasR = concentricRadius(previewR, space.hair);
  return (
    <View
      style={{
        padding: space.lg,
      }}
    >
      <View
        style={{
          display: "grid",
          gridTemplateColumns: settingsCompact() ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
          gap: space.md,
        }}
      >
        <Each of={APPEARANCE_PRESETS} key={preset => preset.id}>
          {preset => {
            const active = () => resolvedAppearanceId() === preset().id;
            const sw = () => preset().palette;
            return (
              <View
                role="button"
                accessibilityLabel={`appearance-swatch-${preset().id}`}
                accessibilityState={{ selected: active() }}
                onPress={() => chooseAppearancePreset(preset().id)}
                style={{
                  gap: space.sm,
                  padding: pad,
                  borderRadius: outerR,
                  borderCurve: "continuous",
                  borderWidth: 2,
                  borderColor: active() ? palette().accent : palette().borderSubtle,
                  backgroundColor: active() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  borderColor: active() ? palette().accent : palette().borderStrong,
                  backgroundColor: active() ? palette().accentSoft : palette().panelHover,
                }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={focusRingStyle()}
              >
                {/* Sleek Micro-Window Preview */}
                <View
                  style={{
                    position: "relative",
                    height: 54,
                    borderRadius: previewR,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: sw().borderStrong,
                    backgroundColor: sw().chromeBg,
                    flexDirection: "row",
                    overflow: "hidden",
                    padding: space.hair,
                    gap: space.hair,
                  }}
                >
                  {/* Sidebar Rail */}
                  <View
                    style={{
                      width: "27%",
                      paddingHorizontal: space.xs,
                      paddingVertical: space.xs,
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ gap: space.xs }}>
                      <View
                        style={{
                          height: 3,
                          width: "82%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().chromeAccent,
                        }}
                      />
                      <View
                        style={{
                          height: 2,
                          width: "66%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().chromeTextMuted,
                          opacity: 0.55,
                        }}
                      />
                      <View
                        style={{
                          height: 2,
                          width: "54%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().chromeTextMuted,
                          opacity: 0.36,
                        }}
                      />
                    </View>
                    <View
                      style={{
                        height: 3,
                        width: "46%",
                        borderRadius: radii.pill,
                        backgroundColor: sw().chromeTextMuted,
                        opacity: 0.42,
                      }}
                    />
                  </View>

                  {/* Inset Scene Canvas */}
                  <View
                    style={{
                      flex: 1,
                      borderRadius: canvasR,
                      borderCurve: "continuous",
                      backgroundColor: sw().canvas,
                      padding: space.sm,
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ gap: space.xs }}>
                      <View
                        style={{
                          height: 4,
                          width: "58%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().text,
                          opacity: 0.85,
                        }}
                      />
                      <View
                        style={{
                          height: 3,
                          width: "84%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().textMuted,
                          opacity: 0.44,
                        }}
                      />
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: space.xs,
                      }}
                    >
                      <View
                        style={{
                          height: 11,
                          flex: 1,
                          borderRadius: radii.xs,
                          backgroundColor: sw().panelRaised,
                          borderWidth: 1,
                          borderColor: sw().border,
                        }}
                      />
                      <View
                        style={{
                          height: 11,
                          width: 22,
                          borderRadius: radii.pill,
                          backgroundColor: sw().actionPrimaryBg,
                        }}
                      />
                    </View>
                  </View>

                  {/* Check mark on the active preset */}
                  <If when={active()}>
                    <View
                      style={{
                        position: "absolute",
                        top: space.xs,
                        right: space.xs,
                        width: 18,
                        height: 18,
                        borderRadius: radii.pill,
                        backgroundColor: palette().actionSolid,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="check" size={10} color={palette().actionSolidFg} />
                    </View>
                  </If>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.xs }}>
                  <Text
                    style={{
                      ...textStyle("caption", { color: palette().text }),
                      flex: 1,
                      minWidth: 0,
                      fontWeight: active() ? "600" : "500",
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {tr(APPEARANCE_PRESET_KEYS[preset().id])}
                  </Text>
                  <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), flexShrink: 0 }}>
                    {preset().isLight
                      ? tr("settings.appearance.schemeLight")
                      : tr("settings.appearance.schemeDark")}
                  </Text>
                </View>
              </View>
            );
          }}
        </Each>
      </View>
    </View>
  );
}

function AppearanceSection() {
  const followSystem = () => appearanceMode() === "system" && appearanceId() === null;
  return (
    <SettingsSection flush={true} title={tr("settings.appearance.title")}>
      <View>
        <SettingsConfigRow
          label={tr("settings.appearance.followSystem")}
          description={
            resolvedScheme() === "light"
              ? tr("settings.appearance.showingLight")
              : tr("settings.appearance.showingDark")
          }
          divider={false}
        >
          <ToggleSwitch
            value={followSystem()}
            accessibilityLabel="appearance-follow-system"
            onChange={next => setFollowSystemAppearance(next)}
          />
        </SettingsConfigRow>
        <If when={!followSystem()}>
          <View style={{ position: "relative" }}>
            <RowSeparator edge="top" />
            <AppearanceSwatchGallery />
          </View>
        </If>
        <FontSizeRows />
        <ContentWidthRow />
      </View>
    </SettingsSection>
  );
}

function ContentWidthRow() {
  const isCustomWidth = () => contentWidth() !== DEFAULT_CONTENT_WIDTH;
  return (
    <View
      style={{
        position: "relative",
        gap: space.sm,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
      }}
    >
      <RowSeparator edge="top" />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.md }}>
        <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
          <Text style={{ ...textStyle("body"), fontWeight: "500" }}>
            {tr("settings.appearance.contentWidth")}
          </Text>
          <Text style={textStyle("caption", { tabular: true })}>
            {tr("settings.appearance.contentWidthDesc", { px: contentWidth() })}
          </Text>
        </View>
        <SettingsNumberStepper
          id="content-width"
          text={String(contentWidth())}
          unit={tr("settings.unit.px")}
          decreaseDisabled={contentWidth() <= MIN_CONTENT_WIDTH}
          onDecrease={() => adjustContentWidth(-CONTENT_WIDTH_STEP)}
          onIncrease={() => adjustContentWidth(CONTENT_WIDTH_STEP)}
          leading={
            <If when={isCustomWidth()}>
              <StepperAccessory
                icon="undo"
                tooltip={tr("common.reset")}
                accessibilityLabel="content-width-reset"
                onPress={() => resetContentWidth()}
              />
            </If>
          }
        />
      </View>
      <If when={contentWidthNotice().length > 0 ? contentWidthNotice() : ""}>
        {notice => (
          <Text style={textStyle("caption", { color: stateColor("needs_you") })}>
            {localizeHostError(notice())}
          </Text>
        )}
      </If>
    </View>
  );
}

function FontSizeRows() {
  return (
    <View
      style={{
        position: "relative",
        gap: space.md,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
      }}
    >
      <RowSeparator edge="top" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: space.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
          <Text style={{ ...textStyle("body"), fontWeight: "500" }}>
            {tr("settings.appearance.textSize")}
          </Text>
          <Text style={textStyle("caption", { tabular: true })}>
            {tr("settings.appearance.fontBaseline", { px: fontPx() })}
          </Text>
        </View>
        <SettingsNumberStepper
          id="font-size"
          text={String(fontPx())}
          unit={tr("settings.unit.px")}
          decreaseDisabled={fontPx() <= MIN_FONT_PX}
          increaseDisabled={fontPx() >= MAX_FONT_PX}
          onDecrease={() => void adjustFontPx(-1)}
          onIncrease={() => void adjustFontPx(1)}
          leading={
            <If when={fontLevel() !== "default"}>
              <StepperAccessory
                icon="undo"
                tooltip={tr("common.reset")}
                accessibilityLabel="font-size-reset"
                onPress={() => void resetFontPreference()}
              />
            </If>
          }
        />
      </View>
      <Scroll horizontal style={{ maxWidth: "100%" }}>
        <SegmentedTabs
          size="sm"
          value={fontLevel()}
          options={[
            ...FONT_LEVELS.map(entry => ({
              value: entry.level as FontLevel,
              label: tr(FONT_LEVEL_KEYS[entry.level]),
              accessibilityLabel: `font-level-${entry.level}`,
            })),
            {
              value: "custom" as FontLevel,
              label: tr("settings.appearance.fontCustom"),
              accessibilityLabel: "font-level-custom",
            },
          ]}
          onChange={level => void chooseFontLevel(level)}
        />
      </Scroll>
      <If when={fontNotice()}>
        {notice => (
          <Text style={textStyle("caption", { color: stateColor("failed") })}>
            {localizeHostError(notice())}
          </Text>
        )}
      </If>
    </View>
  );
}

function PoolsSection() {
  useDeviceScopedLoad("pools", ensurePools, () => void loadPools());
  const poolModalOpen = usePresenceFlag(() => poolDraft() !== null);
  return (
    <If when={poolsSupported() !== false}>
      <SettingsSection
        flush={true}
        title={tr("settings.pools.title")}
        subtitle={tr("settings.pools.subtitle")}
        notice={poolsNotice()}
        onDismissNotice={() => poolsNotice.set("")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("settings.pools.addPool")}
              leadingIcon="plus"
              variant="secondary"
              size="sm"
              accessibilityLabel="add-pool"
              onPress={() => openPoolDraft()}
            />
          </View>
        }
      >
        <View>
          <If when={poolsSupported() === null}>
            <View style={{ padding: space.lg }}>
              <Text style={textStyle("caption")}>{tr("settings.pools.reading")}</Text>
            </View>
          </If>
          <If when={poolsSupported() === true && pools().length === 0 && !poolDraft()}>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
                minHeight: SETTINGS_ROW_MIN,
              }}
            >
              <Icon name="layers" size={16} color={palette().textMuted} />
              <View style={{ flex: 1, minWidth: 160, gap: space.hair }}>
                <Text style={{ ...textStyle("body"), fontWeight: "500" }}>
                  {tr("settings.pools.emptyLegacy")}
                </Text>
                <Text style={textStyle("caption")}>
                  {tr("settings.pools.emptyHint")}
                </Text>
              </View>
              <Button
                label={tr("settings.pools.createPool")}
                leadingIcon="plus"
                variant="secondary"
                size="sm"
                accessibilityLabel="create-pool-empty"
                onPress={() => openPoolDraft()}
              />
            </View>
          </If>
          <Each of={pools()} key={pool => pool.id}>
            {(pool, index) => <PoolRow pool={pool} first={() => index() === 0} />}
          </Each>
          <ModalDialog
            open={poolModalOpen()}
            title={
              poolDraft()?.id
                ? tr("settings.pools.editModalTitle")
                : tr("settings.pools.createModalTitle")
            }
            subtitle={tr("settings.pools.modalSubtitle")}
            size="md"
            accessibilityLabel="pool-editor-modal"
            onClose={() => closePoolDraft()}
            footer={
              <If when={poolDraft() !== null}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                  <Button
                    label={tr("common.cancel")}
                    variant="secondary"
                    size="md"
                    onPress={() => closePoolDraft()}
                  />
                  <Button
                    label={
                      poolDraft()?.id
                        ? tr("settings.pools.savePool")
                        : tr("settings.pools.createPool")
                    }
                    variant="primary"
                    size="md"
                    accessibilityLabel="save-pool"
                    onPress={() => void savePoolDraft()}
                  />
                </View>
              </If>
            }
          >
            <If when={poolDraft() !== null}>
              <PoolEditor />
            </If>
          </ModalDialog>
        </View>
      </SettingsSection>
    </If>
  );
}

function PoolRow(props: { pool: () => ModelPool; first?: () => boolean }) {
  const labelOf = (modelId: string): string => {
    const found = storedModels().find(model => model.id === modelId);
    return found ? modelOptionText(found) : modelId;
  };
  const statusesOf = () => poolStatuses()[props.pool().id] ?? [];
  const strategyLabel = () => {
    const strategy = props.pool().strategy;
    const mapped = POOL_STRATEGY_KEYS[strategy];
    if (mapped) return tr(mapped.labelKey);
    return POOL_STRATEGIES.find(entry => entry.value === strategy)?.label ?? strategy;
  };
  const menuKey = () => `pool-${props.pool().id}`;
  return (
    <View
      style={{
        gap: space.sm,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        position: "relative",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <If when={!props.first?.()}>
        <RowSeparator edge="top" />
      </If>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md }}>
        <Text
          style={{
            ...textStyle("body"),
            flex: 1,
            minWidth: 140,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.pool().name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.sm, marginLeft: "auto" }}>
          <Text style={textStyle("caption", { color: palette().textSecondary })}>
            {tr("settings.pools.membersSummary", {
              strategy: strategyLabel(),
              count: props.pool().memberModelIds.length,
            })}
          </Text>
          <Button
            label={tr("common.check")}
            variant="secondary"
            size="sm"
            accessibilityLabel={`check-pool-${props.pool().id}`}
            onPress={() => void loadPoolStatus(props.pool().id)}
          />
          <View ref={el => setRowAnchor(menuKey(), el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              tooltip={tr("settings.pools.options")}
              accessibilityLabel={`pool-actions-${props.pool().id}`}
              onPress={() => rowMenuId.set(rowMenuId() === menuKey() ? null : menuKey())}
            />
          </View>
        </View>
        <DropdownMenu
          open={rowMenuId() === menuKey()}
          anchor={rowMenuAnchors()[menuKey()] ?? null}
          onClose={() => rowMenuId.set(null)}
          items={[
            {
              id: "edit",
              label: tr("settings.pools.editPool"),
              icon: "edit",
              accessibilityLabel: `edit-pool-${props.pool().id}`,
              onSelect: () => {
                rowMenuId.set(null);
                openPoolDraft(props.pool());
              },
            },
            {
              id: "delete",
              label: tr("settings.pools.deletePool"),
              icon: "trash",
              danger: true,
              accessibilityLabel: `delete-pool-${props.pool().id}`,
              onSelect: () => {
                rowMenuId.set(null);
                void deletePool(props.pool().id);
              },
            },
          ]}
        />
      </View>
      <Text style={textStyle("caption")}>
        {props.pool().memberModelIds.length === 0
          ? tr("settings.pools.noMemberYet")
          : props.pool().memberModelIds.map(labelOf).join(" → ")}
      </Text>
      <If when={statusesOf().length > 0}>
        <View style={{ gap: space.xs, paddingTop: space.hair }}>
          <Each of={statusesOf()} key={entry => entry.modelId}>
            {entry => {
              const tone = () => poolMemberTone(entry().status);
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <If when={tone() === "danger"}>
                    <StateMark state="failed" size={12} />
                  </If>
                  <If when={tone() === "warning"}>
                    <StateMark state="needs_you" size={12} />
                  </If>
                  <Text
                    style={{
                      ...textStyle("caption", {
                        color:
                          tone() === "danger"
                            ? stateColor("failed")
                            : tone() === "warning"
                              ? stateColor("needs_you")
                              : palette().textSecondary,
                      }),
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {`${entry().modelId}: ${entry().status}${entry().reason ? ` (${entry().reason})` : ""}`}
                  </Text>
                </View>
              );
            }}
          </Each>
        </View>
      </If>
    </View>
  );
}

function PoolEditor() {
  const membersOf = () => poolDraft()?.members ?? [];
  const strategyOf = () => poolDraft()?.strategy ?? "ordered";
  const hasMember = (modelId: string) => membersOf().includes(modelId);
  const memberName = (modelId: string) => {
    const found = storedModels().find(m => m.id === modelId);
    return found ? modelOptionText(found) : modelId;
  };
  const strategyHint = () => {
    const mapped = POOL_STRATEGY_KEYS[strategyOf()];
    if (mapped) return tr(mapped.hintKey);
    return POOL_STRATEGIES.find(entry => entry.value === strategyOf())?.hint ?? "";
  };
  return (
    <View style={{ gap: space.md }}>
      <ModelFormField
        label={tr("settings.pools.poolName")}
        value={poolDraft()?.name ?? ""}
        placeholder={tr("settings.pools.namePlaceholder")}
        accessibilityLabel="model-pool-name"
        onChange={value => updatePoolDraft({ name: value })}
      />
      <View style={{ gap: space.sm }}>
        <Text style={textStyle("label", { color: palette().textSecondary })}>
          {tr("settings.pools.routingStrategy")}
        </Text>
        <SegmentedTabs
          size="sm"
          value={strategyOf()}
          options={POOL_STRATEGIES.map(entry => ({
            value: entry.value,
            label: POOL_STRATEGY_KEYS[entry.value]
              ? tr(POOL_STRATEGY_KEYS[entry.value].labelKey)
              : entry.label,
            accessibilityLabel: `pool-strategy-${entry.value}`,
          }))}
          onChange={strategy => updatePoolDraft({ strategy })}
        />
        <Text style={textStyle("caption")}>{strategyHint()}</Text>
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={textStyle("label", { color: palette().textSecondary, tabular: true })}>
          {membersOf().length === 0
            ? tr("settings.pools.membersInOrderEmpty")
            : tr("settings.pools.membersInOrder", { count: membersOf().length })}
        </Text>
        <If when={membersOf().length > 0}>
          <View
            style={{
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().surfaceTertiary,
              overflow: "hidden",
            }}
          >
            <Each of={membersOf()} key={modelId => modelId}>
              {(modelId, index) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    position: "relative",
                  }}
                >
                  <If when={index() !== 0}>
                    <RowSeparator edge="top" />
                  </If>
                  <Badge label={`#${index() + 1}`} tone="neutral" />
                  <Text
                    style={{
                      ...textStyle("mono", { color: palette().text }),
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {memberName(modelId())}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.xs }}>
                    <IconButton
                      icon="arrow-up"
                      size="xs"
                      tooltip={tr("common.up")}
                      disabled={index() === 0}
                      accessibilityLabel={`pool-member-up-${modelId()}`}
                      onPress={() => movePoolMember(modelId(), -1)}
                    />
                    <IconButton
                      icon="chevron-down"
                      size="xs"
                      tooltip={tr("common.down")}
                      disabled={index() >= membersOf().length - 1}
                      accessibilityLabel={`pool-member-down-${modelId()}`}
                      onPress={() => movePoolMember(modelId(), 1)}
                    />
                    <IconButton
                      icon="trash"
                      size="xs"
                      tone="danger"
                      tooltip={tr("common.remove")}
                      accessibilityLabel={`pool-member-remove-${modelId()}`}
                      onPress={() => togglePoolMember(modelId())}
                    />
                  </View>
                </View>
              )}
            </Each>
          </View>
        </If>
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={textStyle("label", { color: palette().textSecondary })}>
          {tr("settings.pools.availableModels")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Each of={storedModels()} key={model => model.id}>
            {model => (
              <SelectableChip
                label={`${hasMember(model().id) ? "✓ " : "+ "}${modelOptionText(model())}`}
                active={hasMember(model().id)}
                accessibilityLabel={`pool-toggle-${model().id}`}
                onPress={() => togglePoolMember(model().id)}
              />
            )}
          </Each>
          <If when={storedModels().length === 0}>
            <Text style={textStyle("caption")}>{tr("settings.pools.noModels")}</Text>
          </If>
        </View>
      </View>
    </View>
  );
}

function LanguageRow() {
  return (
    <SettingsRow label={tr("settings.language.title")} description={tr("settings.language.hint")} first={true}>
      <SegmentedTabs
        size="sm"
        value={appLanguageValue()}
        options={SUPPORTED_LOCALES.map(entry => ({
          value: entry.id,
          label: entry.nativeName,
          accessibilityLabel: `app-language-${entry.id}`,
        }))}
        onChange={locale => void writeAppLanguage(locale)}
      />
    </SettingsRow>
  );
}

function AccountRow() {
  return (
    <SettingsRow
      label={tr("settings.account.title")}
      description={
        isAccountSignedIn()
          ? tr("devices.accountSignedInAs", { account: signedInAccountDisplay() })
          : tr("settings.account.subtitle")
      }
      first={true}
    >
      <If when={isAccountSignedIn()}>
        <Button
          label={tr("settings.account.manage")}
          variant="secondary"
          size="sm"
          accessibilityLabel="settings-account-manage"
          onPress={() => openAccountAuthModal()}
        />
      </If>
      <If when={!isAccountSignedIn()}>
        <Button
          label={tr("devices.signInCta")}
          variant="primary"
          size="sm"
          leadingIcon="log-in"
          accessibilityLabel="settings-account-sign-in"
          onPress={() => openAccountAuthModal({ autoStart: true })}
        />
      </If>
    </SettingsRow>
  );
}

/**
 * `terminal.default_shell` over the shells this host detects: empty means the
 * host picks (auto-detect), as the desktop's terminal page offers it.
 */
function DefaultShellRow() {
  useDeviceScopedLoad("terminal-shells", () => void loadTerminalShells(), () => void loadTerminalShells(true));
  const stored = (): string => {
    const value = settingsValues()["terminal.default_shell"];
    return typeof value === "string" ? value : "";
  };
  const selected = (): string => {
    const value = stored();
    if (!value) return "";
    const match = terminalShells().find(shell => shell.path === value || shell.type === value);
    return match ? match.path : value;
  };
  const options = () => {
    const rows = [
      { value: "", label: tr("settings.terminal.autoDetect"), accessibilityLabel: "terminal-default-shell-auto" },
      ...terminalShells().map(shell => ({
        value: shell.path,
        label: shell.name,
        description: shell.path,
        accessibilityLabel: `terminal-default-shell-${shell.id}`,
      })),
    ];
    const current = selected();
    if (current && !rows.some(row => row.value === current)) {
      rows.push({
        value: current,
        label: tr("settings.field.notConfiguredSuffix", { name: current }),
        description: current,
        accessibilityLabel: "terminal-default-shell-stored",
      });
    }
    return rows;
  };
  const saving = signal(false);
  const choose = async (value: string): Promise<void> => {
    saving.set(true);
    try {
      await setConfig("terminal.default_shell", value);
      settingsValues.update(values => ({ ...values, "terminal.default_shell": value }));
      setSectionNotice("terminal", tr("settings.notice.savedField", { label: tr("settings.terminal.defaultShell") }));
    } catch (error) {
      setSectionNotice("terminal", error instanceof Error ? error.message : String(error));
    } finally {
      saving.set(false);
    }
  };
  return (
    <SettingsRow
      label={tr("settings.terminal.defaultShell")}
      description={
        terminalShells().length === 0 ? tr("settings.terminal.noShells") : tr("settings.terminal.defaultShellDesc")
      }
      first={true}
    >
      <If when={saving()}>
        <Spinner size={12} color={palette().accent} />
      </If>
      <SelectDropdown
        size="sm"
        value={selected()}
        options={options()}
        accessibilityLabel="terminal-default-shell"
        disabled={saving() || terminalShells().length === 0}
        minWidth={settingsCompact() ? NUMBER_STEPPER_WIDTH : 220}
        maxWidth={settingsCompact() ? undefined : 300}
        align="end"
        onChange={value => void choose(value)}
      />
    </SettingsRow>
  );
}

const DEFAULT_MODEL_SLOT_KEYS: Record<DefaultModelSlot, { labelKey: MessageKey; descriptionKey: MessageKey; emptyKey: MessageKey; capability: string }> = {
  primary: {
    labelKey: "settings.defaultModels.primary",
    descriptionKey: "settings.defaultModels.primaryDesc",
    emptyKey: "common.none",
    capability: "text_chat",
  },
  fast: {
    labelKey: "settings.defaultModels.fast",
    descriptionKey: "settings.defaultModels.fastDesc",
    emptyKey: "settings.defaultModels.followPrimary",
    capability: "text_chat",
  },
  economy: {
    labelKey: "settings.defaultModels.economy",
    descriptionKey: "settings.defaultModels.economyDesc",
    emptyKey: "common.none",
    capability: "text_chat",
  },
  image_understanding: {
    labelKey: "settings.defaultModels.imageUnderstanding",
    descriptionKey: "settings.defaultModels.imageUnderstandingDesc",
    emptyKey: "common.none",
    capability: "image_understanding",
  },
  speech_recognition: {
    labelKey: "settings.defaultModels.speechRecognition",
    descriptionKey: "settings.defaultModels.speechRecognitionDesc",
    emptyKey: "common.none",
    capability: "speech_recognition",
  },
};

const PRIMARY_DEFAULT_SLOTS: ReadonlyArray<DefaultModelSlot> = ["primary", "fast"];
const SECONDARY_DEFAULT_SLOTS: ReadonlyArray<DefaultModelSlot> = [
  "economy",
  "image_understanding",
  "speech_recognition",
];
const defaultModelMoreSlotsOpen = signal(false);

/**
 * `ai.default_models`: compact 2-column routing card showing Primary & Fast
 * directly, with specialized capability slots tucked cleanly below a disclosure
 * toggle so the Models page stays scannable at any scale.
 */
function DefaultModelsSection() {
  useDeviceScopedLoad("default-models", () => void loadDefaultModels(), () => void loadDefaultModels());
  const optionsFor = (slot: DefaultModelSlot) => {
    const meta = DEFAULT_MODEL_SLOT_KEYS[slot];
    const models = storedModels().filter(model => isSelectableForCapability(model, meta.capability));
    const rows: Array<{ value: string; label: string; description?: string; accessibilityLabel: string }> = [];
    if (slot !== "primary") {
      rows.push({ value: "", label: tr(meta.emptyKey), accessibilityLabel: `default-model-${slot}-none` });
    }
    for (const model of models) {
      rows.push({
        value: model.id,
        label: modelOptionText(model),
        accessibilityLabel: `default-model-${slot}-${model.id}`,
      });
    }
    const current = defaultModels()[slot];
    if (current && !rows.some(row => row.value === current)) {
      rows.push({
        value: current,
        label: tr("settings.field.notConfiguredSuffix", { name: current }),
        accessibilityLabel: `default-model-${slot}-stored`,
      });
    }
    return rows;
  };
  const configuredSecondaryCount = () =>
    SECONDARY_DEFAULT_SLOTS.filter(slot => Boolean(defaultModels()[slot])).length;

  const renderSlotCell = (slot: () => DefaultModelSlot) => (
    <View style={{ gap: space.xs, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Text style={textStyle("label")}>{tr(DEFAULT_MODEL_SLOT_KEYS[slot()].labelKey)}</Text>
        <If when={defaultModelSaving() === slot()}>
          <Spinner size={11} color={palette().accent} />
        </If>
      </View>
      <Text
        style={{
          ...textStyle("caption"),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {tr(DEFAULT_MODEL_SLOT_KEYS[slot()].descriptionKey)}
      </Text>
      <SelectDropdown
        size="sm"
        value={defaultModels()[slot()] || (slot() === "fast" ? "" : null)}
        options={optionsFor(slot())}
        placeholder={tr("settings.defaultModels.choose")}
        searchable={optionsFor(slot()).length > 8}
        accessibilityLabel={`default-model-${slot()}`}
        disabled={defaultModelSaving() !== null || (slot() === "primary" && optionsFor(slot()).length === 0)}
        minWidth={140}
        onChange={value => void chooseDefaultModel(slot(), value || null)}
      />
    </View>
  );

  return (
    <SettingsGroup
      id="default-models"
      title={tr("settings.defaultModels.title")}
      description={tr("settings.defaultModels.subtitle")}
      notice={defaultModelsNotice()}
      onDismissNotice={() => defaultModelsNotice.set("")}
    >
      <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: space.md }}>
        <View
          style={{
            display: "grid",
            gridTemplateColumns: settingsCompact() ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
            gap: space.md,
          }}
        >
          <Each of={[...PRIMARY_DEFAULT_SLOTS]} key={slot => slot}>
            {slot => renderSlotCell(slot)}
          </Each>
        </View>
      </View>
      <View style={{ position: "relative" }}>
        <RowSeparator edge="top" />
        <View
          role="button"
          accessibilityLabel="default-models-more-slots"
          accessibilityState={{ expanded: defaultModelMoreSlotsOpen() }}
          onPress={() => defaultModelMoreSlotsOpen.update(v => !v)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.sm,
            paddingHorizontal: SETTINGS_ROW_INSET,
            paddingVertical: space.sm,
            minHeight: 38,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          activeStyle={tactileActiveStyle(0.99)}
          focusVisibleStyle={focusRingStyle()}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <View style={{ flexShrink: 0, ...rotatingChevronStyle(defaultModelMoreSlotsOpen()) }}>
              <Icon name="chevron-right" size={12} color={palette().textMuted} />
            </View>
            <Text style={textStyle("caption", { color: palette().textSecondary })}>
              {tr("settings.defaultModels.moreSlots", { count: SECONDARY_DEFAULT_SLOTS.length })}
            </Text>
          </View>
          <If when={configuredSecondaryCount() > 0}>
            <Text style={textStyle("caption", { color: palette().textMuted, tabular: true })}>
              {tr("settings.defaultModels.moreSlotsConfigured", { count: configuredSecondaryCount() })}
            </Text>
          </If>
        </View>
        <If when={defaultModelMoreSlotsOpen()}>
          <View
            style={{
              position: "relative",
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingBottom: space.md,
              paddingTop: space.sm,
            }}
          >
            <RowSeparator edge="top" />
            <View
              style={{
                display: "grid",
                gridTemplateColumns: settingsCompact() ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                gap: space.md,
                paddingTop: space.sm,
              }}
            >
              <Each of={[...SECONDARY_DEFAULT_SLOTS]} key={slot => slot}>
                {slot => renderSlotCell(slot)}
              </Each>
            </View>
          </View>
        </If>
      </View>
    </SettingsGroup>
  );
}

/**
 * Launch at login is a login item on the host, set through product control as
 * the desktop's General page does. A host that does not answer says so.
 */
function LaunchAtLoginRow() {
  useDeviceScopedLoad("general-control", () => void loadGeneralControl(), () => void loadGeneralControl(true));
  const value = () => generalControlValue("launch-at-login");
  return (
    <SettingsRow
      label={tr("settings.field.launchAtLogin")}
      description={
        generalControlValues() === null
          ? tr("settings.field.launchAtLoginReading")
          : value() === undefined
            ? tr("settings.field.launchAtLoginUnavailable")
            : tr("settings.field.launchAtLoginDesc")
      }
      first={true}
    >
      <If when={generalControlSaving() === "launch-at-login"}>
        <Spinner size={12} color={palette().accent} />
      </If>
      <If when={value() !== undefined}>
        <ToggleSwitch
          value={value() === true}
          accessibilityLabel="launch-at-login"
          disabled={generalControlSaving() !== null}
          onChange={next => void setGeneralControl("launch-at-login", next)}
        />
      </If>
    </SettingsRow>
  );
}

/** Picks a `.zip` pet pack and imports it on this device. */
async function pickCompanionPack(): Promise<void> {
  const files = await Picker.pickFiles({
    multiple: false,
    filters: [{ name: "Petdex", extensions: ["zip"] }],
    maxSize: 64 * 1024 * 1024,
  });
  const picked = files[0];
  if (!picked?.file || picked.status !== "read") return;
  const bytes = new Uint8Array(await picked.file.arrayBuffer());
  await importCompanionPetArchive(picked.name, Buffer.from(bytes).toString("base64"));
}

/**
 * Settings › Pet (wave22-p3): the desktop pet (on/off, character, import) and
 * desktop cards (on/off). Both are floating windows of the desktop app, so a
 * phone or a browser shows one "Desktop only" row instead of switches that
 * would do nothing there.
 */
function DesktopCompanionRow() {
  effect(() => {
    if (!companionAvailableHere()) return;
    untracked(() => {
      void loadCompanionSettings();
      void loadCompanionPets();
    });
  });
  return (
    <If
      when={companionAvailableHere()}
      else={
        <SettingsRow label={tr("settings.field.desktopCompanion")} description={tr("pet.desktopOnlyBody")} first={true}>
          <Text accessibilityLabel="desktop-companion-desktop-only" style={textStyle("caption")}>
            {tr("pet.desktopOnly")}
          </Text>
        </SettingsRow>
      }
    >
      <View>
        <If when={companionNotice()}>
          {notice => <InlineBanner tone="danger" message={notice()} onDismiss={() => companionNotice.set("")} />}
        </If>
        <SettingsRow label={tr("pet.enabled")} description={tr("pet.enabledBody")} first={true}>
          <If when={companionEnabled() !== null}>
            <ToggleSwitch
              value={companionEnabled() === true}
              accessibilityLabel="pet-enabled"
              disabled={companionBusy() !== null}
              onChange={next => void setCompanionEnabled(next)}
            />
          </If>
        </SettingsRow>
        <SettingsRow label={tr("pet.character")} description={tr("pet.characterBody")} stacked={true}>
          <PetCharacterGrid />
          <View style={{ flexDirection: "row" }}>
            <Button
              label={tr("pet.import")}
              variant="secondary"
              size="sm"
              leadingIcon="upload"
              loading={companionBusy() === "import"}
              accessibilityLabel="pet-import"
              onPress={() => void pickCompanionPack()}
            />
          </View>
        </SettingsRow>
        <SettingsRow label={tr("cards.settingsEnabled")} description={tr("cards.settingsEnabledBody")}>
          <If when={desktopCardsEnabled() !== null}>
            <ToggleSwitch
              value={desktopCardsEnabled() === true}
              accessibilityLabel="desktop-cards-enabled"
              disabled={companionBusy() !== null}
              onChange={next => void setDesktopCardsEnabled(next)}
            />
          </If>
        </SettingsRow>
      </View>
    </If>
  );
}

/**
 * The memory folder and the reset the desktop's memory section offers. The
 * folder opens in the file manager of the machine that stores it; a reset asks
 * first.
 */
function MemoryActionsRow() {
  return (
    <View>
      <SettingsRow label={tr("settings.memory.actions")} description={tr("settings.memory.actionsDesc")}>
        <Button
          label={tr("settings.memory.openFolder")}
          variant="secondary"
          size="sm"
          leadingIcon="folder-open"
          loading={memoryActionBusy() === "open"}
          disabled={memoryActionBusy() !== null}
          accessibilityLabel="memory-open-folder"
          onPress={() => void openMemoryFolder()}
        />
        <InlineDeleteConfirm
          confirming={memoryResetPending()}
          onConfirmingChange={next => memoryResetPending.set(next)}
          label={tr("settings.memory.reset")}
          variant="danger"
          size="sm"
          loading={memoryActionBusy() === "reset"}
          disabled={memoryActionBusy() !== null}
          accessibilityLabel="memory-reset"
          confirmAccessibilityLabel="memory-reset-confirm"
          onConfirm={() => void resetMemory()}
        />
      </SettingsRow>
    </View>
  );
}

/** States why a section is missing, instead of leaving a page silently empty. */
/** How much an unsupported row fades (visual spec §3 Settings row). */
const UNSUPPORTED_OPACITY = 0.4;

/** The device Settings' Device scope reads (the scope chip's device). */
function scopeDeviceName(): string {
  const id = deviceContext();
  return id ? (fleetDeviceById(id)?.name ?? "") : "";
}

/** "Not available on {device}" for the device the scope chip names. */
function unsupportedOnDevice(): string {
  const name = scopeDeviceName();
  return name ? tr("settings.unsupported", { device: name }) : tr("settings.unsupportedHere");
}

/**
 * A row the device cannot offer: the title at 40 % with the reason under it;
 * an action that still applies (open another page) stays at full strength.
 */
function UnsupportedNote(props: { title: string; message: string; children?: JSX.Element }) {
  return (
    <SettingsGroup id={`unsupported-${props.title}`} title={props.title} hideTitle={true}>
      <View style={{ opacity: UNSUPPORTED_OPACITY }} accessibilityLabel="settings-unsupported-row">
        <SettingsRow label={props.title} description={props.message} first={true} />
      </View>
      <If when={Boolean(props.children)}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            paddingHorizontal: SETTINGS_ROW_INSET,
            paddingBottom: space.md,
          }}
        >
          {props.children}
        </View>
      </If>
    </SettingsGroup>
  );
}

// ── Account › OpenBitFun (the cloud agent's switch, model, usage and data) ──

interface SuperagentStatusView {
  enabled: boolean;
  model?: string;
  usage?: string;
}

const obfStatus = signal<SuperagentStatusView | null>(null);
const obfState = signal<"loading" | "ready" | "unsupported" | "failed">("loading");
const obfNote = signal("");
const obfWriteError = signal("");
const obfBusy = signal(false);
const obfDeleteOpen = signal(false);

/** The cloud agent's device on a fleet connection (the navigator lists it). */
function cloudTarget(): string {
  return fleetDevices().find(device => device.hostKind === "cloud")?.deviceId ?? "cloud";
}

function readSuperagentStatus(raw: unknown): SuperagentStatusView {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;
  return {
    enabled: record.enabled === true,
    model: text(record.model) ?? text(record.modelName),
    usage: text(record.usageThisMonth) ?? text(record.usageLabel),
  };
}

async function superagentCall(command: string, request: Record<string, unknown>): Promise<unknown> {
  return invokeCommand<unknown>(command, request, { target: cloudTarget() });
}

function failSuperagent(error: unknown, command: string, writeOnly = false): void {
  if (isCommandUnavailable(error, command)) {
    obfState.set("unsupported");
    obfNote.set("");
    obfWriteError.set("");
    return;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (writeOnly && obfState() === "ready" && obfStatus() !== null) {
    obfWriteError.set(message);
    return;
  }
  obfState.set("failed");
  obfNote.set(message);
}

async function loadSuperagentStatus(): Promise<void> {
  if (obfStatus() === null) obfState.set("loading");
  try {
    obfStatus.set(readSuperagentStatus(await superagentCall("superagent_status", {})));
    obfState.set("ready");
    obfNote.set("");
    obfWriteError.set("");
  } catch (error) {
    failSuperagent(error, "superagent_status");
  }
}

async function setSuperagentEnabled(next: boolean): Promise<void> {
  const command = next ? "superagent_enable" : "superagent_disable";
  obfBusy.set(true);
  obfWriteError.set("");
  try {
    const answer = (await superagentCall(command, {})) as Record<string, unknown> | null;
    const current = obfStatus();
    // The node answers the state it stored; the switch shows that, not the press.
    const enabled = typeof answer?.enabled === "boolean" ? answer.enabled : next;
    if (current) obfStatus.set({ ...current, enabled });
    await loadSuperagentStatus();
  } catch (error) {
    failSuperagent(error, command, true);
  } finally {
    obfBusy.set(false);
  }
}

async function deleteSuperagentData(): Promise<void> {
  obfBusy.set(true);
  obfWriteError.set("");
  try {
    await superagentCall("superagent_delete_data", { cancelJobs: true });
    obfDeleteOpen.set(false);
    await loadSuperagentStatus();
  } catch (error) {
    obfDeleteOpen.set(false);
    failSuperagent(error, "superagent_delete_data", true);
  } finally {
    obfBusy.set(false);
  }
}

// ── Account › Profile: account settings sync (the backend reports the state) ──

function accountSyncStateText(): string {
  const status = accountSync();
  switch (status?.phase) {
    case "synced":
      return (status.peers ?? 0) === 0 ? tr("settings.sync.state.only") : tr("settings.sync.state.synced");
    case "syncing":
      return tr("settings.sync.state.syncing");
    case "offline":
      return tr("settings.sync.state.offline");
    case "off":
      return tr("settings.sync.state.off");
    case "signed_out":
      return tr("settings.sync.state.signedOut");
    default:
      return tr("settings.sync.state.unavailable");
  }
}

function accountSyncDetail(): string {
  const status = accountSync();
  const parts: string[] = [];
  if ((status?.peers ?? 0) > 0) {
    parts.push(tr("settings.sync.peers", { online: String(status?.peersOnline ?? 0), total: String(status?.peers ?? 0) }));
  }
  if ((status?.pending ?? 0) > 0) parts.push(tr("settings.sync.pending", { count: String(status?.pending ?? 0) }));
  if (status?.phase === "synced" && typeof status.lastSyncedAtMs === "number") {
    parts.push(tr("settings.sync.lastSynced", { time: formatRelativeTime(status.lastSyncedAtMs) }));
  }
  return parts.join(" · ");
}

function AccountSyncSection() {
  void loadAccountSync();
  const writeErrorText = (): string => {
    const raw = accountSyncWriteError();
    if (!raw) return "";
    return raw === "save_failed" ? tr("settings.sync.saveFailed") : localizeHostError(raw);
  };
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="settings-account-sync">
      <If when={accountSyncLoad() === "idle" || accountSyncLoad() === "loading"}>
        <View
          accessibilityLabel="account-sync-loading"
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs }}
        >
          <Spinner size={12} color={palette().textMuted} />
          <Text style={textStyle("caption")}>{tr("settings.sync.loading")}</Text>
        </View>
      </If>
      <If when={accountSyncLoad() === "unsupported"}>
        <UnsupportedNote title={tr("settings.sync.title")} message={tr("settings.sync.hostUnsupported")} />
      </If>
      <If when={accountSyncLoad() === "failed"}>
        <InlineBanner
          tone="danger"
          accessibilityLabel="account-sync-load-failed"
          message={localizeHostError(accountSyncNote())}
          actionLabel={tr("common.retry")}
          onAction={() => void loadAccountSync()}
        />
      </If>
      <If when={accountSyncLoad() === "ready" && accountSync() !== null}>
        <If when={writeErrorText()}>
          {message => (
            <InlineBanner
              tone="danger"
              accessibilityLabel="account-sync-write-failed"
              message={message()}
              onDismiss={() => clearAccountSyncWriteError()}
            />
          )}
        </If>
        <SettingsGroup id="account-sync" title={tr("settings.sync.title")} hideTitle={true}>
          <SettingsRow label={tr("settings.sync.title")} description={tr("settings.sync.body")} first={true}>
            <ToggleSwitch
              value={accountSync()?.enabled !== false}
              disabled={accountSyncBusy()}
              accessibilityLabel="account-sync-toggle"
              onChange={next => void setAccountSyncEnabled(next)}
            />
          </SettingsRow>
          <SettingsRow label={tr("settings.sync.status")} description={accountSyncDetail() || undefined}>
            <Text accessibilityLabel="account-sync-state" style={textStyle("label", { color: palette().textMuted })}>
              {accountSyncStateText()}
            </Text>
          </SettingsRow>
        </SettingsGroup>
      </If>
    </View>
  );
}

function OpenBitFunSection() {
  void loadSuperagentStatus();
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel="settings-openbitfun">
      <If when={obfState() === "loading"}>
        <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("settings.loading")}</Text>
      </If>
      <If when={obfState() === "unsupported"}>
        <UnsupportedNote title={tr("obf.toggle")} message={tr("obf.unsupported")} />
      </If>
      <If when={obfState() === "failed"}>
        <InlineBanner
          tone="danger"
          accessibilityLabel="obf-load-failed"
          message={localizeHostError(obfNote())}
          actionLabel={tr("common.retry")}
          onAction={() => void loadSuperagentStatus()}
        />
      </If>
      <If when={obfState() === "ready" && obfStatus() !== null}>
        <View style={{ gap: layout.sectionGap }}>
          <If when={obfWriteError()}>
            {err => (
              <InlineBanner
                tone="danger"
                accessibilityLabel="obf-write-failed"
                message={localizeHostError(err())}
                onDismiss={() => obfWriteError.set("")}
              />
            )}
          </If>
          <SettingsGroup id="openbitfun" title={tr("obf.toggle")} hideTitle={true}>
            <SettingsRow label={tr("obf.toggle")} description={tr("obf.toggleBody")} first={true}>
              <ToggleSwitch
                value={obfStatus()?.enabled === true}
                disabled={obfBusy()}
                accessibilityLabel="obf-toggle"
                onChange={next => void setSuperagentEnabled(next)}
              />
            </SettingsRow>
            <If when={obfStatus()?.model ?? ""}>
              {model => (
                <SettingsRow label={tr("obf.model")}>
                  <RowValue text={model()} />
                </SettingsRow>
              )}
            </If>
            <If when={obfStatus()?.usage ?? ""}>
              {usage => (
                <SettingsRow label={tr("obf.usage")}>
                  <RowValue text={usage()} />
                </SettingsRow>
              )}
            </If>
          </SettingsGroup>
          <SettingsGroup id="openbitfun-data" title={tr("obf.deleteData")} hideTitle={true}>
            <SettingsRow label={tr("obf.deleteData")} description={tr("obf.deleteBody")} first={true}>
              <InlineDeleteConfirm
                confirming={obfDeleteOpen()}
                onConfirmingChange={next => obfDeleteOpen.set(next)}
                label={tr("common.delete")}
                variant="secondary"
                size="sm"
                loading={obfBusy()}
                disabled={obfBusy()}
                accessibilityLabel="obf-delete-data"
                confirmAccessibilityLabel="obf-delete-confirm"
                cancelAccessibilityLabel="obf-delete-cancel"
                onConfirm={() => void deleteSuperagentData()}
              />
            </SettingsRow>
          </SettingsGroup>
        </View>
      </If>
    </View>
  );
}

// ── Account › Activity (the six-month heatmap the host computes) ──

/** Cell and gap of the activity heatmap (visual spec §4.9: 10 px cells, 2 px gap). */
const ACTIVITY_CELL = space.sm + space.hair;
const ACTIVITY_GAP = space.hair;
const ACTIVITY_CELL_RADIUS = radii.xs;
/** Accent opacity per level; a day without tokens is `heatmapZero`. */
const ACTIVITY_STEPS = [0.12, 0.3, 0.5, 0.75, 1] as const;

const activityView = signal<UsageActivityView | null>(null);
const activityState = signal<"loading" | "ready" | "unsupported" | "failed">("loading");
const activityNote = signal("");

async function loadActivity(): Promise<void> {
  if (activityView() === null) activityState.set("loading");
  try {
    activityView.set(await fetchUsageActivity());
    activityState.set("ready");
    activityNote.set("");
  } catch (error) {
    if (error instanceof UsageActivityUnavailable && error.reason === "host_outdated") {
      activityState.set("unsupported");
      activityNote.set("");
    } else {
      activityState.set("failed");
      activityNote.set(error instanceof Error ? error.message : String(error ?? ""));
    }
  }
}

/** The week columns of the host's Monday-first grid, as the host sent them. */
function activityWeeks(): UsageActivityCell[][] {
  const view = activityView();
  if (!view) return [];
  const weeks: UsageActivityCell[][] = [];
  for (let index = 0; index < view.days.length; index += 7) weeks.push(view.days.slice(index, index + 7));
  return weeks;
}

function ActivityCellView(props: { cell: UsageActivityCell }) {
  const empty = () => !props.cell.inRange;
  const zero = () => props.cell.inRange && props.cell.tokens <= 0;
  const stepIndex = () => Math.max(0, Math.min(ACTIVITY_STEPS.length - 1, props.cell.level));
  return (
    <View
      style={{
        width: ACTIVITY_CELL,
        height: ACTIVITY_CELL,
        borderRadius: ACTIVITY_CELL_RADIUS,
        backgroundColor: empty() ? "transparent" : zero() ? palette().heatmapZero : palette().accent,
        opacity: empty() || zero() ? 1 : ACTIVITY_STEPS[stepIndex()],
      }}
    />
  );
}

// ── Account › Activity › Insights (the reports the device's model writes from recent sessions) ──

/** The report's HTML file lives on the device that wrote it; only that device's file manager can show it. */
function insightsOnThisDevice(): boolean {
  if (!fleetActive()) return true;
  const id = deviceContext();
  return !id || fleetDeviceById(id)?.isClientDevice === true;
}

function InsightsStatusLine() {
  return (
    <>
      <If when={insightsGenerating()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Spinner size={12} color={palette().accent} />
          <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), flex: 1, minWidth: 0 }}>
            {insightsProgress() || tr("settings.insights.generating")}
          </Text>
        </View>
      </If>
      <If when={!insightsGenerating() && insightsNotice() ? insightsNotice() : ""}>
        {notice => <Text style={textStyle("caption", { color: palette().textSecondary })}>{notice()}</Text>}
      </If>
      <If when={insightsError()}>
        {error => (
          <Text accessibilityLabel="activity-insights-error" style={textStyle("caption", { color: stateColor("failed") })}>
            {localizeHostError(error())}
          </Text>
        )}
      </If>
      <If when={!insightsGenerating() && !insightsError() && !insightsNotice() && insightsMetas().length === 0}>
        <Text style={textStyle("caption", { color: palette().textMuted })}>
          {insightsLoading() ? tr("settings.insights.loading") : tr("settings.insights.empty")}
        </Text>
      </If>
    </>
  );
}

function InsightsReportRow(props: { index: number; path: string; title: string; detail: string }) {
  return (
    <View
      role="button"
      accessibilityLabel={`activity-insight-report-${props.index}`}
      onPress={() => void openInsightsReport(props.path, true)}
      style={{
        position: "relative",
        minHeight: SETTINGS_ROW_MIN,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        cursor: "pointer",
        userSelect: "none",
        backgroundColor: selectedInsightsPath() === props.path ? palette().panelHover : undefined,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <RowSeparator edge="top" />
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text style={{ ...textStyle("body"), numberOfLines: 1, textOverflow: "ellipsis" }}>{props.title}</Text>
        <If when={props.detail}>
          {detail => (
            <Text style={{ ...textStyle("caption", { color: palette().textMuted }), numberOfLines: 1, textOverflow: "ellipsis" }}>
              {detail()}
            </Text>
          )}
        </If>
      </View>
      <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("settings.insights.read")}</Text>
      <Icon name="chevron-right" size={12} color={palette().textMuted} />
    </View>
  );
}

function InsightsSection() {
  return (
    <SettingsSection
      title={tr("settings.insights.title")}
      subtitle={tr("settings.insights.body")}
      flush={true}
      extra={
        <IconButton
          icon="refresh"
          size="xs"
          disabled={insightsLoading()}
          tooltip={tr("settings.insights.reload")}
          accessibilityLabel="activity-reload-insights"
          onPress={() => void loadLatestInsights()}
        />
      }
    >
      <View accessibilityLabel="activity-insights" style={{ minWidth: 0 }}>
        <View
          style={{
            minHeight: SETTINGS_ROW_MIN,
            paddingHorizontal: SETTINGS_ROW_INSET,
            paddingVertical: space.sm,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          <SelectDropdown
            size="sm"
            options={INSIGHTS_DAY_OPTIONS.map(days => ({
              value: String(days),
              label: tr("settings.insights.days", { count: days }),
              accessibilityLabel: `activity-insights-days-${days}`,
            }))}
            value={String(insightsDays())}
            disabled={insightsGenerating()}
            accessibilityLabel="activity-insights-days"
            onChange={value => insightsDays.set(Number(value))}
          />
          <SelectDropdown
            size="sm"
            options={[
              { value: "primary", label: tr("settings.insights.modelPrimary"), accessibilityLabel: "activity-insights-model-primary" },
              { value: "fast", label: tr("settings.insights.modelFast"), accessibilityLabel: "activity-insights-model-fast" },
            ]}
            value={insightsModel()}
            disabled={insightsGenerating()}
            accessibilityLabel="activity-insights-model"
            onChange={value => insightsModel.set(value === "fast" ? "fast" : "primary")}
          />
          <View style={{ flex: 1 }} />
          <If
            when={insightsGenerating()}
            else={
              <Button
                label={tr("settings.insights.generate")}
                variant="secondary"
                size="sm"
                accessibilityLabel="activity-generate-insights"
                onPress={() => void generateInsightsReport()}
              />
            }
          >
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              accessibilityLabel="activity-cancel-insights"
              onPress={() => void cancelInsights()}
            />
          </If>
        </View>
        <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingBottom: space.md, gap: space.xs }}>
          <InsightsStatusLine />
        </View>
        <Each of={insightsMetas().slice(0, 4)} key={item => item.path}>
          {(item, index) => (
            <InsightsReportRow
              index={index()}
              path={item().path}
              title={item().title}
              detail={[
                item().dateRangeLabel,
                item().totalSessions > 0
                  ? formatPlural(item().totalSessions, "format.sessionOne", "format.sessionOther")
                  : "",
                item().generatedAtText,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
        </Each>
      </View>
    </SettingsSection>
  );
}

/** The report reader: the report's Markdown, generate again, and its HTML file on the device that wrote it. */
function InsightsReader() {
  return (
    <If when={insightsModalOpen() ? activeInsightsReport() : null}>
      {report => (
        <ModalDialog
          open={true}
          size="lg"
          title={report().title}
          subtitle={report().subtitle || undefined}
          accessibilityLabel="insights-reader-modal"
          onClose={closeInsightsModal}
          footer={
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
              <Button
                label={tr("settings.insights.regenerate")}
                variant="secondary"
                size="md"
                disabled={insightsGenerating()}
                accessibilityLabel="insights-regenerate"
                onPress={() => void generateInsightsReport()}
              />
              <If when={report().htmlPath}>
                <Button
                  label={tr("settings.insights.showHtml")}
                  variant="secondary"
                  size="md"
                  disabled={!insightsOnThisDevice()}
                  tooltip={insightsOnThisDevice() ? undefined : tr("settings.insights.htmlElsewhere")}
                  accessibilityLabel="insights-show-html"
                  onPress={() => void revealInsightsHtml(report().htmlPath)}
                />
              </If>
              <Button label={tr("common.close")} variant="primary" size="md" onPress={closeInsightsModal} />
            </View>
          }
        >
          <View style={{ width: "100%", maxWidth: layout.conversationWidth, alignSelf: "center" }}>
            <TextView
              markdown={report().markdown}
              selectable={true}
              links="open"
              options={STATIC_MARKDOWN_OPTIONS}
              codeBlockActions={createMarkdownCodeActions()}
              styles={createMarkdownStyles({ baseFontSize: 14 })}
            />
          </View>
        </ModalDialog>
      )}
    </If>
  );
}

function ActivityPage() {
  void loadActivity();
  void loadLatestInsights();
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel="settings-activity">
      <If when={activityState() === "loading"}>
        <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("settings.loading")}</Text>
      </If>
      <If when={activityState() === "unsupported"}>
        <UnsupportedNote title={tr("settings.page.activity")} message={tr("settings.activity.updateNeeded")} />
      </If>
      <If when={activityState() === "failed"}>
        <InlineBanner
          tone="danger"
          message={localizeHostError(activityNote())}
          actionLabel={tr("common.retry")}
          onAction={() => void loadActivity()}
        />
      </If>
      <If when={activityState() === "ready"}>
        <View style={{ gap: space.lg }}>
          <Text accessibilityLabel="settings-activity-summary" style={textStyle("body", { color: palette().textSecondary })}>
            {tr("settings.activity.summary", {
              tokens: formatTokens(activityView()?.totalTokens ?? 0) || "0",
              days: activityView()?.activeDays ?? 0,
            })}
          </Text>
          <Scroll horizontal={true} style={{ width: "100%", minWidth: 0 }}>
            <View
              accessibilityLabel="settings-activity-heatmap"
              style={{ flexDirection: "row", gap: ACTIVITY_GAP }}
            >
              <Each of={activityWeeks()} key="index">
                {week => (
                  <View style={{ flexDirection: "column", gap: ACTIVITY_GAP }}>
                    <Each of={week()} key="index">
                      {cell => <ActivityCellView cell={cell()} />}
                    </Each>
                  </View>
                )}
              </Each>
            </View>
          </Scroll>
        </View>
      </If>
      <InsightsSection />
      <InsightsReader />
    </View>
  );
}

// ── Device › Archived sessions ──

const archivedRestoring = signal<string | null>(null);
const archivedDeleteAllOpen = signal(false);
const archivedDeletingAll = signal(false);
/**
 * Archived sessions loaded from `list_archived_sessions` for the selected
 * device and workspace; `null` means the host does not offer the command (an
 * older build or legacy fixture), in which case we fall back to filtering the
 * loaded `sessions()` catalogue.
 */
const archivedSessionsFromHost = signal<SessionSummary[] | null>(null);
const archivedSessionsLoading = signal(false);
const archivedSessionsError = signal("");
let archivedLoadTicket = 0;

function normalizeArchivedSession(raw: unknown): SessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sessionId = String(record.sessionId ?? record.session_id ?? "").trim();
  if (!sessionId) return null;
  const sessionName = String(record.sessionName ?? record.session_name ?? record.title ?? "");
  const workspaceId =
    typeof record.workspaceId === "string"
      ? record.workspaceId
      : typeof record.workspace_id === "string"
        ? record.workspace_id
        : undefined;
  return {
    sessionId,
    sessionName,
    workspaceId,
    status: "archived",
    persistedStatus: "archived",
    lastUpdated:
      typeof record.lastActiveAt === "number"
        ? record.lastActiveAt
        : typeof record.lastUpdated === "number"
          ? record.lastUpdated
          : undefined,
    messageCount:
      typeof record.turnCount === "number"
        ? record.turnCount
        : typeof record.messageCount === "number"
          ? record.messageCount
          : undefined,
  };
}

function archivedTargetOptions(): { target: string } | undefined {
  const ctx = deviceContext();
  return fleetActive() && ctx ? { target: ctx } : undefined;
}

async function loadArchivedSessions(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace) {
    archivedSessionsFromHost.set(null);
    archivedSessionsError.set("");
    return;
  }
  const ticket = ++archivedLoadTicket;
  archivedSessionsLoading.set(true);
  archivedSessionsError.set("");
  try {
    const raw = await invokeCommand<unknown[]>(
      "list_archived_sessions",
      {
        workspace_id: workspace.id,
        workspace_path: workspace.rootPath,
        ...(workspace.connectionId ? { remote_connection_id: workspace.connectionId } : {}),
        ...(workspace.sshHost ? { remote_ssh_host: workspace.sshHost } : {}),
      },
      archivedTargetOptions(),
    );
    if (ticket !== archivedLoadTicket) return;
    const list = (Array.isArray(raw) ? raw : [])
      .map(normalizeArchivedSession)
      .filter((item): item is SessionSummary => item !== null);
    archivedSessionsFromHost.set(list);
  } catch (error) {
    if (ticket !== archivedLoadTicket) return;
    if (isCommandUnavailable(error, "list_archived_sessions")) {
      archivedSessionsFromHost.set(null);
      archivedSessionsError.set("");
    } else {
      archivedSessionsFromHost.set([]);
      archivedSessionsError.set(localizeHostError(errorMessageOf(error)));
    }
  } finally {
    if (ticket === archivedLoadTicket) {
      archivedSessionsLoading.set(false);
    }
  }
}

async function restoreArchivedSession(row: SessionSummary): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace || archivedRestoring() === row.sessionId) return;
  archivedRestoring.set(row.sessionId);
  try {
    if (archivedSessionsFromHost() !== null) {
      await invokeCommand<unknown>(
        "unarchive_session",
        {
          sessionId: row.sessionId,
          workspaceId: row.workspaceId || workspace.id,
        },
        archivedTargetOptions(),
      );
      archivedSessionsFromHost.update(list => (list ? list.filter(item => item.sessionId !== row.sessionId) : list));
      if (fleetActive()) {
        void refreshFleetNavigator();
      } else {
        await loadSessions();
      }
    } else {
      await archiveSessionRow(row.sessionId, false);
    }
  } catch (error) {
    pushToast(localizeHostError(errorMessageOf(error)), "error");
  } finally {
    if (archivedRestoring() === row.sessionId) {
      archivedRestoring.set(null);
    }
  }
}

/** `delete_all_archived_sessions` for the open workspace; the catalogue is read again after. */
async function deleteAllArchived(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace || archivedDeletingAll()) return;
  archivedDeletingAll.set(true);
  try {
    const deleted = await invokeCommand<number>(
      "delete_all_archived_sessions",
      {
        workspace_id: workspace.id,
        workspace_path: workspace.rootPath,
        ...(workspace.connectionId ? { remote_connection_id: workspace.connectionId } : {}),
        ...(workspace.sshHost ? { remote_ssh_host: workspace.sshHost } : {}),
      },
      archivedTargetOptions(),
    );
    archivedDeleteAllOpen.set(false);
    pushToast(tr("settings.archived.deletedAll", { count: typeof deleted === "number" ? deleted : 0 }), "success");
    if (archivedSessionsFromHost() !== null) {
      archivedSessionsFromHost.set([]);
    }
    await loadArchivedSessions();
    await loadSessions();
  } catch (error) {
    pushToast(localizeHostError(errorMessageOf(error)), "error");
  } finally {
    archivedDeletingAll.set(false);
  }
}

/** These commands operate on the desktop's snapshot store, including its local SSH mirrors. */
function localSnapshotStorageAvailable(): boolean {
  return windowShellId() === "nsh-desktop" && !isRemotePeerContext()
    && (!fleetActive() || !deviceContext() || deviceContext() === entryDeviceId());
}

function SnapshotStorageSection() {
  const period = signal<SnapshotPeriod>("thirtyDays");
  const workspace = signal("");
  const data = signal<SnapshotStorageOverview | null>(null);
  const scanning = signal(false);
  const cleaning = signal(false);
  const confirming = signal(false);
  const error = signal("");
  const outcome = signal<{ message: string; warning: boolean } | null>(null);
  const expanded = signal<string[]>([]);
  let mounted = true;
  cleanup(() => { mounted = false; });

  const busy = () => scanning() || cleaning() || confirming();
  const rows = () => (data()?.workspaces ?? []).filter(row => !workspace() || row.workspaceId === workspace());
  const count = () => rows().reduce((sum, row) => sum + row.candidates.length, 0);
  const excluded = () => rows().reduce((sum, row) => sum + row.skippedSessions, 0);
  const preview = () => tr("storage.preview", {
    sessions: formatCount(count()),
    size: formatBytes(rows().reduce((sum, row) => sum + row.estimatedBytes, 0)),
  });
  const describeError = (cause: unknown, command: string) => isCommandUnavailable(cause, command)
    ? tr("storage.hostUnsupported") : localizeHostError(errorMessageOf(cause));

  async function scan() {
    if (!mounted || scanning() || !localSnapshotStorageAvailable()) return;
    scanning.set(true);
    error.set("");
    try {
      const result = await inspectSnapshotStorage(period());
      if (!mounted) return;
      data.set(result);
      if (!result.workspaces.some(row => row.workspaceId === workspace())) workspace.set("");
    } catch (cause) {
      if (mounted) {
        data.set(null);
        error.set(describeError(cause, "inspect_snapshot_storage"));
      }
    } finally {
      if (mounted) scanning.set(false);
    }
  }
  untracked(() => void scan());

  async function clean() {
    if (!confirming() || cleaning() || scanning() || !localSnapshotStorageAvailable()) return;
    const selected = rows().filter(row => row.candidates.length);
    const reviewedPeriod = period();
    cleaning.set(true);
    confirming.set(false);
    outcome.set(null);
    let removed = 0;
    let skipped = 0;
    let freed = 0;
    const errors: string[] = [];
    for (const row of selected) {
      try {
        const result = await cleanSnapshotStorage(row.workspaceId, reviewedPeriod, row.candidates);
        removed += result.removedSessions;
        skipped += result.skippedSessions;
        freed += result.freedBytes;
        errors.push(...result.errors);
      } catch (cause) {
        skipped += row.candidates.length;
        errors.push(row.name + " · " + describeError(cause, "clean_snapshot_storage"));
      }
    }
    if (!mounted) return;
    const summary = tr("storage.result", { sessions: formatCount(removed), skipped: formatCount(skipped), size: formatBytes(freed) });
    outcome.set({ message: [summary, ...errors].join("\n"), warning: skipped > 0 || errors.length > 0 });
    await scan();
    if (mounted) cleaning.set(false);
  }

  return (
    <View style={{ gap: layout.sectionGap }}>
      <SettingsGroup id="snapshot-usage" title={tr("storage.snapshots")} description={tr("storage.device")}
        extra={<IconButton icon="refresh" size="xs" tooltip={tr("storage.refresh")} disabled={busy()}
          accessibilityLabel="snapshot-storage-refresh" onPress={() => void scan()} />}>
        <If when={scanning()}><SettingsRow first label={tr("storage.scanning")} /></If>
        <If when={error()}>{msg => <InlineBanner tone="danger" message={msg()} />}</If>
        <If when={data()}>{overview => <>
          <SettingsRow first label={tr("storage.total")}>
            <Text style={textStyle("sectionTitle")}>{formatBytes(overview().totalBytes)}</Text>
          </SettingsRow>
          <If when={overview().scanErrors.length > 0}>
            <InlineBanner tone="warning" message={[tr("storage.incomplete"), ...overview().scanErrors].join("\n")} />
          </If>
          <Each of={overview().workspaces} key={row => row.workspaceId}>{row =>
            <SettingsRow label={row().name} description={row().location}>
              <View style={{ alignItems: "flex-end", gap: space.xs }}>
                <Text style={textStyle("label")}>{formatBytes(row().bytes)}</Text>
                <Text style={textStyle("caption")}>{tr("storage.sharedColumn")} · {row().warning ? "—" : formatBytes(row().sharedBytes)}</Text>
              </View>
            </SettingsRow>
          }</Each>
          <If when={overview().unidentifiedBytes > 0}>
            <SettingsRow label={tr("storage.unidentified")} description={tr("storage.unidentifiedHint")}>
              <Text style={textStyle("label")}>{formatBytes(overview().unidentifiedBytes)}</Text>
            </SettingsRow>
          </If>
        </>}</If>
      </SettingsGroup>
      <If when={data()}>{overview =>
        <SettingsGroup id="snapshot-cleanup" title={tr("storage.cleanup")}>
          <SettingsRow first label={tr("storage.scope")}>
            <SelectDropdown value={workspace()} size="sm" disabled={busy()} accessibilityLabel="snapshot-storage-workspace"
              options={[{ value: "", label: tr("storage.allWorkspaces") }, ...overview().workspaces.map(row => ({
                value: row.workspaceId, label: row.name, description: row.location, accessibilityLabel: "snapshot-scope-" + row.workspaceId,
              }))]} onChange={value => { workspace.set(value); outcome.set(null); }} />
          </SettingsRow>
          <SettingsRow label={tr("storage.period")}>
            <SelectDropdown<SnapshotPeriod> value={period()} size="sm" disabled={busy()} accessibilityLabel="snapshot-storage-period"
              options={[
                { value: "thirtyDays", label: tr("storage.thirtyDays") },
                { value: "sevenDays", label: tr("storage.sevenDays") },
                { value: "all", label: tr("storage.all") },
              ]} onChange={value => {
                if (value === period()) return;
                period.set(value);
                outcome.set(null);
                void scan();
              }} />
          </SettingsRow>
          <If when={!scanning()}>
            <Each of={rows()} key={row => row.workspaceId}>{row => <>
              <If when={row().warning || row().unverifiedReferences}>
                <InlineBanner tone="warning" message={row().name + " · " + (row().warning ?? tr("storage.unverified"))} />
              </If>
              <If when={row().candidates.length > 0}>
                <SettingsRow label={row().name} description={row().location}>
                  <Button variant="ghost" size="sm" label={tr("storage.sessionCount", { sessions: formatCount(row().candidates.length) })}
                    trailingIcon={expanded().includes(row().workspaceId) ? "chevron-up" : "chevron-down"}
                    accessibilityLabel={"snapshot-candidates-" + row().workspaceId}
                    onPress={() => expanded.update(ids => ids.includes(row().workspaceId)
                      ? ids.filter(id => id !== row().workspaceId) : [...ids, row().workspaceId])} />
                </SettingsRow>
                <If when={expanded().includes(row().workspaceId)}>
                  <Each of={row().candidates} key={item => item.sessionId}>{item =>
                    <SettingsRow label={item().name || item().sessionId}>
                      <Text style={textStyle("caption")}>{item().removed ? tr("storage.removedSession") :
                        tr("storage.lastActive") + " · " + formatDate(item().activeAt)}</Text>
                    </SettingsRow>
                  }</Each>
                </If>
              </If>
            </>}</Each>
            <SettingsRow label={count() ? preview() : tr("storage.noCandidates")}
              description={tr("storage.skipped", { sessions: formatCount(excluded()) })}>
              <Button label={tr("storage.cleanup")} variant="secondary" size="sm" disabled={busy() || !count()}
                accessibilityLabel="snapshot-storage-clean" onPress={() => confirming.set(true)} />
            </SettingsRow>
          </If>
        </SettingsGroup>
      }</If>
      <If when={outcome()}>{result => <InlineBanner tone={result().warning ? "warning" : "success"} message={result().message} />}</If>
      <ModalDialog open={confirming()} title={tr("storage.confirmTitle")} size="sm"
        subtitle={tr("storage.confirm", { preview: preview() })} onClose={() => confirming.set(false)}
        footer={<View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          <Button label={tr("common.cancel")} variant="secondary" onPress={() => confirming.set(false)} />
          <Button label={tr("storage.cleanup")} variant="danger" accessibilityLabel="snapshot-storage-confirm"
            onPress={() => void clean()} />
        </View>} />
    </View>
  );
}

function ArchivedSessionsSection() {
  effect(() => {
    const _device = deviceContext();
    const _wsId = activeWorkspace()?.id ?? "";
    const _wsPath = activeWorkspace()?.rootPath ?? "";
    const _total = sessionTotal();
    void _device;
    void _wsId;
    void _wsPath;
    void _total;
    untracked(() => {
      void loadArchivedSessions();
    });
  });
  const rows = () => {
    const hostRows = archivedSessionsFromHost();
    if (hostRows !== null) return hostRows;
    return sessions().filter(item => isSessionArchived(item));
  };
  return (
    <View accessibilityLabel="settings-archived" style={{ gap: space.md }}>
      <If when={archivedSessionsError()}>
        {error => <Text style={textStyle("caption", { color: palette().danger })}>{error()}</Text>}
      </If>
      <If when={rows().length > 1}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <InlineDeleteConfirm
            confirming={archivedDeleteAllOpen()}
            onConfirmingChange={next => archivedDeleteAllOpen.set(next)}
            label={tr("settings.archived.deleteAll")}
            variant="ghost"
            size="sm"
            loading={archivedDeletingAll()}
            accessibilityLabel="settings-archived-delete-all"
            confirmAccessibilityLabel="settings-archived-delete-all-confirm"
            onConfirm={() => void deleteAllArchived()}
          />
        </View>
      </If>
      <If
        when={rows().length > 0}
        else={
          <If when={!archivedSessionsLoading()} else={<Spinner size={14} color={palette().accent} />}>
            <Text accessibilityLabel="settings-archived-empty" style={textStyle("body", { color: palette().textMuted })}>
              {tr("settings.archived.empty")}
            </Text>
          </If>
        }
      >
        <SettingsGroup id="archived" title={tr("settings.page.archived")} hideTitle={true}>
          <Each of={rows()} key={row => row.sessionId}>
            {(row, index) => (
              <SettingsRow label={row().sessionName || row().sessionId} first={index() === 0}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <InlineDeleteConfirm
                    label={tr("session.delete")}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={`settings-archived-delete-${row().sessionId}`}
                    confirmAccessibilityLabel="session-delete-confirm"
                    cancelAccessibilityLabel="session-delete-cancel"
                    onConfirm={() =>
                      void deleteSessionTarget({
                        sessionId: row().sessionId,
                        deviceId: deviceContext(),
                        workspaceId: row().workspaceId || activeWorkspace()?.id || "",
                        title: row().sessionName || row().sessionId,
                        archived: true,
                      })
                    }
                  />
                  <Button
                    label={tr("settings.archived.restore")}
                    variant="secondary"
                    size="sm"
                    loading={archivedRestoring() === row().sessionId}
                    accessibilityLabel={`settings-archived-restore-${row().sessionId}`}
                    onPress={() => void restoreArchivedSession(row())}
                  />
                </View>
              </SettingsRow>
            )}
          </Each>
        </SettingsGroup>
      </If>
    </View>
  );
}

/** The scope label of one external source (`user_global`, `project`, ...). */
function externalScopeLabel(scope: string): string {
  switch (scope) {
    case "user_global":
      return tr("settings.externalImports.scope.user");
    case "project":
      return tr("settings.externalImports.scope.project");
    case "workspace_local":
      return tr("settings.externalImports.scope.workspace");
    case "remote_user":
    case "remote_project":
      return tr("settings.externalImports.scope.remote");
    default:
      return scope;
  }
}

function externalHealthColor(health: string, lifecycle: string): string {
  if (lifecycle === "removed" || lifecycle === "unavailable" || health === "unavailable") return stateColor("failed");
  if (health === "degraded" || health === "partial" || lifecycle === "degraded") return stateColor("needs_you");
  return palette().textMuted;
}

function externalHealthLabel(health: string, lifecycle: string): string {
  if (lifecycle === "removed") return tr("settings.externalImports.health.removed");
  if (health === "unavailable" || lifecycle === "unavailable") return tr("settings.externalImports.health.unavailable");
  if (health === "degraded" || lifecycle === "degraded") return tr("settings.externalImports.health.degraded");
  if (health === "partial") return tr("settings.externalImports.health.partial");
  return tr("settings.externalImports.health.available");
}

/** The switch that lets the host scan other applications, with its scope. */
function ExternalDiscoveryRow() {
  const discovery = () => externalSnapshot()?.discovery ?? null;
  const description = () => {
    const state = discovery();
    if (!state) return tr("settings.externalImports.discoveryReadOnly");
    const lead = state.enabled
      ? tr("settings.externalImports.discoveryOn")
      : tr("settings.externalImports.discoveryOff");
    const scope = activeWorkspace()
      ? tr("settings.externalImports.workspaceScope")
      : tr("settings.externalImports.userScope");
    return state.canChange ? `${lead} ${scope}` : `${lead} ${tr("settings.externalImports.discoveryReadOnly")}`;
  };
  return (
    <SettingsRow label={tr("settings.externalImports.discovery")} description={description()} first={true}>
      <If when={externalDiscoverySaving()}>
        <Spinner size={13} color={palette().accent} />
      </If>
      <ToggleSwitch
        value={discovery()?.enabled ?? false}
        disabled={!discovery()?.canChange || externalDiscoverySaving()}
        accessibilityLabel="external-discovery-toggle"
        onChange={next => void setAutomaticDiscovery(next)}
      />
    </SettingsRow>
  );
}

/** One source another application exposes, with its scope and health. */
function ExternalSourceRowView(props: { row: () => ExternalSourceRow; first: () => boolean }) {
  return (
    <View
      accessibilityLabel={`external-source-${props.row().stableKey}`}
      style={{
        position: "relative",
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: SETTINGS_ROW_MIN,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
      }}
    >
      <If when={!props.first()}>
        <RowSeparator edge="top" />
      </If>
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text
          style={{
            ...textStyle("body"),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.row().displayName || props.row().ecosystemId}
        </Text>
        <Text
          style={{
            ...textStyle("caption"),
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {[externalScopeLabel(props.row().scope), props.row().location].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Text
        style={{
          ...textStyle("caption", { color: externalHealthColor(props.row().health, props.row().lifecycle) }),
          flexShrink: 0,
        }}
      >
        {externalHealthLabel(props.row().health, props.row().lifecycle)}
      </Text>
    </View>
  );
}

/** The sources and what they expose, or why the host could not be read. */
function ExternalSourcesGroup() {
  const snapshot = () => externalSnapshot();
  const summary = () => {
    const counts = snapshot()?.counts;
    if (!counts) return "";
    return tr("settings.externalImports.summary", {
      commands: formatCount(counts.commands),
      tools: formatCount(counts.tools),
      subagents: formatCount(counts.subagents),
      mcp: formatCount(counts.mcpServers),
    });
  };
  const emptyText = () => {
    const state = snapshot();
    if (state?.discoveryPending) return tr("settings.externalImports.scanning");
    if (state?.discovery && !state.discovery.hasScanned) {
      return state.discovery.enabled
        ? tr("settings.externalImports.scanning")
        : tr("settings.externalImports.notScanned");
    }
    return tr("settings.externalImports.notDetected");
  };
  return (
    <SettingsGroup
      id="external-import-sources"
      title={tr("settings.externalImports.sourcesTitle")}
      description={summary()}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <If when={externalLoadState() === "loading"}>
            <Spinner size={13} color={palette().accent} />
          </If>
          <Button
            label={tr("settings.externalImports.refresh")}
            variant="ghost"
            size="sm"
            leadingIcon="refresh"
            disabled={externalLoadState() === "loading" || snapshot()?.canRefresh === false}
            accessibilityLabel="external-import-refresh"
            onPress={() => void loadExternalImport(true)}
          />
        </View>
      }
    >
      <ExternalDiscoveryRow />
      <If when={externalDiscoveryError()}>
        {err => (
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingBottom: space.md }}>
            <InlineBanner
              tone="danger"
              accessibilityLabel="external-discovery-error"
              message={`${tr("settings.externalImports.discoverySaveFailed")} ${localizeHostError(err())}`}
            />
          </View>
        )}
      </If>
      <If
        when={(snapshot()?.sources.length ?? 0) > 0}
        else={
          <SettingsRow
            label={tr("settings.externalImports.sourcesTitle")}
            description={externalLoadState() === "loading" ? tr("common.loading") : emptyText()}
          />
        }
      >
        <View style={{ position: "relative" }}>
          <RowSeparator edge="top" />
          <Each of={snapshot()?.sources ?? []} key={row => row.stableKey}>
            {(row, index) => <ExternalSourceRowView row={row} first={() => index() === 0} />}
          </Each>
        </View>
      </If>
    </SettingsGroup>
  );
}

/** One MCP server another application declares, with what importing it would do. */
function McpImportRow(props: { item: () => McpImportItem; first: () => boolean }) {
  const selectable = () => mcpItemSelectable(props.item());
  const stateTextColor = (): string => {
    if (props.item().disposition === "already_imported") return palette().textMuted;
    if (selectable()) return palette().textSecondary;
    return stateColor("needs_you");
  };
  return (
    <View
      accessibilityLabel={`external-mcp-${props.item().candidateId}`}
      style={{
        position: "relative",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space.md,
        minHeight: SETTINGS_ROW_MIN,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: space.md,
      }}
    >
      <If when={!props.first()}>
        <RowSeparator edge="top" />
      </If>
      <View style={{ flex: 1, minWidth: 160, gap: space.hair }}>
        <Text
          style={{
            ...textStyle("body"),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.item().displayName}
        </Text>
        <Text
          style={{
            ...textStyle("caption"),
            numberOfLines: 2,
          }}
        >
          {[
            props.item().transport === "streamable_http"
              ? tr("settings.externalImports.transportHttp")
              : tr("settings.externalImports.transportStdio"),
            props.item().disposition === "automatic_rename" && props.item().proposedNativeId
              ? tr("settings.externalImports.renameTo", { name: props.item().proposedNativeId })
              : "",
            props.item().reasonCode === "external_mcp.import_setup_required"
              ? tr("settings.externalImports.setupRequired")
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <Text style={{ ...textStyle("caption", { color: stateTextColor() }), flexShrink: 0 }}>
        {tr(mcpItemStateKey(props.item()) as MessageKey)}
      </Text>
      <If when={selectable()}>
        <Button
          label={tr("settings.externalImports.import")}
          variant="secondary"
          size="sm"
          loading={mcpImportBusy() === props.item().candidateId}
          disabled={Boolean(mcpImportBusy())}
          accessibilityLabel={`external-mcp-import-${props.item().candidateId}`}
          onPress={() => void applyMcpImport(props.item().candidateId)}
        />
      </If>
    </View>
  );
}

/** The MCP servers that can be copied into OpenBitFun's own configuration. */
function ExternalMcpImportGroup() {
  const plan = () => mcpImportPlan();
  const readyCount = () => (plan()?.items ?? []).filter(mcpItemSelectable).length;
  const stateText = () => {
    switch (mcpPlanState()) {
      case "loading":
        return tr("common.loading");
      case "unsupported":
        return tr("settings.externalImports.unsupportedContext");
      case "error":
        return tr("settings.externalImports.previewFailed");
      default:
        return externalSnapshot()?.discovery?.enabled === false
          ? tr("settings.externalImports.mcpDiscoveryOff")
          : tr("settings.externalImports.mcpEmpty");
    }
  };
  const notice = () => {
    const value = externalMcpNotice();
    if (!value) return "";
    return value.name !== undefined ? tr(value.key as MessageKey, { name: value.name }) : tr(value.key as MessageKey);
  };
  return (
    <SettingsGroup
      id="external-import-mcp"
      title={tr("settings.externalImports.mcpTitle")}
      description={tr("settings.externalImports.mcpDescription")}
      extra={
        <If when={readyCount() > 0}>
          <Button
            label={tr("settings.externalImports.importAll", { count: formatCount(readyCount()) })}
            variant="primary"
            size="sm"
            loading={mcpImportBusy() === "*"}
            disabled={Boolean(mcpImportBusy())}
            accessibilityLabel="external-mcp-import-all"
            onPress={() => void applyMcpImport()}
          />
        </If>
      }
    >
      <If when={notice()}>
        {message => (
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingTop: space.md }}>
            <InlineBanner
              tone={externalMcpNotice()?.tone ?? "info"}
              accessibilityLabel="external-mcp-notice"
              message={message()}
              onDismiss={() => externalMcpNotice.set(null)}
            />
          </View>
        )}
      </If>
      <If
        when={mcpPlanState() === "ready" && (plan()?.items.length ?? 0) > 0}
        else={<SettingsRow label={tr("settings.externalImports.mcpTitle")} description={stateText()} first={true} />}
      >
        <Each of={plan()?.items ?? []} key={item => item.candidateId}>
          {(item, index) => <McpImportRow item={item} first={() => index() === 0} />}
        </Each>
      </If>
    </SettingsGroup>
  );
}

/** Source sessions the user removed from the list, which can be added again. */
function RemovedExternalSessionsGroup() {
  const stateText = () => {
    switch (removedSessionsState()) {
      case "idle":
      case "loading":
        return tr("common.loading");
      case "unsupportedHost":
        return tr("settings.externalImports.removedUnsupportedHost");
      case "error":
        return tr("settings.externalImports.removedLoadFailed");
      default:
        return tr("settings.externalImports.removedEmpty");
    }
  };
  return (
    <SettingsGroup
      id="external-import-removed"
      title={tr("settings.externalImports.removedTitle")}
      description={tr("settings.externalImports.removedDescription")}
      extra={
        <If when={removedSessionsState() === "error"}>
          <Button
            label={tr("common.retry")}
            variant="ghost"
            size="sm"
            accessibilityLabel="external-removed-retry"
            onPress={() => void loadRemovedSessions()}
          />
        </If>
      }
    >
      <If
        when={removedSessionsState() === "ready" && removedSessions().length > 0}
        else={<SettingsRow label={tr("settings.externalImports.removedTitle")} description={stateText()} first={true} />}
      >
        <Each of={removedSessions()} key={row => removedSessionKey(row)}>
          {(row, index) => (
            <View
              accessibilityLabel={`external-removed-${row().sessionId}`}
              style={{
                position: "relative",
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                minHeight: SETTINGS_ROW_MIN,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: space.md,
              }}
            >
              <If when={index() !== 0}>
                <RowSeparator edge="top" />
              </If>
              <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                <Text
                  style={{
                    ...textStyle("body"),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {row().sessionName}
                </Text>
                <Text
                  style={{
                    ...textStyle("caption", {
                      color:
                        removedRestoreFailed() === removedSessionKey(row())
                          ? stateColor("failed")
                          : palette().textMuted,
                    }),
                    numberOfLines: 2,
                  }}
                >
                  {removedRestoreFailed() === removedSessionKey(row())
                    ? tr("settings.externalImports.restoreFailed")
                    : [EXTERNAL_SESSION_NAMES[row().ecosystemId] ?? row().ecosystemId, row().workspaceName]
                        .filter(Boolean)
                        .join(" · ")}
                </Text>
              </View>
              <Button
                label={tr("settings.externalImports.restore")}
                variant="secondary"
                size="sm"
                loading={removedRestoreBusy() === removedSessionKey(row())}
                disabled={Boolean(removedRestoreBusy())}
                accessibilityLabel={`external-removed-restore-${row().sessionId}`}
                onPress={() => void restoreRemovedSession(row())}
              />
            </View>
          )}
        </Each>
      </If>
    </SettingsGroup>
  );
}

/**
 * External import: the sources other AI applications expose on the host, the
 * host's automatic discovery, MCP servers that can be copied into OpenBitFun and
 * removed source sessions. The page reads the host this surface drives; a remote
 * workspace and an older host each get their own sentence instead of an empty
 * page, and the External agents page stays one press away.
 */
function ExternalImportSection() {
  effect(() => {
    void deviceContext();
    void activeWorkspace()?.id;
    untracked(() => syncExternalImportScope());
  });
  const openAgents = () => (
    <Button
      label={tr("settings.externalImports.openAgents")}
      variant="secondary"
      size="sm"
      accessibilityLabel="external-import-open-agents"
      onPress={() => requestSettingsPage("external-agents")}
    />
  );
  return (
    <View style={{ gap: layout.sectionGap }}>
      <If when={externalBlock() === "remoteWorkspace"}>
        <UnsupportedNote
          title={tr("settings.externalImports.title")}
          message={tr("settings.externalImports.remoteWorkspace")}
        >
          {openAgents()}
        </UnsupportedNote>
      </If>
      <If when={externalBlock() === "incompatible"}>
        <UnsupportedNote
          title={tr("settings.externalImports.title")}
          message={unsupportedOnDevice()}
        >
          {openAgents()}
        </UnsupportedNote>
      </If>
      <If when={externalLoadState() === "error"}>
        <InlineBanner
          tone="danger"
          accessibilityLabel="external-import-error"
          message={`${tr("settings.externalImports.loadFailed")} ${localizeHostError(externalError())}`}
          actionLabel={tr("common.retry")}
          onAction={() => void loadExternalImport(false)}
        />
      </If>
      <If when={externalBlock() === "" && externalLoadState() !== "error"}>
        <ExternalSourcesGroup />
        <ExternalMcpImportGroup />
      </If>
      <RemovedExternalSessionsGroup />
    </View>
  );
}

/** Wraps a section drawn by its own component so the navigation can reveal it. */
function Anchor(props: { id: string; children?: JSX.Element }) {
  return <View ref={el => registerSectionAnchor(props.id, el)}>{props.children}</View>;
}

function ModelsPage() {
  useDeviceScopedLoad("models-subscriptions-preload", () => void loadSubscriptions(), () => void loadSubscriptions(true));
  useDeviceScopedLoad("models-pools-preload", ensurePools, () => void loadPools());

  let tabMounts = 0;
  const activeTab = (): ModelsPageTab => {
    const current = modelsPageTab();
    if (current === "pools" && poolsSupported() === false) return "models";
    return current;
  };

  const tabOptions = () => {
    const connectedSubs = subscriptionAccounts().filter(item => item.connected).length;
    const totalSubs = subscriptionAccounts().length;
    const subBadge =
      totalSubs > 0 ? (connectedSubs > 0 ? `${connectedSubs}/${totalSubs}` : totalSubs) : undefined;
    const options: Array<{
      value: ModelsPageTab;
      label: string;
      icon: IconName;
      badge?: string | number;
      accessibilityLabel: string;
    }> = [
      {
        value: "models",
        label: tr("settings.models.tabModels"),
        icon: "cpu",
        badge: storedModels().length > 0 ? storedModels().length : undefined,
        accessibilityLabel: "models-tab-models",
      },
      {
        value: "subscriptions",
        label: tr("settings.subscriptions.tabLabel"),
        icon: "key",
        badge: subBadge,
        accessibilityLabel: "models-tab-subscriptions",
      },
    ];
    if (poolsSupported() !== false) {
      options.push({
        value: "pools",
        label: tr("settings.pools.title"),
        icon: "layers",
        badge: pools().length > 0 ? pools().length : undefined,
        accessibilityLabel: "models-tab-pools",
      });
    }
    options.push({
      value: "network",
      label: tr("settings.models.tabNetwork"),
      icon: "globe",
      accessibilityLabel: "models-tab-network",
    });
    return options;
  };

  // Below this width the four tabs no longer fit with their labels: scroll them instead of truncating.
  const scrollTabs = (): boolean =>
    settingsCompact() || (settingsSceneWidth() > 0 && settingsSceneWidth() < 1040);
  const tabBar = () => (
    <SegmentedTabs
      size="md"
      value={activeTab()}
      scrollable={scrollTabs()}
      options={tabOptions()}
      onChange={tab => modelsPageTab.set(tab)}
    />
  );

  return (
    <View style={{ gap: layout.sectionGap }}>
      <If when={scrollTabs()} else={tabBar()}>
        <Scroll horizontal={true} scrollbar={false}>
          {tabBar()}
        </Scroll>
      </If>

      <Each of={[activeTab()]} key={tab => tab}>
        {tab => {
          const shouldAnimate = tabMounts > 0;
          tabMounts += 1;
          const motion = shouldAnimate ? subtleCrossfadeMotion() : null;
          return (
            <View style={[{ gap: layout.sectionGap }, motion?.style]}>
              <If when={tab() === "models"}>
                <DefaultModelsSection />
                <Anchor id="models">
                  <ModelSection />
                </Anchor>
              </If>
              <If when={tab() === "subscriptions"}>
                <Anchor id="subscriptions">
                  <SubscriptionsSection />
                </Anchor>
              </If>
              <If when={tab() === "pools"}>
                <Anchor id="pools">
                  <PoolsSection />
                </Anchor>
              </If>
              <If when={tab() === "network"}>
                <FieldSection sectionId="network" />
              </If>
            </View>
          );
        }}
      </Each>
    </View>
  );
}

/** The sections of one page, in the desktop's order. */
function SettingsPageBody(props: { pageId: SettingsPageId }) {
  const page = props.pageId;
  if (page === "general") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <SettingsGroup id="general-language" title={tr("settings.section.language")}>
          <LanguageRow />
        </SettingsGroup>
        <FieldSection sectionId="general" leading={<LaunchAtLoginRow />} />
      </View>
    );
  }
  if (page === "appearance") return <AppearanceSection />;
  if (page === "input") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <FieldSection sectionId="input" />
        <Anchor id="send-policy">
          <SendPolicySection />
        </Anchor>
      </View>
    );
  }
  if (page === "shortcuts") return <ShortcutsSection />; // wave22-p5
  if (page === "pet") {
    return (
      <SettingsGroup id="pet" title={tr("settings.page.pet")} hideTitle={true}>
        <DesktopCompanionRow />
      </SettingsGroup>
    );
  }
  if (page === "profile") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <SettingsGroup id="profile" title={tr("settings.page.profile")} hideTitle={true}>
          <AccountRow />
        </SettingsGroup>
        <AccountSyncSection />
      </View>
    );
  }
  if (page === "devices") return <AccountDevicesPage />;
  if (page === "openbitfun") return <OpenBitFunSection />;
  if (page === "activity") return <ActivityPage />;
  if (page === "storage") return (
    <If when={localSnapshotStorageAvailable()} else={
      <UnsupportedNote title={tr("settings.page.storage")} message={tr("storage.desktopOnly")} />
    }>
      <SnapshotStorageSection />
    </If>
  );
  if (page === "archived") return <ArchivedSessionsSection />;
  if (page === "models") return <ModelsPage />;
  if (page === "session-memory") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <FieldSection sectionId="session" />
        <Anchor id="task-models">
          <TaskModelsSection />
        </Anchor>
        <FieldSection sectionId="memory">
          <MemoryActionsRow />
        </FieldSection>
      </View>
    );
  }
  if (page === "execution") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <FieldSection sectionId="ai-execution" />
        <Anchor id="quick-actions">
          <QuickActionsSection />
        </Anchor>
        <FieldSection sectionId="agent-hooks" />
      </View>
    );
  }
  if (page === "permissions") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <PermissionsSection />
        <If when={permissionsSupported() === false}>
          <UnsupportedNote title={tr("settings.page.permissions")} message={unsupportedOnDevice()} />
        </If>
        <FieldSection sectionId="superagent-device" />
      </View>
    );
  }
  if (page === "editor") return <FieldSection sectionId="editor" />;
  if (page === "terminal") return <FieldSection sectionId="terminal" leading={<DefaultShellRow />} />;
  if (page === "workspace") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <FieldSection sectionId="workspace" />
        <FieldSection sectionId="workspace-search" />
        <FieldSection sectionId="git" />
      </View>
    );
  }
  if (page === "external-import") return <ExternalImportSection />;
  if (page === "web-search") return <WebSearchSection />;
  if (page === "desktop-control") {
    // wave22-p5: the device's own desktop-control permissions under its switches.
    return (
      <View style={{ gap: layout.sectionGap }}>
        <FieldSection sectionId="tools" />
        <ComputerUseSection />
        {/* wave22-p2: the user's own Chrome or Edge. */}
        <ExternalBrowserSection />
        <If when={windowShellId() === "nsh-desktop" && !isRemotePeerContext()}>
          <ExternalControlSection />
        </If>
      </View>
    );
  }
  if (page === "mcp") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <Anchor id="mcp">
          <McpSection />
        </Anchor>
        <Anchor id="acp">
          <View style={{ gap: layout.sectionGap }}>
            <AcpSection />
            <If when={acpSupported() === false}>
              <UnsupportedNote title={tr("settings.page.externalAgents")} message={unsupportedOnDevice()} />
            </If>
          </View>
        </Anchor>
      </View>
    );
  }
  if (page === "usage") return <UsageSection />;
  return (
    <View style={{ gap: layout.sectionGap }}>
      <FieldSection sectionId="diagnostics" />
      <LogFilesSection />
      <ConfigTransferSection />
    </View>
  );
}

/** Save / Discard / Keep editing, when a page or device change would drop typed text. */
function UnsavedChangesDialog() {
  const saving = signal(false);
  const saveAll = async (): Promise<void> => {
    const target = pendingNavigation();
    if (!target) return;
    saving.set(true);
    try {
      let ok = true;
      for (const spec of dirtyFields()) {
        if (!(await commitDraft(spec))) ok = false;
      }
      if (ok) applyPendingNavigation(target);
      else pendingNavigation.set(null);
    } finally {
      saving.set(false);
    }
  };
  return (
    <ModalDialog
      open={pendingNavigation() !== null}
      title={tr("settings.unsaved.title")}
      subtitle={tr("settings.unsaved.subtitle", { count: dirtyFields().length })}
      size="sm"
      accessibilityLabel="settings-unsaved-dialog"
      onClose={() => pendingNavigation.set(null)}
      footer={
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
          <Button
            label={tr("settings.unsaved.keepEditing")}
            variant="ghost"
            size="md"
            accessibilityLabel="settings-unsaved-keep"
            onPress={() => pendingNavigation.set(null)}
          />
          <Button
            label={tr("settings.unsaved.discard")}
            variant="secondary"
            size="md"
            accessibilityLabel="settings-unsaved-discard"
            onPress={() => {
              const target = pendingNavigation();
              drafts.set({});
              if (target) applyPendingNavigation(target);
            }}
          />
          <Button
            label={tr("common.save")}
            variant="primary"
            size="md"
            loading={saving()}
            accessibilityLabel="settings-unsaved-save"
            onPress={() => void saveAll()}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <Each of={dirtyFields()} key={spec => spec.id}>
          {spec => (
            <Text style={textStyle("caption")}>
              {`${fieldLabel(spec())}: ${spec().masked ? tr("settings.account.maskedValue") : draftOf(spec())}`}
            </Text>
          )}
        </Each>
      </View>
    </ModalDialog>
  );
}

let lastSettingsLocale: AppLocale | null = null;

export function SettingsScene() {
  void loadAccountState();
  // Whether Preferences say "Synced with your account" is the backend's answer.
  void loadAccountSync();
  void loadSettingsValues();
  void loadModels();
  let lastSettingsDevice: string | null = null;
  effect(() => {
    const ctx = deviceContext();
    if (lastSettingsDevice !== null && ctx !== lastSettingsDevice) {
      untracked(() => {
        void loadSettingsValues();
        void loadModels();
      });
    }
    lastSettingsDevice = ctx;
  });
  let noticeAutoClearTimer: ReturnType<typeof setTimeout> | null = null;
  const clearNoticeTimer = () => {
    if (noticeAutoClearTimer !== null) {
      clearTimeout(noticeAutoClearTimer);
      noticeAutoClearTimer = null;
    }
  };
  effect(() => {
    const notice = settingsNotice();
    clearNoticeTimer();
    if (notice && settingsNoticeTone(notice) === "success") {
      noticeAutoClearTimer = setTimeout(() => {
        noticeAutoClearTimer = null;
        if (settingsNotice() === notice) {
          settingsNotice.set("");
        }
      }, 4500);
    }
  });
  cleanup(() => clearNoticeTimer());
  effect(() => {
    const activeLocale = currentLocale();
    if (lastSettingsLocale !== null && activeLocale !== lastSettingsLocale) {
      const notice = settingsNotice();
      if (notice) {
        const expectedForActive = tr("settings.notice.languageSaved", {
          label: localeMeta(activeLocale).nativeName,
        });
        if (notice !== expectedForActive) {
          settingsNotice.set("");
        }
      }
    }
    lastSettingsLocale = activeLocale;
  });
  // Leaving Settings resets compact state, search filter, OAuth pollers, and per-device load markers.
  cleanup(() => {
    closeMcpAuth();
    compactPageOpen.set(false);
    settingsSearchQuery.set("");
    loadedDeviceForSection.clear();
    deviceScopeSwitchedInSettings = false;
  });
  const page = () => settingsPageEntry(selectedSettingsPage());
  const showList = (): boolean => settingsCompact() && !compactPageOpen();
  return (
    <View
      onLayout={trackSettingsWidth}
      style={{ flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: palette().canvas }}
    >
      <If when={!settingsCompact()}>
        <View
          accessibilityLabel="settings-scope-list"
          style={{
            width: settingsListWidth(),
            flexShrink: 0,
            minHeight: 0,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            <View style={{ paddingHorizontal: space.md, paddingTop: space.lg, paddingBottom: space.x3l }}>
              <SettingsNavigationList />
            </View>
          </Scroll>
        </View>
      </If>
      {/* The page clips to its own column so a long unbroken value never draws over the list. */}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ alignItems: "center" }}>
        <View
          style={{
            width: "100%",
            maxWidth: SETTINGS_CONTENT_MAX + settingsGutter() * 2,
            paddingHorizontal: settingsGutter(),
            paddingTop: settingsCompact() ? layout.phonePagePaddingTop : layout.pagePaddingTop,
            paddingBottom: space.x6l,
            gap: layout.titleToSection,
          }}
        >
          <If when={showList()}>
            <CompactSettingsList />
          </If>
          <If when={!showList()}>
            <View style={{ gap: layout.titleToSection }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                  <Text role="header" testID="settings-page-title" style={textStyle("pageTitle")}>
                    {tr(page().labelKey)}
                  </Text>
                  <If when={settingsScopeOf(selectedSettingsPage()) === "preferences" && accountSyncCaptionShown()}>
                    <Text accessibilityLabel="settings-synced" style={textStyle("caption", { color: palette().textMuted })}>
                      {tr("settings.synced")}
                    </Text>
                  </If>
                </View>
                <If when={settingsCompact()}>
                  <Button
                    label={tr("common.all")}
                    variant="secondary"
                    size="md"
                    leadingIcon="list"
                    accessibilityLabel="settings-compact-pages"
                    style={{ minHeight: layout.touchTarget, flexShrink: 0 }}
                    onPress={() => compactPageOpen.set(false)}
                  />
                </If>
              </View>
              <If when={settingsNotice()}>
                {notice => (
                  <InlineBanner
                    tone={settingsNoticeTone(notice())}
                    message={localizeHostError(notice())}
                    onDismiss={() => settingsNotice.set("")}
                  />
                )}
              </If>
              <If when={!settingsLoaded()}>
                <Text style={textStyle("caption")}>{tr("settings.loading")}</Text>
              </If>
              <If when={settingsLoaded()}>
                <View style={{ gap: layout.sectionGap }}>
                  <Each of={ALL_SETTINGS_PAGES.map(entry => entry.id)} key={id => id}>
                    {id => (
                      <If when={selectedSettingsPage() === id()}>
                        <View style={subtleCrossfadeMotion().style}>
                          <SettingsPageBody pageId={id()} />
                        </View>
                      </If>
                    )}
                  </Each>
                </View>
              </If>
            </View>
          </If>
        </View>
      </Scroll>
      </View>
      <UnsavedChangesDialog />
    </View>
  );
}

/** One page in the compact page list: a 44 pt row with its label and a chevron. */
function CompactListRow(props: {
  label: string;
  detail?: string;
  first: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={{
        position: "relative",
        minHeight: layout.touchTarget,
        paddingLeft: SETTINGS_ROW_INSET,
        paddingRight: space.md,
        paddingVertical: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={{ ...tactileActiveStyle(0.985), backgroundColor: palette().panelHover }}
      focusVisibleStyle={focusRingStyle()}
    >
      <If when={!props.first}>
        <RowSeparator edge="top" inset={SETTINGS_ROW_INSET} />
      </If>
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text style={{ ...textStyle("body"), numberOfLines: 1, textOverflow: "ellipsis" }}>{props.label}</Text>
        <If when={props.detail ?? ""}>
          {detail => (
            <Text
              style={{ ...textStyle("caption", { color: palette().textMuted }), numberOfLines: 1, textOverflow: "ellipsis" }}
            >
              {detail()}
            </Text>
          )}
        </If>
      </View>
      <Icon name="chevron-right" size={12} color={palette().textMuted} />
    </View>
  );
}

/** The search hits, for either list. */
function settingsHitLabel(hit: SettingsSearchHit, prefix: string): string {
  return `${prefix}-${hit.key.replace(/:/g, "-")}`;
}

/**
 * The compact (phone) entry: search, then the three scopes as grouped lists; a
 * row pushes its page full width with a pages switcher.
 */
function CompactSettingsList() {
  return (
    <View style={{ gap: layout.titleToSection }}>
      <SearchInput
        value={settingsSearchQuery()}
        onChange={value => settingsSearchQuery.set(value)}
        onSubmit={() => {
          const first = settingsSearchResults()[0];
          if (first) openSettingsSearchHit(first);
        }}
        placeholder={tr("settings.search.placeholder")}
        size="lg"
        style={{ height: layout.touchTarget, minHeight: layout.touchTarget }}
        accessibilityLabel="settings-compact-search"
      />
      <If when={settingsSearchQuery().trim() !== ""}>
        <View>
          <SectionHeader title={tr("settings.search.results")} />
          <If
            when={settingsSearchResults().length > 0}
            else={<SectionFootnote text={tr("settings.search.empty")} />}
          >
            <View style={insetGroupStyle()}>
              <Each of={settingsSearchResults()} key={hit => hit.key}>
                {(hit, index) => (
                  <CompactListRow
                    label={hit().label}
                    detail={hit().context}
                    first={index() === 0}
                    accessibilityLabel={settingsHitLabel(hit(), "settings-compact-hit")}
                    onPress={() => openSettingsSearchHit(hit())}
                  />
                )}
              </Each>
            </View>
          </If>
        </View>
      </If>
      <If when={settingsSearchQuery().trim() === ""}>
        <View style={{ gap: layout.sectionGap }}>
          <Each of={SETTINGS_PAGE_GROUPS} key={group => group.id}>
            {group => (
              <View>
                <SectionHeader
                  title={tr(group().labelKey)}
                  extra={group().id === "device" ? <DeviceScopeChip /> : undefined}
                />
                <View style={insetGroupStyle()}>
                  <Each of={visibleSettingsPages(group())} key={entry => entry.id}>
                    {(entry, index) => (
                      <CompactListRow
                        label={tr(entry().labelKey)}
                        first={index() === 0}
                        accessibilityLabel={`settings-compact-page-${entry().id}`}
                        onPress={() => requestSettingsPage(entry().id)}
                      />
                    )}
                  </Each>
                </View>
              </View>
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}

/** One row of the left list: 30 high, 13/500, no icon; uses canvas-plane neutral selection fill. */
function SettingsNavRow(props: {
  label: string;
  active: boolean;
  secondary?: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={{
        minHeight: SETTINGS_LIST_ROW,
        paddingHorizontal: space.sm,
        paddingVertical: props.secondary ? space.xs : 0,
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: props.active ? palette().buttonSecondaryHover : "transparent",
        justifyContent: "center",
        gap: space.hair,
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.active ? palette().buttonSecondaryHover : palette().surfaceSubtle }}
      activeStyle={{ ...tactileActiveStyle(0.985), backgroundColor: palette().buttonSecondaryPressed }}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{
          ...textStyle("label", { color: props.active ? palette().text : palette().textSecondary }),
          fontWeight: props.active ? "500" : "400",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.secondary ?? ""}>
        {secondary => (
          <Text
            style={{ ...textStyle("caption", { color: palette().textMuted }), numberOfLines: 1, textOverflow: "ellipsis" }}
          >
            {secondary()}
          </Text>
        )}
      </If>
    </View>
  );
}

/** A scope's header in the left list: 12/500 muted, a label above its pages rather than a page of its own. */
function SettingsNavGroupLabel(props: { label: string; extra?: JSX.Element }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: SETTINGS_LIST_ROW,
        paddingHorizontal: space.sm,
        marginTop: space.lg,
      }}
    >
      <Text
        role="header"
        style={{
          ...textStyle("caption", { color: palette().textMuted }),
          fontWeight: "500",
          flexShrink: 0,
          numberOfLines: 1,
        }}
      >
        {props.label}
      </Text>
      <If when={Boolean(props.extra)}>
        <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>{props.extra}</View>
      </If>
    </View>
  );
}

/** The devices the Device scope may name: runtime devices (including this device), offline ones listed but disabled. */
function scopeDeviceOptions(): SelectDropdownOption<string>[] {
  return fleetDevices()
    .filter(device => device.hostKind !== "cloud" && device.hostKind !== "phone" && device.hostKind !== "browser")
    .map(device => {
      const offline = device.state === "offline" || device.state === "unreachable";
      return {
        value: device.deviceId,
        label: device.name,
        icon: deviceGlyphIcon(device.hostKind),
        description: offline ? tr("settings.offline") : undefined,
        disabled: offline,
        accessibilityLabel: `settings-scope-device-${device.deviceId}`,
      };
    });
}

/**
 * The Device scope chip: which device's settings the Device pages read. It is
 * navigation inside Settings, not a "where should work run" choice. Without
 * the fleet layer there is one device, named as this device.
 */
function DeviceScopeChip() {
  return (
    <If
      when={fleetActive() && scopeDeviceOptions().length > 0}
      else={
        <View
          accessibilityLabel="settings-scope-chip"
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, height: controlHeight.sm }}
        >
          <Icon name="laptop" size={14} color={palette().textSecondary} />
          <Text style={{ ...textStyle("label", { color: palette().text }), numberOfLines: 1 }}>
            {tr("devices.thisDevice")}
          </Text>
        </View>
      }
    >
      <SelectDropdown<string>
        size="sm"
        variant="ghost"
        maxWidth={SETTINGS_LIST_WIDTH - space.x4l}
        value={deviceContext() || null}
        options={scopeDeviceOptions()}
        accessibilityLabel="settings-scope-chip"
        onChange={deviceId => requestDeviceScope(deviceId)}
      />
    </If>
  );
}

/**
 * The left list of the Settings canvas: search, then Preferences, Account and
 * Device (with its scope chip). Rows carry no icons.
 */
function SettingsNavigationList() {
  return (
    <View style={{ gap: space.hair }}>
      <SearchInput
        value={settingsSearchQuery()}
        onChange={value => settingsSearchQuery.set(value)}
        onSubmit={() => {
          const first = settingsSearchResults()[0];
          if (first) openSettingsSearchHit(first);
        }}
        placeholder={tr("settings.search.placeholder")}
        size="md"
        accessibilityLabel="settings-search"
      />
      <If when={settingsSearchQuery().trim() !== ""}>
        <View style={{ gap: space.hair }}>
          <SettingsNavGroupLabel label={tr("settings.search.results")} />
          <Each of={settingsSearchResults()} key={hit => hit.key}>
            {hit => (
              <SettingsNavRow
                label={hit().label}
                secondary={hit().context}
                active={false}
                accessibilityLabel={settingsHitLabel(hit(), "settings-search-hit")}
                onPress={() => openSettingsSearchHit(hit())}
              />
            )}
          </Each>
          <If when={settingsSearchResults().length === 0}>
            <Text style={{ ...textStyle("caption", { color: palette().textMuted }), paddingHorizontal: space.sm }}>
              {tr("settings.search.empty")}
            </Text>
          </If>
        </View>
      </If>
      <If when={settingsSearchQuery().trim() === ""}>
        <View style={{ gap: space.hair }}>
          <Each of={SETTINGS_PAGE_GROUPS} key={group => group.id}>
            {group => (
              <View style={{ gap: space.hair }}>
                <SettingsNavGroupLabel
                  label={tr(group().labelKey)}
                  extra={group().id === "device" ? <DeviceScopeChip /> : undefined}
                />
                <Each of={visibleSettingsPages(group())} key={page => page.id}>
                  {page => (
                    <SettingsNavRow
                      label={tr(page().labelKey)}
                      active={selectedSettingsPage() === page().id}
                      accessibilityLabel={`nav-settings-page-${page().id}`}
                      onPress={() => requestSettingsPage(page().id)}
                    />
                  )}
                </Each>
              </View>
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}

/**
 * Kept for the shell's import: the settings list now lives on the Settings
 * canvas itself (visual spec §4.9), so the side panel draws nothing for it.
 */
export function SettingsNavigation() {
  return <View />;
}

// ── wave22-p5: Preferences › Shortcuts ────────────────────────────────────────

function KeyCaps(props: { keystroke: string }) {
  const label = (): string => {
    try {
      return keymap.label(props.keystroke);
    } catch {
      return props.keystroke;
    }
  };
  return (
    <View
      style={{
        paddingHorizontal: space.chip,
        minHeight: space.xxl,
        justifyContent: "center",
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceTertiary,
      }}
    >
      <Text style={textStyle("label", { color: palette().textSecondary, tabular: true })}>{label()}</Text>
    </View>
  );
}

async function storeShortcut(definition: ShortcutDefinition, keystroke: string): Promise<void> {
  const taken = shortcutUsing(keystroke, definition.id);
  if (taken) {
    shortcutNotice.set(tr("shortcuts.conflict", { action: tr(taken.labelKey) }));
    return;
  }
  try {
    await setShortcut(definition.id, keystroke);
    shortcutNotice.set("");
  } catch (error) {
    shortcutNotice.set(localizeHostError(error instanceof Error ? error.message : String(error)));
  } finally {
    shortcutRecording.set(null);
  }
}

function ShortcutRecorder(props: { definition: ShortcutDefinition }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View
        ref={node => node?.focus()}
        focusable={true}
        captureKeys="all"
        accessibilityLabel={`shortcut-recorder-${props.definition.id}`}
        onKeyDown={event => {
          if (event.key === "Escape") {
            shortcutRecording.set(null);
            return;
          }
          const keystroke = keystrokeFromKeyEvent(event);
          if (keystroke) void storeShortcut(props.definition, keystroke);
        }}
        onBlur={() => {
          if (shortcutRecording() === props.definition.id) shortcutRecording.set(null);
        }}
        style={{
          paddingHorizontal: space.sm,
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
          justifyContent: "center",
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: palette().accent,
        }}
      >
        <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("shortcuts.recording")}</Text>
      </View>
      <IconButton
        icon="close"
        size="sm"
        tooltip={tr("common.cancel")}
        accessibilityLabel={`shortcut-cancel-${props.definition.id}`}
        onPress={() => shortcutRecording.set(null)}
      />
    </View>
  );
}

function ShortcutRow(props: { definition: ShortcutDefinition; first: boolean }) {
  const overridden = () => props.definition.id in keybindingOverrides();
  return (
    <SettingsRow label={tr(props.definition.labelKey)} first={props.first}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginLeft: "auto" }}>
        <If
          when={shortcutRecording() === props.definition.id}
          else={
            <>
              <View accessibilityLabel={`shortcut-keys-${props.definition.id}`}>
                <KeyCaps keystroke={effectiveKeystroke(props.definition)} />
              </View>
              <If when={keystrokeReservedHere(effectiveKeystroke(props.definition))}>
                <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
                  {tr("shortcuts.reservedByBrowser")}
                </Text>
              </If>
              <Button
                label={tr("shortcuts.change")}
                variant="ghost"
                size="sm"
                accessibilityLabel={`shortcut-change-${props.definition.id}`}
                onPress={() => {
                  shortcutNotice.set("");
                  shortcutRecording.set(props.definition.id);
                }}
              />
            </>
          }
        >
          <ShortcutRecorder definition={props.definition} />
        </If>
        <If when={overridden()}>
          <IconButton
            icon="undo"
            size="sm"
            tooltip={tr("shortcuts.reset")}
            accessibilityLabel={`shortcut-reset-${props.definition.id}`}
            onPress={() => void resetShortcut(props.definition.id).catch(() => undefined)}
          />
        </If>
      </View>
    </SettingsRow>
  );
}

function ShortcutsSection() {
  void loadKeybindings();
  return (
    <SettingsGroup
      id="shortcuts"
      title={tr("settings.shortcuts.title")}
      description={tr("shortcuts.body")}
      notice={shortcutNotice()}
      onDismissNotice={() => shortcutNotice.set("")}
      extra={
        <If when={Object.keys(keybindingOverrides()).length > 0}>
          <Button
            label={tr("shortcuts.resetAll")}
            variant="ghost"
            size="sm"
            accessibilityLabel="shortcut-reset-all"
            onPress={() => void resetAllShortcuts().catch(() => undefined)}
          />
        </If>
      }
    >
      <Each of={[...SHORTCUT_DEFINITIONS]} key={definition => definition.id}>
        {(definition, index) => <ShortcutRow definition={definition()} first={index() === 0} />}
      </Each>
    </SettingsGroup>
  );
}

// ── wave22-p5: Device › Browser and desktop control › permissions ─────────────

const COMPUTER_PERMISSION_LABELS: Record<string, MessageKey> = {
  accessibility: "computerUse.kind.accessibility",
  screen_recording: "computerUse.kind.screenRecording",
  input_posting: "computerUse.kind.inputPosting",
  input_monitoring: "computerUse.kind.inputMonitoring",
};

const COMPUTER_PERMISSION_STATES: Record<string, MessageKey> = {
  granted: "computerUse.state.granted",
  required: "computerUse.state.required",
  session_required: "computerUse.state.sessionRequired",
  not_required: "computerUse.state.notRequired",
  unavailable: "computerUse.state.unavailable",
};

function ComputerPermissionRowView(props: { row: () => ComputerPermissionRow; first: () => boolean }) {
  const label = () => {
    const key = COMPUTER_PERMISSION_LABELS[props.row().kind];
    return key ? tr(key) : props.row().kind;
  };
  const stateWord = () => {
    const key = COMPUTER_PERMISSION_STATES[props.row().state];
    return key ? tr(key) : props.row().state;
  };
  const needsAction = () => props.row().state === "required" || props.row().state === "session_required";
  return (
    <SettingsRow label={label()} description={props.row().detail} first={props.first()}>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginLeft: "auto" }}
        accessibilityLabel={`computer-use-${props.row().kind}`}
      >
        <Text style={textStyle("caption", { color: needsAction() ? stateColor("needs_you") : palette().textMuted })}>
          {stateWord()}
        </Text>
        <If when={needsAction() && props.row().requestable}>
          <Button
            label={tr("computerUse.request")}
            variant="secondary"
            size="sm"
            loading={computerUseBusy() === props.row().kind}
            accessibilityLabel={`computer-use-request-${props.row().kind}`}
            onPress={() => void requestComputerPermission(props.row().kind)}
          />
        </If>
        <If when={needsAction() && Boolean(props.row().settingsUrl)}>
          <Button
            label={tr("computerUse.openSettings")}
            variant="ghost"
            size="sm"
            accessibilityLabel={`computer-use-open-${props.row().kind}`}
            onPress={() => void openComputerUseSettings(props.row().kind)}
          />
        </If>
      </View>
    </SettingsRow>
  );
}

interface ExternalControlSettings {
  enabled: boolean;
  listening: boolean;
  port: number;
  endpoint: string;
  error: string | null;
  token: string | null;
  grants: { id: string; name: string; workspaceIds: string[]; origin: string | null }[];
  workspaces: { id: string; name: string }[];
}

type ExternalControlRequest =
  | { operation: "status" }
  | { operation: "setEnabled"; enabled: boolean; port: number }
  | { operation: "issue"; name: string; workspaceIds: string[]; origin?: string }
  | { operation: "revoke"; id: string };

function ExternalControlSection() {
  const settings = signal<ExternalControlSettings | null>(null);
  const busy = signal(false);
  const notice = signal("");
  const port = signal("");
  const name = signal("");
  const origin = signal("");
  const selected = signal<string[]>([]);
  const menuOpen = signal(false);
  let menuAnchor: ViewRef | null = null;
  const workspaces = () => settings()?.workspaces ?? [];
  const allSelected = () => workspaces().length > 0 && selected().length === workspaces().length;
  const selectionLabel = () => {
    if (workspaces().length === 0) return tr("externalControl.noWorkspaces");
    if (selected().length === 0) return tr("common.selectEllipsis");
    if (selected().length === 1) return workspaces().find(ws => ws.id === selected()[0])!.name;
    return tr("externalControl.selectedCount", { count: formatCount(selected().length) });
  };
  let mounted = true;
  cleanup(() => { mounted = false; });
  const validPort = () => /^\d+$/.test(port()) && Number(port()) >= 1 && Number(port()) <= 65535;

  async function run(request: ExternalControlRequest) {
    if (busy()) return;
    busy.set(true);
    notice.set("");
    try {
      const result = await invokeCommand<ExternalControlSettings>("desktop_external_control", request);
      if (!mounted) return;
      selected.update(ids => ids.filter(id => result.workspaces.some(ws => ws.id === id)));
      settings.set(result);
      port.set(String(result.port));
      if (request.operation === "issue") {
        name.set("");
        origin.set("");
        selected.set([]);
      }
    } catch (error) {
      if (mounted) notice.set(isCommandUnavailable(error, "desktop_external_control")
        ? tr("settings.notice.hostUpdateRequired") : errorMessageOf(error));
    } finally {
      if (mounted) busy.set(false);
    }
  }

  void run({ operation: "status" });
  return (
    <SettingsGroup id="external-control" title={tr("externalControl.title")}
      description={tr("externalControl.description")} notice={notice() || settings()?.error || ""}>
      <SettingsRow first label={tr("externalControl.enable")}>
        <ToggleSwitch accessibilityLabel="external-control-enabled" value={settings()?.enabled === true}
          disabled={!settings() || busy() || !validPort()}
          onChange={enabled => void run({ operation: "setEnabled", enabled, port: Number(port()) })} />
      </SettingsRow>
      <If when={settings() && !settings()?.listening}>
        <SettingsRow wrap={false} label={tr("externalControl.port")}>
          <TextField size="sm" style={{ width: 96, maxWidth: "100%" }} value={port()} onChange={value => port.set(value)} accessibilityLabel="external-control-port" />
        </SettingsRow>
      </If>
      <If when={notice() || settings()?.error}>
        <SettingsRow label={tr("common.retry")}>
          <Button label={tr("common.retry")} disabled={busy() || (!!settings()?.enabled && !validPort())}
            onPress={() => void run(settings()?.enabled && !settings()?.listening
              ? { operation: "setEnabled", enabled: true, port: Number(port()) } : { operation: "status" })} />
        </SettingsRow>
      </If>
      <If when={settings()?.listening}>
        <View>
          <SettingsRow wrap={false} label={tr("externalControl.endpoint")}>
            <Text style={textStyle("mono")}>{settings()?.endpoint}</Text>
          </SettingsRow>
          <SettingsRow wrap={false} label={tr("externalControl.name")}>
            <TextField size="sm" style={{ width: 220, maxWidth: "100%" }} value={name()} onChange={value => name.set(value)} accessibilityLabel="external-control-name" />
          </SettingsRow>
          <SettingsRow wrap={false} label={tr("externalControl.workspaces")}>
            <View ref={el => { menuAnchor = el; }} style={{ maxWidth: "100%" }}>
              <Button label={selectionLabel()} variant="outline" size="sm" trailingIcon="chevron-down"
                accessibilityLabel="external-control-workspaces" disabled={busy() || !workspaces().length}
                onPress={() => menuOpen.set(!menuOpen())} />
            </View>
            <DropdownMenu open={menuOpen()} anchor={menuAnchor} align="end" onClose={() => menuOpen.set(false)}
              items={[
                {
                  id: "all", label: tr("shell.menu.selectAll"), active: allSelected(), keepOpenOnSelect: true,
                  onSelect: () => selected.set(allSelected() ? [] : workspaces().map(ws => ws.id)),
                },
                ...workspaces().map((ws, index) => ({
                  id: `workspace-${ws.id}`, label: ws.name, separator: index === 0,
                  active: selected().includes(ws.id), keepOpenOnSelect: true,
                  onSelect: () => selected.update(ids => ids.includes(ws.id)
                    ? ids.filter(id => id !== ws.id) : [...ids, ws.id]),
                })),
              ]} />
          </SettingsRow>
          <SettingsRow stacked label={tr("externalControl.origin")} description={tr("externalControl.originHint")}>
            <TextField value={origin()} onChange={value => origin.set(value)} accessibilityLabel="external-control-origin" />
          </SettingsRow>
          <SettingsRow label={tr("externalControl.issue")}>
            <Button label={tr("externalControl.issue")} accessibilityLabel="external-control-issue"
              disabled={busy() || !name().trim() || selected().length === 0}
              onPress={() => void run({ operation: "issue", name: name().trim(), workspaceIds: selected(), origin: origin().trim() || undefined })} />
          </SettingsRow>
          <If when={settings()?.token}>
            {token => <SettingsRow stacked label={tr("externalControl.token")} description={tr("externalControl.tokenHint")}>
              <Text accessibilityLabel="external-control-token" style={textStyle("body")}>{token()}</Text>
              <Button label={tr("common.copy")} onPress={() => void Clipboard.writeText(token()).then(
                () => pushToast(tr("common.copied"), "success"), error => notice.set(errorMessageOf(error)))} />
            </SettingsRow>}
          </If>
        </View>
      </If>
      <Each of={settings()?.grants ?? []} key={grant => grant.id}>
        {grant => <SettingsRow label={grant().name}
          description={grant().workspaceIds.map(id => settings()?.workspaces.find(ws => ws.id === id)?.name ?? id).join(", ")}>
          <Button label={tr("externalControl.revoke")} disabled={busy()}
            onPress={() => void run({ operation: "revoke", id: grant().id })} />
        </SettingsRow>}
      </Each>
    </SettingsGroup>
  );
}

function ComputerUseSection() {
  effect(() => {
    deviceContext();
    void loadComputerUseStatus();
  });
  return (
    <>
      <If when={computerUseState() === "unsupported"}>
        <UnsupportedNote title={tr("computerUse.title")} message={unsupportedOnDevice()} />
      </If>
      <If when={computerUseState() !== "unsupported"}>
        <SettingsGroup
          id="computer-use"
          title={tr("computerUse.title")}
          description={tr("computerUse.body")}
          notice={computerUseNotice() ? localizeHostError(computerUseNotice()) : ""}
          onDismissNotice={() => computerUseNotice.set("")}
          extra={
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("computerUse.refresh")}
              accessibilityLabel="computer-use-refresh"
              onPress={() => void loadComputerUseStatus()}
            />
          }
        >
          <If when={computerUseState() === "loading" && !computerUseStatus()}>
            <SettingsRow label={tr("computerUse.loading")} first={true} />
          </If>
          <Each of={computerUseStatus()?.permissions ?? []} key={row => row.kind}>
            {(row, index) => <ComputerPermissionRowView row={row} first={() => index() === 0} />}
          </Each>
        </SettingsGroup>
      </If>
    </>
  );
}

// ── wave22-p5: Device › Diagnostics › settings export and import ──────────────

async function exportSettingsToClipboard(): Promise<void> {
  try {
    await copyConfigExport();
    pushToast(tr("configTransfer.copied", { device: scopeDeviceName() || tr("configTransfer.thisDevice") }), "success");
  } catch (error) {
    pushToast(localizeHostError(error instanceof Error ? error.message : String(error)), "error");
  }
}

async function runConfigImport(): Promise<void> {
  const outcome = await importConfigText();
  if (outcome?.success) {
    pushToast(
      outcome.warnings.length > 0
        ? tr("configTransfer.importedWithWarnings", { count: outcome.warnings.length })
        : tr("configTransfer.imported"),
      "success",
    );
    void loadSettingsValues();
  }
}

function configImportErrorText(): string {
  const code = configImportError();
  if (code === "invalidJson") return tr("configTransfer.invalidJson");
  if (code === "tooLarge") return tr("configTransfer.tooLarge");
  if (code === "failed") return tr("configTransfer.failed");
  return localizeHostError(code);
}

function ConfigImportDialog() {
  return (
    <ModalDialog
      open={configImportOpen()}
      title={tr("configTransfer.importTitle")}
      subtitle={tr("configTransfer.importBody", { device: scopeDeviceName() || tr("configTransfer.thisDevice") })}
      size="md"
      accessibilityLabel="config-import-dialog"
      onClose={() => closeConfigImport()}
      footer={
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, flex: 1 }}>
          <Button
            label={tr("configTransfer.chooseFile")}
            variant="ghost"
            size="md"
            leadingIcon="file"
            accessibilityLabel="config-import-choose"
            onPress={() => void pickConfigFile().catch(() => undefined)}
          />
          <View style={{ flex: 1 }} />
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => closeConfigImport()} />
          <Button
            label={tr("configTransfer.import")}
            variant="primary"
            size="md"
            loading={configTransferBusy() === "import"}
            disabled={!configImportText().trim()}
            accessibilityLabel="config-import-confirm"
            onPress={() => void runConfigImport()}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <If when={configImportName()}>
          <Text style={textStyle("caption", { color: palette().textMuted })}>{configImportName()}</Text>
        </If>
        <TextField
          multiline
          monospace
          minHeight={space.x6l * 2}
          placeholder={tr("configTransfer.pastePlaceholder")}
          value={configImportText()}
          accessibilityLabel="config-import-text"
          onChange={value => configImportText.set(value)}
        />
        <If when={configImportError()}>
          <Text accessibilityLabel="config-import-error" style={textStyle("caption", { color: stateColor("failed") })}>
            {configImportErrorText()}
          </Text>
        </If>
      </View>
    </ModalDialog>
  );
}

function ConfigTransferSection() {
  return (
    <SettingsGroup id="config-transfer" title={tr("configTransfer.title")}>
      <SettingsRow label={tr("configTransfer.export")} description={tr("configTransfer.exportBody")} first={true}>
        <Button
          label={tr("configTransfer.copy")}
          variant="secondary"
          size="sm"
          loading={configTransferBusy() === "export"}
          accessibilityLabel="config-export-copy"
          onPress={() => void exportSettingsToClipboard()}
        />
      </SettingsRow>
      <SettingsRow label={tr("configTransfer.importRow")} description={tr("configTransfer.importRowBody")}>
        <Button
          label={tr("configTransfer.importEllipsis")}
          variant="secondary"
          size="sm"
          accessibilityLabel="config-import-open"
          onPress={() => openConfigImport()}
        />
      </SettingsRow>
      <ConfigImportDialog />
    </SettingsGroup>
  );
}

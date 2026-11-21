import {
  cleanup,
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
import { STATIC_MARKDOWN_OPTIONS, createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { fleetActive, invokeCommand, windowShellId } from "../bridge";
import { fleetDeviceById, fleetDevices } from "../fleetStore";
import { isCommandUnavailable } from "../hostCommands";
import {
  fetchUsageActivity,
  UsageActivityUnavailable,
  type UsageActivityCell,
  type UsageActivityView,
} from "../usageActivity";
import { deviceGlyphIcon } from "../ui/fleet";
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
  githubUser,
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
  formatBucket,
  formatCount,
  formatDuration,
  formatPercent,
  formatPlural,
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
  mcpDraft,
  mcpImportCandidates,
  mcpImportNotice,
  mcpImportOpen,
  mcpImportText,
  mcpJsonNotice,
  mcpJsonOpen,
  mcpJsonState,
  mcpJsonText,
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
  startSubscriptionSignIn,
  subscriptionLogin,
  type QuotaMeterRow,
  type SubscriptionQuotaSummary,
} from "../modelDiscoveryStore";
import {
  catalogProviders,
  chooseCatalogModel,
  chooseCatalogProvider,
  closeModelForm,
  closeModelLimits,
  DEFAULT_MODEL_SLOTS,
  chooseDefaultModel,
  defaultModelReferences,
  defaultModelSaving,
  defaultModels,
  defaultModelsNotice,
  deleteModel,
  isSelectableForCapability,
  loadDefaultModels,
  modelOptionLabel,
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
  midTurnSendPolicy,
  sendPolicyNotice,
  type MidTurnSendPolicy,
} from "../sendPolicyStore";
import {
  SETTINGS_SECTIONS,
  appLanguageValue,
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
  cancelSpeechModelDownload,
  downloadSpeechModel,
  loadSpeechModels,
  memoryActionBusy,
  memoryResetPending,
  speechModels,
  speechNotice,
  type SpeechModelStatus,
  openMemoryFolder,
  resetMemory,
  setGeneralControl,
  type GeneralControlOption,
  loadSettingsValues,
  maxForField,
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
import { setConfig } from "../api";
import {
  TASK_MODEL_ROWS,
  chooseTaskModel,
  ensureTaskModels,
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
  concentricRadius,
  controlHeight,
  fontMono,
  isLightAppearance,
  layout,
  palette,
  radii,
  resolvedAppearanceId,
  resolvedScheme,
  selectAppearancePreset,
  space,
  textLineHeight,
  textSize,
  textStyle,
  textTracking,
  type AppearanceId,
} from "../theme";
import { applyAppearance, type AppearanceMode } from "../themeStore";
import { openAccountAuthModal } from "../ui/AccountAuthModal";
import { Icon, type IconName } from "../ui/icons";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import { DropdownMenu, ModalDialog, SelectDropdown, pushToast, type SelectDropdownOption } from "../ui/overlays";
import { openSessionDelete } from "../ui/sessionActions";
import {
  ActionButton,
  Badge,
  Button,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InlineFieldSaveGroup,
  InputBox,
  PillChip,
  SearchInput,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
  type StatusPillKind,
} from "../ui/primitives";
import {
  activeWorkspace,
  archiveSessionRow,
  deviceContext,
  isSessionArchived,
  loadSessions,
  selectDeviceContext,
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
        keywords: ["voice", "speech", "selection", "send", "queue"],
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
        keywords: ["pet", "companion", "desktop"],
        anchors: [],
        nativeOnly: true,
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
        keywords: ["openbitfun", "cloud", "agent", "conversation"],
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
        keywords: ["computer use", "browser", "desktop", "chrome"],
        anchors: [],
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
  return SETTINGS_PAGE_ALIASES[id]?.pageId ?? id;
}

const ALL_SETTINGS_PAGES: readonly SettingsPageEntry[] = SETTINGS_PAGE_GROUPS.flatMap(group => group.pages);

/** The scope a page belongs to. */
export function settingsScopeOf(id: SettingsPageId): SettingsScope {
  const resolved = resolveSettingsPage(id);
  return SETTINGS_PAGE_GROUPS.find(group => group.pages.some(page => page.id === resolved))?.id ?? "preferences";
}

/** The pages a scope lists on this window (the pet page only in the native desktop). */
export function visibleSettingsPages(group: SettingsPageGroup): readonly SettingsPageEntry[] {
  return group.pages.filter(page => !page.nativeOnly || windowShellId() === "nsh-desktop");
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
  const needle = settingsSearchQuery().trim().toLowerCase();
  if (!needle) return [];
  const matches = (...texts: Array<string | undefined>): boolean =>
    texts.some(text => (text ?? "").toLowerCase().includes(needle));
  const hits: SettingsSearchHit[] = [];
  for (const page of ALL_SETTINGS_PAGES) {
    if (page.nativeOnly && windowShellId() !== "nsh-desktop") continue;
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

/** Scrolls the open page to one of its sections. */
export function revealSettingsSection(id: string): void {
  const ref = sectionAnchorRefs[id];
  if (ref) {
    ref.reveal({ vertical: "start" });
  } else {
    pendingAnchor = id;
  }
}

/** The page the unsaved-changes prompt is holding back, with the section to reveal. */
const pendingNavigation = signal<{ pageId: SettingsPageId; anchor?: string } | null>(null);

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
    pendingNavigation.set({ pageId, anchor });
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

const APPEARANCE_MODES: ReadonlyArray<{ value: AppearanceMode; labelKey: MessageKey }> = [
  { value: "system", labelKey: "settings.appearance.schemeSystem" },
  { value: "light", labelKey: "settings.appearance.schemeLight" },
  { value: "dark", labelKey: "settings.appearance.schemeDark" },
];

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
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = maxForField(spec) ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** A step that moves a wide range in useful increments. */
function stepFor(spec: FieldSpec): number {
  const span = (spec.max ?? 0) - (spec.min ?? 0);
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
    : Number(spec.defaultValue ?? spec.min ?? 0);
  clearDraft(spec);
  void writeField(spec, clampNumber(spec, base + direction * stepFor(spec)));
}

function signedInAccountDisplay(): string {
  const login = githubUser()?.login;
  if (login) return `@${login}`;
  return accountStatus()?.userId || tr("home.signedIn");
}

// --- Settings layout (calm inset grouped lists) -----------------------------
// Page: 680 column, 32 gutter (16 compact), 28 top, 26/600 large title.
// Sections: a 13/600 secondary header, 8 below, then one inset grouped list
// (radius 12, panelRaised, hairline borderSubtle, no shadow) whose rows are at
// least 44 tall with 0x16 padding and separators inset 16 from the left.

const SETTINGS_CONTENT_MAX = layout.settingsWidth;
/** Below this the scene shows the page list, then pushes a page (the phone layout). */
const SETTINGS_COMPACT_WIDTH = layout.phoneMaxWidth + 1;
const SETTINGS_ROW_MIN = layout.touchTarget;
const SETTINGS_ROW_INSET = space.lg;
/** The left list (visual spec §4.9): 240 wide, rows 30. */
const SETTINGS_LIST_WIDTH = layout.navMediumWidth;
const SETTINGS_LIST_ROW = controlHeight.sm + space.hair;

/** The scene's own laid-out width (the nav panel and aux pane take part of the window). */
const settingsSceneWidth = signal(0);
/** Compact layout: the page list is shown until a page is pushed over it. */
const compactPageOpen = signal(false);

function trackSettingsWidth(event: { bounds: { size: { width: number } } }): void {
  const width = Math.round(event.bounds.size.width);
  if (width > 0 && width !== untracked(() => settingsSceneWidth())) settingsSceneWidth.set(width);
}

/** True when the settings scene is narrower than the phone breakpoint (720). */
export function settingsCompact(): boolean {
  const width = settingsSceneWidth();
  if (width > 0) return width < SETTINGS_COMPACT_WIDTH;
  return horizontalSizeClass() === "compact";
}

function settingsGutter(): number {
  return settingsCompact() ? layout.phoneGutter : layout.pageGutter;
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
        gap: 2,
      }}
    >
      <Text
        style={{
          color: palette().text,
          fontSize: textSize(14),
          fontWeight: "400",
          lineHeight: textLineHeight(14, 1.4),
        }}
      >
        {props.label}
      </Text>
      <If when={props.description ?? ""}>
        {description => (
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              fontVariant: props.tabular ? ["tabular-nums"] : undefined,
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
        flexWrap: props.stacked ? undefined : "wrap",
        alignItems: props.stacked ? "stretch" : "center",
        columnGap: 16,
        rowGap: 8,
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: 10,
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
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: props.stacked ? "flex-start" : "flex-end",
            flexShrink: 0,
            minWidth: 0,
            maxWidth: props.stacked || settingsCompact() ? undefined : "60%",
            marginLeft: props.stacked ? undefined : "auto",
            gap: 8,
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

/** The 13/600 secondary section header with an optional trailing control. */
function SectionHeader(props: { title: string; extra?: JSX.Element }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 24,
        marginBottom: 8,
        paddingHorizontal: 4,
      }}
    >
      <Text
        role="header"
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(13),
          fontWeight: "600",
          lineHeight: textLineHeight(13, 1.35),
        }}
      >
        {props.title}
      </Text>
      <If when={Boolean(props.extra)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>{props.extra}</View>
      </If>
    </View>
  );
}

/** The 12 muted line under a group that explains it (an Apple-style footer). */
function SectionFootnote(props: { text: string }) {
  return (
    <Text
      style={{
        marginTop: 8,
        paddingHorizontal: 4,
        color: palette().textMuted,
        fontSize: textSize(12),
        lineHeight: textLineHeight(12, 1.45),
        maxWidth: 600,
      }}
    >
      {props.text}
    </Text>
  );
}

/** A notice beside a section header: quiet inline text in its status color. */
function HeaderNotice(props: { text: string }) {
  return (
    <Text
      style={{
        maxWidth: 320,
        color:
          noticeTone(props.text) === "danger"
            ? palette().danger
            : noticeTone(props.text) === "warning"
              ? palette().warning
              : palette().textSecondary,
        fontSize: textSize(12),
        lineHeight: textLineHeight(12, 1.4),
        numberOfLines: 2,
        textOverflow: "ellipsis",
      }}
    >
      {localizeHostError(props.text)}
    </Text>
  );
}

/** A row's trailing value: 13 secondary, tabular. */
function RowValue(props: { text: string }) {
  return (
    <Text
      style={{
        color: palette().textSecondary,
        fontSize: textSize(13),
        fontVariant: ["tabular-nums"],
        lineHeight: textLineHeight(13, 1.4),
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  effect(() => {
    const notice = props.notice ?? "";
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (notice && noticeTone(notice) === "success" && props.onDismissNotice) {
      const dismiss = props.onDismissNotice;
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
    <View ref={el => registerSectionAnchor(props.id, el)} style={{ minWidth: 0 }}>
      <If when={!props.hideTitle || Boolean(props.extra)}>
        <SectionHeader title={props.hideTitle ? "" : props.title} extra={props.extra} />
      </If>
      <If when={props.notice ?? ""}>
        {notice => (
          <View style={{ marginBottom: 8 }}>
            <InlineBanner
              tone={noticeTone(notice())}
              message={localizeHostError(notice())}
              onDismiss={props.onDismissNotice}
            />
          </View>
        )}
      </If>
      <View style={insetGroupStyle()}>{props.children}</View>
      <If when={props.description ?? ""}>{description => <SectionFootnote text={description()} />}</If>
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
  bodyPadding?: number;
  flush?: boolean;
  children?: JSX.Element;
}) {
  const inset = (): number => (props.flush ? 0 : (props.bodyPadding ?? 16));
  return (
    <View style={{ minWidth: 0 }}>
      <If when={!repeatsPageTitle(props.title) || Boolean(props.extra)}>
        <SectionHeader title={repeatsPageTitle(props.title) ? "" : props.title} extra={props.extra} />
      </If>
      <View style={insetGroupStyle(inset())}>
        <SettingsInsetContext.Provider value={inset()}>{props.children}</SettingsInsetContext.Provider>
      </View>
      <If when={props.subtitle ?? ""}>{subtitle => <SectionFootnote text={subtitle()} />}</If>
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
        paddingVertical: 10,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 16,
        rowGap: 8,
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
            alignItems: "center",
            justifyContent: stretch() ? "flex-start" : "flex-end",
            flexShrink: 1,
            minWidth: 0,
            marginLeft: "auto",
            width: settingsCompact() ? undefined : props.controlWidth,
            maxWidth: "100%",
            gap: 8,
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
      onPress={props.onPress}
      style={{
        height: controlHeight.sm,
        paddingHorizontal: 12,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        borderRadius: radii.pill,
        borderCurve: "continuous",
        backgroundColor: palette().actionPrimaryBg,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().actionPrimaryHover }}
      activeStyle={tactileActiveStyle()}
      focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().accent, outlineOffset: 2 }}
    >
      <If when={fieldSaving(spec)}>
        <Spinner size={11} color={palette().actionPrimaryFg} />
      </If>
      <Text
        style={{
          color: palette().actionPrimaryFg,
          fontSize: textSize(12),
          fontWeight: "600",
          lineHeight: textLineHeight(12, 1.2),
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
          minWidth={200}
          maxWidth={280}
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
        label: modelOptionLabel(model),
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
        minWidth={220}
        maxWidth={300}
        align="end"
        onChange={value => void writeField(spec, value || null)}
      />
    </View>
  );
}

/**
 * A number field: `−` / `+` step and save at once (clamped), and the value can
 * also be typed — Return or the Save that appears beside it saves the typed
 * value. A field the host keeps as `Option` can be cleared to "no limit".
 */
function NumberControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const unavailable = () => fieldMissing(spec) && spec.defaultValue === undefined && !spec.clearable;
  const value = (): number | null => {
    const raw = fieldDisplay(spec);
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const max = () => maxForField(spec);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          height: controlHeight.sm,
          flexDirection: "row",
          alignItems: "center",
          padding: 2,
          gap: 2,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: fieldDirty(spec) ? palette().accent : palette().borderSubtle,
          backgroundColor: palette().inputBg,
          flexShrink: 0,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <ActionButton
          label="−"
          variant="ghost"
          size="xs"
          accessibilityLabel={`${spec.id}-decrease`}
          disabled={unavailable() || fieldSaving(spec) || (value() !== null && value()! <= (spec.min ?? Number.NEGATIVE_INFINITY))}
          style={{ width: 24, paddingHorizontal: 0 }}
          onPress={() => stepNumber(spec, -1)}
        />
        <Input
          value={draftOf(spec)}
          accessibilityLabel={spec.id}
          placeholder={fieldPlaceholder(spec)}
          readonly={unavailable()}
          keyboardType="number-pad"
          onChange={event => setDraft(spec, event.value)}
          onSubmit={() => void commitDraft(spec)}
          style={{
            width: 64,
            height: controlHeight.sm - 6,
            paddingHorizontal: 4,
            textAlign: "center",
            color: palette().text,
            placeholderColor: palette().textMuted,
            fontSize: textSize(12),
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
            backgroundColor: "transparent",
            borderWidth: 0,
          }}
        />
        <ActionButton
          label="+"
          variant="ghost"
          size="xs"
          accessibilityLabel={`${spec.id}-increase`}
          disabled={unavailable() || fieldSaving(spec) || (value() !== null && max() !== undefined && value()! >= max()!)}
          style={{ width: 24, paddingHorizontal: 0 }}
          onPress={() => stepNumber(spec, 1)}
        />
      </View>
      <If when={fieldUnit(spec) ?? ""}>
        {unit => <Text style={textStyle("meta")}>{unit()}</Text>}
      </If>
      <If when={spec.clearable === true && value() !== null && !fieldDirty(spec)}>
        <IconButton
          icon="close"
          size="sm"
          tooltip={tr("settings.field.clearLimit")}
          accessibilityLabel={`${spec.id}-clear`}
          onPress={() => void writeField(spec, null)}
        />
      </If>
      <If when={fieldDirty(spec)}>
        <RowSaveButton spec={spec} onPress={() => void commitDraft(spec)} />
      </If>
    </View>
  );
}

/** A text field prefilled with what is stored; Save appears once it differs. */
function TextControl(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const unavailable = () => fieldMissing(spec) && spec.defaultValue === undefined;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: 300, maxWidth: "100%" }}>
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
  const hint = fieldHint(spec) ?? "";
  const isDefault = fieldMissing(spec) && spec.defaultValue !== undefined;
  if (isDefault) return hint ? `${hint} · ${tr("common.default")}` : tr("settings.field.defaultSetting");
  return hint;
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

function settingsNoticeTone(notice: string): "danger" | "warning" | "success" {
  const lower = notice.toLowerCase();
  if (
    lower.includes("needs a number") ||
    lower.includes("必须输入") ||
    lower.includes("必須輸入") ||
    lower.includes("cannot") ||
    lower.includes("不能") ||
    lower.includes("failed") ||
    lower.includes("失败") ||
    lower.includes("失敗") ||
    lower.includes("error") ||
    lower.includes("invalid") ||
    lower.includes("refused") ||
    lower.includes("at most") ||
    lower.includes("must be")
  ) {
    return "danger";
  }
  if (lower.includes("warning") || lower.includes("unavailable") || lower.includes("default")) {
    return "warning";
  }
  return "success";
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
        paddingLeft: SETTINGS_ROW_INSET,
        paddingRight: 14,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        cursor: props.disabled ? undefined : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: palette().panelHover }}
      focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -2 }}
    >
      <If when={!props.first}>
        <RowSeparator edge="top" inset={props.icon ? 44 : SETTINGS_ROW_INSET} />
      </If>
      <If when={props.icon ?? ""}>
        {icon => (
          <Icon
            name={icon() as IconName}
            size={16}
            color={props.selected && props.warning ? palette().warning : palette().textMuted}
          />
        )}
      </If>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: props.selected && props.warning ? palette().warning : palette().text,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.38),
          }}
        >
          {props.label}
        </Text>
        <If when={props.detail ?? ""}>
          {detail => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.42),
              }}
            >
              {detail()}
            </Text>
          )}
        </If>
      </View>
      <View style={{ width: 16, alignItems: "center", flexShrink: 0 }}>
        <If when={props.selected}>
          <Icon name="check" size={14} color={props.warning ? palette().warning : palette().accent} />
        </If>
      </View>
    </View>
  );
}

function PermissionsSection() {
  ensurePermissions();
  const rulesModalOpen = usePresenceFlag(() => ruleDraft() !== null);
  const modeLabel = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].labelKey);
  const modeHint = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].hintKey);

  return (
    <If when={permissionsSupported() !== false}>
      <View style={{ gap: 36 }}>
        <SettingsSection
          title={tr("settings.permissions.title")}
          flush={true}
          subtitle={
            permissionMode() === null
              ? tr("settings.permissions.reading")
              : tr("settings.permissions.subtitleActive", {
                  mode: modeLabel(permissionMode()!),
                  hint: modeHint(permissionMode()!),
                })
          }
          extra={permissionsNotice() ? <HeaderNotice text={permissionsNotice()} /> : undefined}
        >
          <Each of={PERMISSION_MODES} key={entry => entry.value}>
            {(entry, index) => (
              <ChoiceRow
                label={modeLabel(entry().value)}
                detail={modeHint(entry().value)}
                icon={PERMISSION_MODE_META[entry().value].icon}
                selected={permissionMode() === entry().value}
                warning={entry().value === "full_access"}
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
                gap: 12,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: 10,
                minHeight: SETTINGS_ROW_MIN,
              }}
            >
              <RowSeparator edge="top" />
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, flex: 1, minWidth: 200 }}>
                <View style={{ flexShrink: 0, marginTop: 1 }}>
                  <Icon name="warning" size={14} color={palette().warning} />
                </View>
                <Text
                  style={{
                    color: palette().warning,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.44),
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {tr("settings.permissions.fullAccessWarning")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8, marginLeft: "auto" }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="cancel-full-access"
                  onPress={() => cancelFullAccess()}
                />
                <Button
                  label={tr("settings.permissions.allowEverything")}
                  variant="danger"
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
            label={tr("settings.polish.globalRules")}
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Button
                label={tr("settings.permissions.addRule")}
                variant="secondary"
                size="sm"
                leadingIcon="plus"
                accessibilityLabel="add-permission-rule"
                onPress={() => addPermissionRule()}
              />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.38),
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {localizeHostError(rulesNotice())}
              </Text>
              <Button
                label={tr("common.discardChanges")}
                variant="ghost"
                size="sm"
                accessibilityLabel="discard-permission-rules"
                onPress={() => discardRuleDraft()}
              />
              <Button
                label={tr("settings.permissions.saveRules")}
                variant="primary"
                size="sm"
                accessibilityLabel="save-permission-rules"
                onPress={() => void saveRuleDraft()}
              />
            </View>
          }
        >
          <If when={ruleDraft() !== null}>
            <View style={{ gap: 12 }}>
              <View
                style={{
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text
                  style={{
                    color: palette().textMuted,
                    fontFamily: fontMono,
                    fontSize: textSize(11),
                    lineHeight: textLineHeight(11, 1.48),
                  }}
                >
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
                      gap: 10,
                      paddingTop: index() === 0 ? 4 : 12,
                      paddingBottom: 2,
                      borderTopWidth: index() === 0 ? 0 : 1,
                      borderColor: palette().borderSubtle,
                    }}
                  >
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <Badge label={`#${index() + 1}`} tone="neutral" />
                      <Each of={PERMISSION_EFFECTS} key={effect => effect.value}>
                        {effect => (
                          <PillChip
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
  return (
    <SettingsSection
      title={tr("settings.permissions.autoTitle")}
      flush={true}
      extra={approvalNotice() ? <HeaderNotice text={approvalNotice()} /> : undefined}
    >
      <If
        when={permissionMode() === "auto"}
        else={
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: 12, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("settings.permissions.autoHint")}</Text>
          </View>
        }
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
                style={{ minWidth: 64 }}
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
                style={{ width: 200 }}
                onChange={val => approvalDrafts.update(current => ({ ...current, "decision-secret": val }))}
              />
              <Button
                label={tr("settings.field.saveShort")}
                variant="secondary"
                size="sm"
                disabled={pick("decision-secret").trim().length === 0}
                accessibilityLabel="save-approval-decision-key"
                style={{ minWidth: 64 }}
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
          <InputBox
            size="sm"
            value={pick("timeout")}
            placeholder={String(approvalSettings()?.timeoutSeconds ?? 30)}
            accessibilityLabel="approval-timeout"
            style={{ width: 72 }}
            onChange={val => approvalDrafts.update(current => ({ ...current, timeout: val }))}
          />
          <Text style={textStyle("caption")}>{tr("settings.permissions.seconds")}</Text>
          <Button
            label={tr("settings.field.saveShort")}
            variant="secondary"
            size="sm"
            accessibilityLabel="save-approval-timeout"
            style={{ minWidth: 64 }}
            onPress={() => {
              const typed = pick("timeout").trim();
              const seconds = typed ? Number.parseInt(typed, 10) : (approvalSettings()?.timeoutSeconds ?? 30);
              if (!Number.isFinite(seconds)) {
                approvalNotice.set(tr("settings.permissions.timeoutValidation"));
                return;
              }
              // The host bounds the timeout and answers with what it stored.
              void saveApproval({ timeoutSeconds: seconds });
            }}
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
      </If>
    </SettingsSection>
  );
}

function SendPolicySection() {
  ensureSendPolicy();
  const currentHint = (): string => {
    const entry = MID_TURN_KEYS[midTurnSendPolicy()];
    return entry ? tr(entry.hintKey) : tr("settings.sendPolicy.steerNowHint");
  };
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.sendPolicy.title")}
      subtitle={tr("settings.sendPolicy.subtitle")}
      extra={
        sendPolicyNotice() ? (
          <HeaderNotice text={sendPolicyNotice()} />
        ) : undefined
      }
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
      controlWidth={300}
      controlAlign="stretch"
    >
      <InlineFieldSaveGroup
        value={value()}
        onChange={val => drafts.update(current => ({ ...current, [props.id]: val }))}
        onSave={() => props.onSave(value())}
        placeholder={props.placeholder ?? tr("settings.field.newValuePlaceholder")}
        saveLabel={tr("settings.field.saveShort")}
        buttonWidth={68}
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
  ensureWebSearch();
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
      extra={
        webSearchNotice() ? (
          <HeaderNotice text={webSearchNotice()} />
        ) : undefined
      }
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
              columnGap: 16,
              rowGap: 8,
              paddingHorizontal: SETTINGS_ROW_INSET,
              paddingVertical: 10,
            }}
          >
            <RowSeparator edge="top" />
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: 2 }}>
              <Text
                style={{
                  color: palette().text,
                  fontSize: textSize(14),
                  lineHeight: textLineHeight(14, 1.4),
                }}
              >
                {tr("settings.models.apiKey")}
              </Text>
              <If when={credentialLine()}>
                {line => (
                  <Text
                    style={{
                      color: palette().textSecondary,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.45),
                    }}
                  >
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
                gap: 6,
                flexShrink: 1,
                marginLeft: "auto",
                width: 300,
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
                style={{ minWidth: 68 }}
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
  ensureQuickActions();
  const draft = () => quickActionDraft();
  const quickActionModalOpen = usePresenceFlag(() => Boolean(quickActionDraft()));
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.quickActions.title")}
      subtitle={tr("settings.quickActions.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={quickActionsNotice()}>
            {notice => <HeaderNotice text={notice()} />}
          </If>
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
                gap: 14,
                paddingHorizontal: 16,
                paddingVertical: 13,
                position: "relative",
                opacity: action().enabled ? 1 : 0.65,
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            >
              <If when={index() !== 0}>
                <RowSeparator edge="top" />
              </If>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontWeight: "500",
                    letterSpacing: textTracking(14),
                    lineHeight: textLineHeight(14, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {action().label}
                </Text>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.44),
                    numberOfLines: 2,
                    textOverflow: "ellipsis",
                  }}
                >
                  {action().prompt}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
                <ToggleSwitch
                  value={action().enabled}
                  label={action().enabled ? tr("settings.quickActions.shown") : tr("settings.quickActions.hidden")}
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
                    icon: "chevron-down",
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Button
                label={tr("common.cancel")}
                variant="ghost"
                size="sm"
                accessibilityLabel="quick-action-cancel"
                onPress={() => closeQuickActionDraft()}
              />
              <Button
                label={tr("common.save")}
                variant="primary"
                size="sm"
                accessibilityLabel="quick-action-save"
                onPress={() => void saveQuickActionDraft()}
              />
            </View>
          }
        >
          <If when={Boolean(draft())}>
            <View style={{ gap: 14 }}>
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
  ensureMcp();
  const draft = () => mcpDraft();
  const mcpModalOpen = usePresenceFlag(() => Boolean(mcpDraft()));
  const mcpDocumentUsable = (): boolean => mcpDocument() !== null;
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
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
                paddingVertical: 10,
              }}
            >
              <RowSeparator edge="bottom" />
              <Text style={textStyle("caption")}>{localizeHostError(notice())}</Text>
            </View>
          )}
        </If>

        <If when={mcpAvailable() === false}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
            <Text style={textStyle("caption")}>{tr("settings.mcp.unavailable")}</Text>
          </View>
        </If>

        <If when={mcpAvailable() !== false && !mcpDocumentUsable()}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
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
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
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
              <StatusDot
                kind={
                  row().enabled &&
                  (row().status.trim().toLowerCase() === "healthy" ||
                    row().status.trim().toLowerCase() === "connected")
                    ? "success"
                    : row().status.trim().toLowerCase() === "failed"
                      ? "danger"
                      : "muted"
                }
                size={7}
              />
              <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontWeight: "500",
                    letterSpacing: textTracking(14),
                    lineHeight: textLineHeight(14, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${row().name} · ${row().id}`}
                </Text>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(12, 1.4),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {`${row().transport || tr("settings.mcp.unknownTransport")} · ${
                    row().command || row().url || row().statusMessage || ""
                  }`}
                </Text>
                <If when={!row().enabled && row().statusMessage ? row().statusMessage : ""}>
                  {hint => <Text style={textStyle("meta")}>{hint()}</Text>}
                </If>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 0, gap: 6 }}>
                <Text
                  style={{
                    color:
                      row().enabled && row().status.trim().toLowerCase() === "failed"
                        ? palette().danger
                        : palette().textSecondary,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.4),
                  }}
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
                    accessibilityLabel: `mcp-delete-${row().id}`,
                    onSelect: () => mcpDeletePending.set(row().id),
                  },
                ]}
                onClose={() => rowMenuId.set(null)}
              />
              <If when={mcpDeletePending() === row().id}>
                <View testID={`mcp-delete-confirm-${row().id}`} style={{ paddingTop: 10 }}>
                  <InlineConfirmBar
                    message={tr("settings.mcp.deleteConfirm", { name: row().name || row().id })}
                    confirmLabel={tr("common.delete")}
                    danger={true}
                    onConfirm={() => {
                      mcpDeletePending.set(null);
                      void deleteMcpServer(row().id);
                    }}
                    onCancel={() => mcpDeletePending.set(null)}
                  />
                </View>
              </If>
            </View>
          )}
        </Each>
        <If when={mcpServerRows().length === 0 && mcpAvailable() === true}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 12,
              minHeight: SETTINGS_ROW_MIN,
            }}
          >
            <Icon name="plug" size={16} color={palette().textMuted} />
            <Text style={textStyle("caption")}>{tr("settings.mcp.noServers")}</Text>
          </View>
        </If>
        <If when={mcpBusy()}>
          {busy => (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={textStyle("meta")}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Text style={[textStyle("meta"), { flex: 1, minWidth: 0 }]}>
              {mcpJsonState()}
            </Text>
            <Button
              label={tr("common.discard")}
              variant="ghost"
              size="sm"
              accessibilityLabel="mcp-json-cancel"
              onPress={() => closeMcpJson()}
            />
            <Button
              label={tr("settings.mcp.saveJson")}
              variant="primary"
              size="sm"
              accessibilityLabel="mcp-json-save"
              onPress={() => void saveMcpJson()}
            />
          </View>
        }
      >
        <View style={{ gap: 10 }}>
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
        onClose={() => closeMcpAuth()}
        footer={
          <Button
            label={tr("common.close")}
            variant="ghost"
            size="sm"
            accessibilityLabel="mcp-auth-close"
            onPress={() => closeMcpAuth()}
          />
        }
      >
        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
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
                <View style={{ gap: 6 }}>
                  <Text style={textStyle("caption", { color: palette().warning })}>
                    {tr("settings.mcp.oauthOpenFailed")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 11,
                      paddingVertical: 9,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().text,
                        fontSize: textSize(12),
                        fontFamily: fontMono,
                        lineHeight: textLineHeight(12, 1.42),
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
              gap: 10,
              paddingTop: 14,
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Button
              label={tr("common.preview")}
              variant="secondary"
              size="sm"
              accessibilityLabel="mcp-import-preview"
              onPress={() => previewMcpImport()}
            />
            <Text style={[textStyle("meta"), { flex: 1, minWidth: 0 }]}>
              {localizeHostError(mcpImportNotice())}
            </Text>
            <Button
              label={tr("common.close")}
              variant="ghost"
              size="sm"
              accessibilityLabel="mcp-import-close"
              onPress={() => closeMcpImport()}
            />
            <Button
              label={tr("settings.mcp.importSelected")}
              variant="primary"
              size="sm"
              disabled={mcpImportCandidates() === null}
              accessibilityLabel="mcp-import-save"
              onPress={() => void importMcpServers()}
            />
          </View>
        }
      >
        <View style={{ gap: 12 }}>
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <PillChip
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
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    fontFamily: fontMono,
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
                        color: palette().warning,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.4),
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.refresh")}
              variant="secondary"
              size="sm"
              accessibilityLabel="mcp-resources-refresh"
              onPress={() => void loadMcpResources()}
            />
            <Button
              label={tr("common.close")}
              variant="ghost"
              size="sm"
              accessibilityLabel="mcp-resources-close"
              onPress={() => closeMcpResources()}
            />
          </View>
        }
      >
        <View style={{ gap: 10 }}>
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <PillChip
                  label={row().title ?? row().name}
                  active={mcpResourceSelected()?.uri === row().uri}
                  accessibilityLabel={`mcp-resource-${row().slot}`}
                  onPress={() => void openMcpResource(row())}
                />
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(11),
                    fontFamily: fontMono,
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
                  gap: 6,
                  padding: 12,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(12),
                    fontWeight: "600",
                    lineHeight: textLineHeight(12, 1.38),
                  }}
                >
                  {`${selected().name}${selected().mimeType ? ` · ${selected().mimeType}` : ""}`}
                </Text>
                <If when={mcpResourceContentBusy()}>
                  <Text style={textStyle("meta")}>{tr("common.reading")}</Text>
                </If>
                <If when={!mcpResourceContentBusy() && mcpResourceContent() ? mcpResourceContent() : ""}>
                  {content => (
                    <Scroll style={{ maxHeight: 240, minHeight: 0 }}>
                      <Text
                        style={{
                          color: palette().textSecondary,
                          fontSize: textSize(12),
                          fontFamily: fontMono,
                          lineHeight: textLineHeight(12, 1.5),
                        }}
                      >
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <If when={!draft()?.originalId}>
              <Text style={[textStyle("meta"), { flex: 1, minWidth: 0 }]}>
                {tr("settings.mcp.storedDisabledHint")}
              </Text>
            </If>
            <If when={Boolean(draft()?.originalId)}>
              <View style={{ flex: 1 }} />
            </If>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              accessibilityLabel="mcp-draft-cancel"
              onPress={() => closeMcpDraft()}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
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
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <PillChip
                  label={draft()?.enabled ? tr("common.enabled") : tr("common.disabled")}
                  active={Boolean(draft()?.enabled)}
                  accessibilityLabel="mcp-draft-enabled"
                  onPress={() => updateMcpDraft({ enabled: !(draft()?.enabled ?? false) })}
                />
                <PillChip
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
  ensureAcp();
  void probeAcpClients();
  return (
    <If when={acpSupported() !== false}>
      <SettingsSection
        flush={true}
        title={tr("settings.acp.title")}
        subtitle={tr("settings.acp.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
                  paddingVertical: 10,
                }}
              >
                <RowSeparator edge="bottom" />
                <Text style={textStyle("caption")}>{localizeHostError(notice())}</Text>
              </View>
            )}
          </If>

          <If when={acpClients().length === 0}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                minHeight: SETTINGS_ROW_MIN,
              }}
            >
              <Icon name="bot" size={16} color={palette().textMuted} />
              <Text style={[textStyle("caption"), { flex: 1, minWidth: 0 }]}>
                {tr("settings.acp.empty")}
              </Text>
            </View>
          </If>
          <Each of={acpClients()} key={client => client.id}>
            {(client, index) => (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  minHeight: SETTINGS_ROW_MIN,
                  position: "relative",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              >
                <If when={index() !== 0}>
                  <RowSeparator edge="top" />
                </If>
                <StatusDot
                  kind={
                    client().status === "running"
                      ? "success"
                      : client().status === "starting"
                        ? "accent"
                        : "muted"
                  }
                  size={7}
                  pulse={client().status === "starting"}
                />
                <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(14),
                      fontWeight: "500",
                      letterSpacing: textTracking(14),
                      lineHeight: textLineHeight(14, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${client().name} · ${client().id}`}
                  </Text>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      fontFamily: fontMono,
                      lineHeight: textLineHeight(12, 1.4),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {`${[client().command, ...client().args].filter(Boolean).join(" ") || tr("settings.acp.noCommand")} · ${acpRowStatus(client())}`}
                  </Text>
                  <If when={acpProbes()[client().id] && !acpProbes()[client().id].runnable}>
                    <Text
                      style={{
                        color: palette().warning,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.42),
                      }}
                    >
                      {acpProbes()[client().id].notes.join(" · ")}
                    </Text>
                  </If>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6 }}>
                  <Text
                    style={{
                      color: palette().textSecondary,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
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
                    minWidth={180}
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Text style={[textStyle("meta"), { flex: 1, minWidth: 0 }]}>
                {acpJsonDirty()
                  ? tr("settings.acp.unsavedChanges")
                  : acpJsonText()
                    ? tr("settings.acp.loaded")
                    : tr("common.loading")}
              </Text>
              <Button
                label={tr("common.discard")}
                variant="ghost"
                size="sm"
                accessibilityLabel="acp-json-discard"
                onPress={() => closeAcpJson()}
              />
              <Button
                label={tr("settings.mcp.saveJson")}
                variant="primary"
                size="sm"
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

function withHexAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return color;
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shared 5-step heatmap color ramp used 1:1 by `<Plot><Cell />` and legend swatches. */
function usageHeatmapStepColors(): string[] {
  const p = palette();
  return [
    p.heatmapZero,
    withHexAlpha(p.accent, 0.28),
    withHexAlpha(p.accent, 0.52),
    withHexAlpha(p.accent, 0.76),
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
  void loadUsage();
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
    <View style={{ gap: 36 }}>
      <SettingsSection
        title={tr("settings.usage.title")}
        flush={true}
        subtitle={tr("settings.usage.subtitle")}
        extra={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <If when={usageNotice()}>
              {notice => <HeaderNotice text={notice()} />}
            </If>
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
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: 12, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("settings.usage.unsupported")}</Text>
          </View>
        </If>
        <If when={!usageUnsupported() && !usageTotals() && !usageNotice()}>
          <View style={{ paddingHorizontal: SETTINGS_ROW_INSET, paddingVertical: 12, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
            <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
          </View>
        </If>
        <If when={usageTotals()}>
          {totals => (
            <View
              style={{
                minHeight: SETTINGS_ROW_MIN,
                paddingHorizontal: SETTINGS_ROW_INSET,
                paddingVertical: 12,
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: 16,
                rowGap: 6,
              }}
            >
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: 2 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(14, 1.4),
                  }}
                >
                  {tr("settings.usage.summaryRequestsTokens", {
                    requests: formatCount(totals().requests),
                    tokens: formatTokens(totals().tokens),
                  })}
                </Text>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(12, 1.45),
                  }}
                >
                  {tr("settings.usage.tokenBreakdown", {
                    input: formatTokens(totals().inputTokens),
                    output: formatTokens(totals().outputTokens),
                    cached: formatTokens(totals().cachedTokens),
                    cacheWrites: formatTokens(totals().cacheWriteTokens),
                  })}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
                <If when={hitRate()}>
                  {rate => (
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(13),
                        fontVariant: ["tabular-nums"],
                        lineHeight: textLineHeight(13, 1.4),
                      }}
                    >
                      {tr("settings.usage.cacheHitRate", { rate: rate() })}
                    </Text>
                  )}
                </If>
                <If when={totals().failedRequests > 0 || totals().unknownRequests > 0}>
                  <Text
                    style={{
                      color: palette().warning,
                      fontSize: textSize(12),
                      fontVariant: ["tabular-nums"],
                      lineHeight: textLineHeight(12, 1.4),
                    }}
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
            gap: 8,
            minHeight: 24,
            marginBottom: 8,
            paddingHorizontal: 4,
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
                color: hoveredActivityDay() ? palette().text : palette().textMuted,
                fontSize: textSize(12),
                fontWeight: hoveredActivityDay() ? "600" : "400",
                fontVariant: ["tabular-nums"],
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
        <View style={[insetGroupStyle(16), { gap: 12 }]}>
          <If when={usageActivity()}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ width: 24, height: HEATMAP_HEIGHT, flexShrink: 0, justifyContent: "space-between" }}>
                <Each of={localizedDayAxis()} key="index">
                  {label => (
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      <Text style={{ color: palette().textMuted, fontSize: textSize(10) }}>
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
                    cornerRadii={2.5}
                    hoverCellStyle={{
                      borderWidth: 1.5,
                      borderColor: palette().text,
                      borderRadius: 2.5,
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
              gap: 8,
            }}
          >
            <Text style={textStyle("meta")}>
              {activityTotal()
                ? isLightAppearance()
                  ? tr("settings.usage.heatmapCaptionLightWithTotal", { total: activityTotal() })
                  : tr("settings.usage.heatmapCaptionDarkWithTotal", { total: activityTotal() })
                : isLightAppearance()
                  ? tr("settings.usage.heatmapCaptionLight")
                  : tr("settings.usage.heatmapCaptionDark")}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
              <Text style={textStyle("micro")}>{tr("common.less")}</Text>
              <Each of={[0, 1, 2, 3, 4]} key={lvl => String(lvl)}>
                {lvl => (
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2.5,
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
              <Text style={textStyle("caption", { color: palette().warning })}>
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
              gap: 8,
              minHeight: 24,
              marginBottom: 8,
              paddingHorizontal: 4,
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        backgroundColor: palette().accent,
                      }}
                    />
                    <Text style={textStyle("micro")}>{tr("settings.usage.output")}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        backgroundColor: withHexAlpha(palette().accent, 0.36),
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
                    color: palette().text,
                    fontSize: textSize(12),
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
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
          <View style={insetGroupStyle(12)}>
            <View style={{ paddingLeft: 46, paddingRight: 6, paddingTop: 6, paddingBottom: 22 }}>
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
                    color: palette().textMuted,
                    fontSize: textSize(10),
                    fontVariant: ["tabular-nums"],
                    paddingRight: 8,
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
                    color: palette().textMuted,
                    fontSize: textSize(10),
                    fontVariant: ["tabular-nums"],
                    paddingTop: 6,
                  }}
                />
                <Bar
                  stack="tokens"
                  value="inputTokens"
                  cornerRadii={{ bottomLeft: 2, bottomRight: 2 }}
                  inactiveOpacity={0.42}
                  style={{ fill: withHexAlpha(palette().accent, 0.36) }}
                />
                <Bar
                  stack="tokens"
                  value="outputTokens"
                  cornerRadii={{ topLeft: 3, topRight: 3 }}
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
                  <Text style={textStyle("meta")}>
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
                    gap: 10,
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
                      color: palette().textMuted,
                      fontSize: textSize(11),
                      fontFamily: fontMono,
                      fontVariant: ["tabular-nums"],
                      minWidth: 112,
                      flexShrink: 0,
                    }}
                  >
                    {formatBucket(bucket().bucket, hourly())}
                  </Text>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(12),
                      fontVariant: ["tabular-nums"],
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
  ensureTaskModels();
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
        label: modelOptionLabel(model),
        description: model.provider,
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
  const descriptionOf = (task: string, fallback: string): string => {
    const hint = TASK_MODEL_HINT_KEYS[task] ? tr(TASK_MODEL_HINT_KEYS[task]) : fallback;
    return taskModelsAbsent() ? `${hint} · ${tr("common.default")}` : hint;
  };
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
          <View style={{ padding: 16 }}>
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
                  minWidth={220}
                  maxWidth={300}
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

function ModelRow(props: { model: ReturnType<typeof storedModels>[number]; index: number }) {
  const model = props.model;
  const compactMeta = (): string => {
    const parts: string[] = [model.model_name];
    if (model.context_window) {
      parts.push(
        tr("settings.models.ctxCompact", { value: formatTokens(model.context_window) }),
      );
    }
    if (model.max_tokens) {
      parts.push(
        tr("settings.models.outCompact", { value: formatTokens(model.max_tokens) }),
      );
    }
    return parts.filter(Boolean).join(" · ");
  };
  const outcome = () => modelTestOutcomes()[model.id] ?? { status: "idle" as const };
  const testing = (): boolean => outcome().status === "testing";
  const disabled = () => model.enabled === false;
  const menuKey = `model-${model.id}`;
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        position: "relative",
        opacity: disabled() ? 0.62 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <If when={props.index !== 0}>
        <RowSeparator edge="top" />
      </If>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.34),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {model.name}
            </Text>
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.34) }}>
              {model.provider}
            </Text>
            <If when={outcome().status === "testing"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Spinner size={11} color={palette().accent} />
                <Text style={textStyle("micro")}>{tr("common.testing")}</Text>
              </View>
            </If>
            <If when={outcome().status === "success"}>
              <Text style={{ color: palette().success, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.34) }}>
                {outcome().message || tr("common.connected")}
              </Text>
            </If>
            <If when={outcome().status === "error"}>
              <Text style={{ color: palette().danger, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.34) }}>
                {tr("common.failed")}
              </Text>
            </If>
          </View>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              fontFamily: fontMono,
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(12, 1.4),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {compactMeta()}
          </Text>
          <If when={outcome().status === "error" && outcome().errorDetails ? outcome().errorDetails! : ""}>
            {detail => (
              <Text
                style={{
                  color: palette().danger,
                  fontSize: textSize(11),
                  lineHeight: textLineHeight(11, 1.42),
                }}
              >
                {localizeHostError(detail())}
              </Text>
            )}
          </If>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 10 }}>
          <Button
            label={testing() ? tr("common.testing") : tr("common.test")}
            variant="secondary"
            size="sm"
            disabled={testing()}
            accessibilityLabel={`model-test-${model.id}`}
            onPress={() => void testSavedModelConnection(model)}
          />
          <ToggleSwitch
            checked={!disabled()}
            accessibilityLabel={`model-enabled-${model.id}`}
            onChange={next => void setModelEnabled(model.id, next)}
          />
          <View ref={el => setRowAnchor(menuKey, el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              tooltip={tr("settings.models.options")}
              accessibilityLabel={`model-actions-${model.id}`}
              onPress={() => rowMenuId.set(rowMenuId() === menuKey ? null : menuKey)}
            />
          </View>
        </View>
        <DropdownMenu
          open={rowMenuId() === menuKey}
          anchor={rowMenuAnchors()[menuKey] ?? null}
          onClose={() => rowMenuId.set(null)}
          items={[
            {
              id: "edit",
              label: tr("common.edit"),
              icon: "edit",
              accessibilityLabel: `model-edit-${model.id}`,
              onSelect: () => {
                rowMenuId.set(null);
                resetRemoteDiscovery();
                openModelEditor(model.id);
              },
            },
            {
              id: "limits",
              label: tr("settings.models.editLimits"),
              icon: "sliders",
              accessibilityLabel: `model-limits-${model.id}`,
              onSelect: () => {
                rowMenuId.set(null);
                openModelLimits(model.id);
              },
            },
            {
              id: "remove",
              label: tr("settings.models.removeModel"),
              icon: "trash",
              danger: true,
              accessibilityLabel: `remove-model-${model.id}`,
              onSelect: () => {
                rowMenuId.set(null);
                requestModelDelete(model.id);
              },
            },
          ]}
        />
      </View>
      <If when={modelDeletePending() === model.id}>
        <View testID={`model-delete-confirm-${model.id}`}>
        <InlineConfirmBar
          message={
            defaultModelReferences(model.id) > 0
              ? tr("settings.models.deleteConfirmReferenced", {
                  name: model.name,
                  count: defaultModelReferences(model.id),
                })
              : tr("settings.models.deleteConfirm", { name: model.name })
          }
          confirmLabel={tr("common.delete")}
          danger={true}
          onConfirm={() => void deleteModel(model.id)}
          onCancel={() => requestModelDelete(null)}
        />
        </View>
      </If>
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
  ensureRuntimeLogging();
  return (
    <SettingsSection
      title={tr("settings.logs.title")}
      flush={true}
      subtitle={tr("settings.logs.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <If when={loggingNotice()}>
            {notice => <HeaderNotice text={notice()} />}
          </If>
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
                  gap: 4,
                  minHeight: SETTINGS_ROW_MIN,
                  justifyContent: "center",
                  paddingHorizontal: SETTINGS_ROW_INSET,
                  paddingVertical: 10,
                }}
              >
                <Text
                  style={{
                    minWidth: 0,
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(12, 1.45),
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
                        minWidth: 0,
                        color: palette().textMuted,
                        fontSize: textSize(11),
                        fontFamily: fontMono,
                        lineHeight: textLineHeight(11, 1.45),
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
  if (percent < 15) return palette().danger;
  if (percent < 40) return palette().warning;
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
        gap: 8,
        paddingLeft: 17,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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

function SubscriptionsSection() {
  void loadSubscriptions();
  return (
    <If when={true}>
      <SettingsSection
        flush={true}
        title={tr("settings.subscriptions.title")}
        subtitle={tr("settings.subscriptions.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
        <View>
          <If when={!subscriptionsLoading() && subscriptionAccounts().length === 0}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: SETTINGS_ROW_MIN, justifyContent: "center" }}>
              <Text style={textStyle("caption")}>{tr("settings.subscriptions.none")}</Text>
            </View>
          </If>
          <Each of={subscriptionAccounts()} key={item => item.account_id}>
            {(item, index) => {
              const quota = () => subscriptionQuotas()[item().account_id] ?? null;
              return (
                <View
                  style={{
                    gap: 10,
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    minHeight: SETTINGS_ROW_MIN,
                    position: "relative",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                >
                  <If when={index() !== 0}>
                    <RowSeparator edge="top" />
                  </If>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <StatusDot
                      kind={
                        item().reauthentication_required
                          ? "warning"
                          : item().connected
                            ? "success"
                            : "muted"
                      }
                      size={7}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(14),
                          lineHeight: textLineHeight(14, 1.34),
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item().display_label || item().provider}
                      </Text>
                      <If when={item().account || quota()?.plan || !item().connected}>
                        <Text
                          style={{
                            color: palette().textMuted,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.4),
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item().connected
                            ? [item().account, quota()?.plan].filter(Boolean).join(" · ")
                            : tr("common.disconnected")}
                        </Text>
                      </If>
                    </View>
                    <If when={Boolean(item().reauthentication_required)}>
                      <Text
                        style={{
                          flexShrink: 0,
                          color: palette().warning,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.4),
                        }}
                      >
                        {tr("settings.subscriptions.reauthNeeded")}
                      </Text>
                    </If>
                    <If when={!item().connected || Boolean(item().reauthentication_required)}>
                      <Button
                        label={
                          item().reauthentication_required
                            ? tr("settings.subscriptions.signInAgain")
                            : tr("settings.subscriptions.signIn")
                        }
                        variant="secondary"
                        size="sm"
                        leadingIcon="log-in"
                        disabled={
                          subscriptionLogin()?.provider === item().provider &&
                          (subscriptionLogin()?.status === "pending" || subscriptionLogin()?.status === "starting")
                        }
                        accessibilityLabel={`subscription-connect-${item().provider}`}
                        onPress={() =>
                          void startSubscriptionSignIn(item().provider, false, item().login_methods ?? [])
                        }
                      />
                    </If>
                  </View>

                  <If when={subscriptionLogin()?.provider === item().provider}>
                    <SubscriptionLoginPanel />
                  </If>

                  <If when={quotaMeters(quota()).length > 0}>
                    <View style={{ gap: 10, paddingTop: 2, paddingLeft: 17 }}>
                      <Each of={quotaMeters(quota())} key={meter => meter.id}>
                        {meter => (
                          <View style={{ gap: 6 }}>
                            <Text
                              style={{
                                color: palette().textSecondary,
                                fontSize: textSize(12),
                                fontWeight: "500",
                                fontVariant: ["tabular-nums"],
                                lineHeight: textLineHeight(12, 1.38),
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
                  <If when={quota() && quotaMeters(quota()).length === 0 ? quotaUnknownText(quota()) : ""}>
                    {text => <Text style={textStyle("caption")}>{text()}</Text>}
                  </If>
                </View>
              );
            }}
          </Each>
        </View>
      </SettingsSection>
    </If>
  );
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

  return (
    <SettingsSection
      flush={true}
      title={tr("settings.models.title")}
      subtitle={tr("settings.models.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={modelSettingsNotice()}>
            {notice => <HeaderNotice text={notice()} />}
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
          <View style={{ padding: 16 }}>
            <Text style={textStyle("caption")}>{tr("settings.models.reading")}</Text>
          </View>
        </If>
        <If when={modelSettingsLoaded() && storedModels().length === 0}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 18,
            }}
          >
            <Icon name="cpu" size={16} color={palette().textMuted} />
            <Text style={textStyle("caption")}>{tr("settings.models.empty")}</Text>
          </View>
        </If>
        <Each of={storedModels()} key={model => model.id}>
          {(model, index) => <ModelRow model={model()} index={index()} />}
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
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flex: 1,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <Button
                  label={testStatus().status === "testing" ? tr("common.testing") : tr("common.test")}
                  variant="secondary"
                  size="sm"
                  disabled={testStatus().status === "testing"}
                  accessibilityLabel="model-draft-test"
                  onPress={() => void testDraftConnection(modelDraft())}
                />
                <If when={testStatus().status === "testing"}>
                  <Spinner size={14} color={palette().accent} />
                </If>
                <If when={testStatus().status === "success"}>
                  <Badge label={testStatus().message || tr("common.connected")} tone="success" />
                </If>
                <If when={testStatus().status === "error"}>
                  <Badge label={tr("common.failed")} tone="danger" />
                </If>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="model-editor-cancel"
                  onPress={() => {
                    resetRemoteDiscovery();
                    closeModelForm();
                  }}
                />
                <Button
                  label={modelDraft().editingId ? tr("common.save") : tr("settings.models.addModel")}
                  variant="primary"
                  size="sm"
                  accessibilityLabel="save-model"
                  onPress={() => void saveModelDraft()}
                />
              </View>
            </View>
          }
        >
          <View style={{ gap: 12 }}>
            <If when={testStatus().status === "error" && testStatus().errorDetails ? testStatus().errorDetails! : ""}>
              {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
            </If>
            <If when={!modelDraft().editingId && modelCatalogLoaded() && modelCatalog().length > 0}>
              <View
                style={{
                  gap: 10,
                  padding: 14,
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
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Each of={catalogProviders()} key={provider => provider.id}>
                    {provider => (
                      <PillChip
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
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    <Each of={selectedCatalogProvider()?.models ?? []} key={model => model.id}>
                      {model => (
                        <PillChip
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
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6 }}>
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Spinner size={12} color={palette().accent} />
                <Text style={textStyle("caption")}>{tr("settings.models.queryingRemote")}</Text>
              </View>
            </If>
            <If when={!remoteDiscoveryLoading() && remoteDiscoveredModels().length > 0}>
              <Text style={textStyle("caption", { color: palette().success, tabular: true })}>
                {tr("settings.models.detectedSummary", { count: remoteDiscoveredModels().length })}
              </Text>
            </If>
            <If when={remoteDiscoveryError()}>
              {err => (
                <Text style={textStyle("caption", { color: palette().warning })}>
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
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flex: 1,
              }}
            >
              <Text style={textStyle("meta")}>
                {tr("settings.models.selectedCount", { count: selectedDiscoveredIds().length })}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
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
                  size="sm"
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
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                <Text style={textStyle("caption", { color: palette().warning })}>
                  {localizeHostError(err())}
                </Text>
              )}
            </If>
            <If when={discoveredMatches().length === 0}>
              <Text style={textStyle("caption")}>{tr("settings.models.noMatches")}</Text>
            </If>
            <Scroll style={{ maxHeight: 260, minHeight: 0 }}>
              <View style={{ gap: 6 }}>
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
                          gap: 10,
                          paddingHorizontal: 11,
                          paddingVertical: 9,
                          borderRadius: radii.sm,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: selected() ? palette().accentBorder : palette().borderSubtle,
                          backgroundColor: selected()
                            ? palette().accentSoft
                            : palette().surfaceTertiary,
                          cursor: "pointer",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{ backgroundColor: palette().panelHover }}
                        activeStyle={tactileActiveStyle(0.99)}
                      >
                        <Icon
                          name={selected() ? "check" : "plus"}
                          size={13}
                          color={selected() ? palette().accent : palette().textMuted}
                        />
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text
                            style={{
                              color: palette().text,
                              fontSize: textSize(13),
                              fontWeight: "600",
                              lineHeight: textLineHeight(13, 1.35),
                              numberOfLines: 1,
                              textOverflow: "ellipsis",
                            }}
                          >
                            {item().label}
                          </Text>
                          <If when={item().description}>
                            {desc => (
                              <Text
                                style={{
                                  color: palette().textMuted,
                                  fontSize: textSize(11),
                                  fontVariant: ["tabular-nums"],
                                  numberOfLines: 1,
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {desc()}
                              </Text>
                            )}
                          </If>
                        </View>
                        <Badge
                          label={
                            item().source === "remote"
                              ? tr("common.remote")
                              : tr("settings.models.catalog")
                          }
                          tone={item().source === "remote" ? "accent" : "neutral"}
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
          footer={
            <If when={modelLimitsDraft() !== null}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`model-limits-cancel-${modelLimitsDraft()?.id ?? ""}`}
                  onPress={() => closeModelLimits()}
                />
                <Button
                  label={tr("common.save")}
                  variant="primary"
                  size="sm"
                  accessibilityLabel={`model-limits-save-${modelLimitsDraft()?.id ?? ""}`}
                  onPress={() => void saveModelLimits()}
                />
              </View>
            </If>
          }
        >
          <If when={modelLimitsDraft() !== null}>
            <View style={{ gap: 12 }}>
              <If when={limitsTargetModel()?.request_url || limitsTargetModel()?.base_url || ""}>
                {endpoint => (
                  <View style={{ gap: 4 }}>
                    <Text style={textStyle("label", { color: palette().textSecondary })}>
                      {tr("settings.models.endpointLabel")}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().surfaceTertiary,
                      }}
                    >
                      <Text
                        style={{
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.44),
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
  const pad = 6;
  const previewR = concentricRadius(outerR, pad);
  const canvasR = concentricRadius(previewR, 2);
  return (
    <View
      style={{
        padding: 16,
      }}
    >
      <View
        style={{
          display: "grid",
          gridTemplateColumns: settingsCompact() ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
          gap: 12,
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
                onPress={() => selectAppearancePreset(preset().id)}
                style={{
                  gap: 7,
                  padding: pad,
                  borderRadius: outerR,
                  borderCurve: "continuous",
                  borderWidth: active() ? 2 : 1,
                  borderColor: active() ? palette().accent : palette().borderSubtle,
                  backgroundColor: active() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  borderColor: active() ? palette().accent : palette().borderStrong,
                  backgroundColor: active() ? palette().accentSoft : palette().panelHover,
                }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={{
                  outlineWidth: 2,
                  outlineColor: palette().borderFocus,
                  outlineOffset: 2,
                }}
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
                    padding: 2.5,
                    gap: 2.5,
                  }}
                >
                  {/* Sidebar Rail */}
                  <View
                    style={{
                      width: "27%",
                      paddingHorizontal: 4,
                      paddingVertical: 5,
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ gap: 3.5 }}>
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
                          height: 2.5,
                          width: "66%",
                          borderRadius: radii.pill,
                          backgroundColor: sw().chromeTextMuted,
                          opacity: 0.55,
                        }}
                      />
                      <View
                        style={{
                          height: 2.5,
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
                      padding: 6,
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ gap: 3.5 }}>
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
                        gap: 4,
                      }}
                    >
                      <View
                        style={{
                          height: 11,
                          flex: 1,
                          borderRadius: 3.5,
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
                        top: 5,
                        right: 5,
                        width: 17,
                        height: 17,
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

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 3, paddingBottom: 1 }}>
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().text,
                      fontSize: textSize(12),
                      fontWeight: active() ? "600" : "500",
                      lineHeight: textLineHeight(12, 1.32),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {tr(APPEARANCE_PRESET_KEYS[preset().id])}
                  </Text>
                  <Text style={{ flexShrink: 0, color: palette().textMuted, fontSize: textSize(10) }}>
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
  return (
    <SettingsSection
      flush={true}
      title={tr("settings.appearance.title")}
      subtitle={tr("settings.appearance.subtitle")}
    >
      <View>
        <AppearanceSwatchGallery />
        <SettingsConfigRow
          label={tr("settings.appearance.colorScheme")}
          description={
            resolvedScheme() === "light"
              ? tr("settings.appearance.showingLight")
              : tr("settings.appearance.showingDark")
          }
          topDivider={true}
          divider={false}
        >
          <SegmentedTabs
            size="sm"
            value={appearanceMode()}
            options={APPEARANCE_MODES.map(mode => ({
              value: mode.value,
              label: tr(mode.labelKey),
              accessibilityLabel: `appearance-${mode.value}`,
            }))}
            onChange={mode => {
              appearanceId.set(null);
              applyAppearance(mode as AppearanceMode);
            }}
          />
        </SettingsConfigRow>
        <FontSizeRows />
        <ContentWidthRow />
      </View>
    </SettingsSection>
  );
}

function NumericStepper(props: {
  valueText: string;
  decreaseAccessibilityLabel: string;
  increaseAccessibilityLabel: string;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View
      style={{
        boxSizing: "border-box",
        width: 128,
        height: controlHeight.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 2,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().segmentedTrackBg,
        gap: 2,
        flexShrink: 0,
      }}
    >
      <ActionButton
        label="−"
        variant="ghost"
        size="xs"
        accessibilityLabel={props.decreaseAccessibilityLabel}
        disabled={props.decreaseDisabled}
        style={{ width: 26, paddingHorizontal: 0 }}
        onPress={props.onDecrease}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().text,
          fontSize: textSize(12),
          fontWeight: "600",
          fontVariant: ["tabular-nums"],
          textAlign: "center",
          numberOfLines: 1,
        }}
      >
        {props.valueText}
      </Text>
      <ActionButton
        label="+"
        variant="ghost"
        size="xs"
        accessibilityLabel={props.increaseAccessibilityLabel}
        disabled={props.increaseDisabled}
        style={{ width: 26, paddingHorizontal: 0 }}
        onPress={props.onIncrease}
      />
    </View>
  );
}

function ContentWidthRow() {
  const isCustomWidth = () => contentWidth() !== DEFAULT_CONTENT_WIDTH;
  return (
    <View
      style={{
        position: "relative",
        gap: 6,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: 10,
      }}
    >
      <RowSeparator edge="top" />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.4),
              }}
            >
              {tr("settings.appearance.contentWidth")}
            </Text>
            <Text style={textStyle("micro")}>
              {tr("settings.appearance.narrowest", { px: MIN_CONTENT_WIDTH })}
            </Text>
          </View>
          <Text style={textStyle("caption", { tabular: true })}>
            {tr("settings.appearance.contentWidthDesc", { px: contentWidth() })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <If when={isCustomWidth()}>
            <Button
              label={tr("common.reset")}
              variant="ghost"
              size="sm"
              accessibilityLabel="content-width-reset"
              onPress={() => resetContentWidth()}
            />
          </If>
          <NumericStepper
            valueText={`${contentWidth()} px`}
            decreaseAccessibilityLabel="content-width-decrease"
            increaseAccessibilityLabel="content-width-increase"
            decreaseDisabled={contentWidth() <= MIN_CONTENT_WIDTH}
            onDecrease={() => adjustContentWidth(-CONTENT_WIDTH_STEP)}
            onIncrease={() => adjustContentWidth(CONTENT_WIDTH_STEP)}
          />
        </View>
      </View>
      <If when={contentWidthNotice().length > 0 ? contentWidthNotice() : ""}>
        {notice => (
          <Text style={textStyle("meta", { color: palette().warning })}>
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
        gap: 10,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        paddingHorizontal: SETTINGS_ROW_INSET,
        paddingVertical: 10,
      }}
    >
      <RowSeparator edge="top" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(14),
              lineHeight: textLineHeight(14, 1.4),
            }}
          >
            {tr("settings.appearance.textSize")}
          </Text>
          <Text style={textStyle("caption", { tabular: true })}>
            {tr("settings.appearance.fontBaseline", { px: fontPx() })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <If when={fontLevel() !== "default"}>
            <Button
              label={tr("common.reset")}
              variant="ghost"
              size="sm"
              accessibilityLabel="font-size-reset"
              onPress={() => void resetFontPreference()}
            />
          </If>
          <NumericStepper
            valueText={`${fontPx()} px`}
            decreaseAccessibilityLabel="font-size-decrease"
            increaseAccessibilityLabel="font-size-increase"
            decreaseDisabled={fontPx() <= MIN_FONT_PX}
            increaseDisabled={fontPx() >= MAX_FONT_PX}
            onDecrease={() => void adjustFontPx(-1)}
            onIncrease={() => void adjustFontPx(1)}
          />
        </View>
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
          <Text style={textStyle("meta", { color: palette().danger })}>
            {localizeHostError(notice())}
          </Text>
        )}
      </If>
    </View>
  );
}

function PoolsSection() {
  ensurePools();
  const poolModalOpen = usePresenceFlag(() => poolDraft() !== null);
  return (
    <If when={poolsSupported() !== false}>
      <SettingsSection
        flush={true}
        title={tr("settings.pools.title")}
        subtitle={tr("settings.pools.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <If when={poolsNotice()}>
              {notice => <HeaderNotice text={notice()} />}
            </If>
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
            <View style={{ padding: 16 }}>
              <Text style={textStyle("caption")}>{tr("settings.pools.reading")}</Text>
            </View>
          </If>
          <If when={poolsSupported() === true && pools().length === 0 && !poolDraft()}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
                minHeight: SETTINGS_ROW_MIN,
              }}
            >
              <Icon name="layers" size={16} color={palette().textMuted} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    lineHeight: textLineHeight(14, 1.4),
                  }}
                >
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
            {(pool, index) => <PoolRow pool={pool()} first={index() === 0} />}
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Button
                    label={tr("common.cancel")}
                    variant="ghost"
                    size="sm"
                    onPress={() => closePoolDraft()}
                  />
                  <Button
                    label={
                      poolDraft()?.id
                        ? tr("settings.pools.savePool")
                        : tr("settings.pools.createPool")
                    }
                    variant="primary"
                    size="sm"
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

function PoolRow(props: { pool: ModelPool; first?: boolean }) {
  const pool = props.pool;
  const labelOf = (modelId: string): string =>
    storedModels().find(model => model.id === modelId)?.name || modelId;
  const statusesOf = () => poolStatuses()[pool.id] ?? [];
  const strategyLabel = () => {
    const mapped = POOL_STRATEGY_KEYS[pool.strategy];
    if (mapped) return tr(mapped.labelKey);
    return POOL_STRATEGIES.find(entry => entry.value === pool.strategy)?.label ?? pool.strategy;
  };
  const menuKey = `pool-${pool.id}`;
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: SETTINGS_ROW_MIN,
        justifyContent: "center",
        position: "relative",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <If when={!props.first}>
        <RowSeparator edge="top" />
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.35),
            flex: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {pool.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
            {tr("settings.pools.membersSummary", {
              strategy: strategyLabel(),
              count: pool.memberModelIds.length,
            })}
          </Text>
          <Button
            label={tr("common.check")}
            variant="secondary"
            size="sm"
            accessibilityLabel={`check-pool-${pool.id}`}
            onPress={() => void loadPoolStatus(pool.id)}
          />
          <View ref={el => setRowAnchor(menuKey, el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              tooltip={tr("settings.pools.options")}
              accessibilityLabel={`pool-actions-${pool.id}`}
              onPress={() => rowMenuId.set(rowMenuId() === menuKey ? null : menuKey)}
            />
          </View>
        </View>
        <DropdownMenu
          open={rowMenuId() === menuKey}
          anchor={rowMenuAnchors()[menuKey] ?? null}
          onClose={() => rowMenuId.set(null)}
          items={[
            {
              id: "edit",
              label: tr("settings.pools.editPool"),
              icon: "edit",
              accessibilityLabel: `edit-pool-${pool.id}`,
              onSelect: () => {
                rowMenuId.set(null);
                openPoolDraft(pool);
              },
            },
            {
              id: "delete",
              label: tr("settings.pools.deletePool"),
              icon: "trash",
              danger: true,
              accessibilityLabel: `delete-pool-${pool.id}`,
              onSelect: () => {
                rowMenuId.set(null);
                void deletePool(pool.id);
              },
            },
          ]}
        />
      </View>
      <Text style={textStyle("caption")}>
        {pool.memberModelIds.length === 0
          ? tr("settings.pools.noMemberYet")
          : pool.memberModelIds.map(labelOf).join(" → ")}
      </Text>
      <If when={statusesOf().length > 0}>
        <View style={{ gap: 4, paddingTop: 2 }}>
          <Each of={statusesOf()} key={entry => entry.modelId}>
            {entry => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusDot
                  kind={(() => {
                    const tone = poolMemberTone(entry().status);
                    return tone === "neutral" ? "muted" : tone;
                  })()}
                  size={6}
                />
                <Text style={{ flex: 1, minWidth: 0, color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
                  {`${entry().modelId}: ${entry().status}${entry().reason ? ` (${entry().reason})` : ""}`}
                </Text>
              </View>
            )}
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
    return found && found.name && found.name !== modelId ? `${found.name} (${modelId})` : modelId;
  };
  const strategyHint = () => {
    const mapped = POOL_STRATEGY_KEYS[strategyOf()];
    if (mapped) return tr(mapped.hintKey);
    return POOL_STRATEGIES.find(entry => entry.value === strategyOf())?.hint ?? "";
  };
  return (
    <View style={{ gap: 14 }}>
      <ModelFormField
        label={tr("settings.pools.poolName")}
        value={poolDraft()?.name ?? ""}
        placeholder={tr("settings.pools.namePlaceholder")}
        accessibilityLabel="model-pool-name"
        onChange={value => updatePoolDraft({ name: value })}
      />
      <View style={{ gap: 6 }}>
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
      <View style={{ gap: 6 }}>
        <Text style={textStyle("label", { color: palette().textSecondary, tabular: true })}>
          {membersOf().length === 0
            ? tr("settings.pools.membersInOrderEmpty")
            : tr("settings.pools.membersInOrder", { count: membersOf().length })}
        </Text>
        <If when={membersOf().length > 0}>
          <View
            style={{
              borderRadius: radii.sm,
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
                    gap: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    position: "relative",
                  }}
                >
                  <If when={index() !== 0}>
                    <RowSeparator edge="top" />
                  </If>
                  <Badge label={`#${index() + 1}`} tone="neutral" />
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(12),
                      fontFamily: fontMono,
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {memberName(modelId())}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
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
      <View style={{ gap: 6 }}>
        <Text style={textStyle("label", { color: palette().textSecondary })}>
          {tr("settings.pools.availableModels")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Each of={storedModels()} key={model => model.id}>
            {model => (
              <PillChip
                label={`${hasMember(model().id) ? "✓ " : "+ "}${model().name || model().id}`}
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
    >
      <If when={isAccountSignedIn()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusPill label={signedInAccountDisplay()} kind="success" size="sm" />
          <Button
            label={tr("settings.account.manage")}
            variant="secondary"
            size="sm"
            accessibilityLabel="settings-account-manage"
            onPress={() => openAccountAuthModal()}
          />
        </View>
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

function KeyboardRow() {
  const overrides = (): number => {
    const app = settingsValues()["app"];
    if (!app || typeof app !== "object") return 0;
    const stored = (app as Record<string, unknown>).keybindings;
    return stored && typeof stored === "object" ? Object.keys(stored as Record<string, unknown>).length : 0;
  };
  return (
    <SettingsGroup id="shortcuts" title={tr("settings.shortcuts.title")}>
      <SettingsRow label={tr("settings.shortcuts.title")} description={tr("settings.shortcuts.hint")} first={true}>
        <RowValue
          text={
            overrides()
              ? formatPlural(
                  overrides(),
                  "settings.shortcuts.overridesStoredOne",
                  "settings.shortcuts.overridesStoredOther",
                )
              : tr("settings.shortcuts.defaults")
          }
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/**
 * `terminal.default_shell` over the shells this host detects: empty means the
 * host picks (auto-detect), as the desktop's terminal page offers it.
 */
function DefaultShellRow() {
  void loadTerminalShells();
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
        minWidth={220}
        maxWidth={300}
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
    emptyKey: "settings.defaultModels.notSet",
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
    emptyKey: "settings.defaultModels.notSet",
    capability: "text_chat",
  },
  image_understanding: {
    labelKey: "settings.defaultModels.imageUnderstanding",
    descriptionKey: "settings.defaultModels.imageUnderstandingDesc",
    emptyKey: "settings.defaultModels.notSet",
    capability: "image_understanding",
  },
  speech_recognition: {
    labelKey: "settings.defaultModels.speechRecognition",
    descriptionKey: "settings.defaultModels.speechRecognitionDesc",
    emptyKey: "settings.defaultModels.notSet",
    capability: "speech_recognition",
  },
};

/**
 * `ai.default_models`: which configured model each role resolves to. Each slot
 * offers only the enabled models that have its capability, as the desktop's
 * `DefaultModelConfig` does; the primary slot cannot be cleared.
 */
function DefaultModelsSection() {
  void loadDefaultModels();
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
        label: modelOptionLabel(model),
        description: model.provider,
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
  return (
    <SettingsGroup
      id="default-models"
      title={tr("settings.defaultModels.title")}
      description={tr("settings.defaultModels.subtitle")}
      notice={defaultModelsNotice()}
      onDismissNotice={() => defaultModelsNotice.set("")}
    >
      <Each of={[...DEFAULT_MODEL_SLOTS]} key={slot => slot}>
        {(slot, index) => (
          <SettingsRow
            label={tr(DEFAULT_MODEL_SLOT_KEYS[slot()].labelKey)}
            description={tr(DEFAULT_MODEL_SLOT_KEYS[slot()].descriptionKey)}
            first={index() === 0}
          >
            <If when={defaultModelSaving() === slot()}>
              <Spinner size={12} color={palette().accent} />
            </If>
            <SelectDropdown
              size="sm"
              value={defaultModels()[slot()] ?? ""}
              options={optionsFor(slot())}
              placeholder={tr("settings.defaultModels.choose")}
              searchable={optionsFor(slot()).length > 8}
              accessibilityLabel={`default-model-${slot()}`}
              disabled={defaultModelSaving() !== null || (slot() === "primary" && optionsFor(slot()).length === 0)}
              minWidth={220}
              maxWidth={300}
              align="end"
              onChange={value => void chooseDefaultModel(slot(), value || null)}
            />
          </SettingsRow>
        )}
      </Each>
    </SettingsGroup>
  );
}

/**
 * Launch at login is a login item on the host, set through product control as
 * the desktop's General page does. A host that does not answer says so.
 */
function LaunchAtLoginRow() {
  void loadGeneralControl();
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

/**
 * The companion pet and desktop cards are separate always-on-top windows of the
 * Tauri desktop. The native desktop does not draw them yet, so it says so here
 * instead of offering switches that would do nothing.
 */
function DesktopCompanionRow() {
  return (
    <SettingsRow
      label={tr("settings.field.desktopCompanion")}
      description={tr("settings.field.desktopCompanionUnavailable")}
    >
      <Text
        accessibilityLabel="desktop-companion-unavailable"
        style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}
      >
        {tr("settings.field.notAvailableHere")}
      </Text>
    </SettingsRow>
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
        <Button
          label={tr("settings.memory.reset")}
          variant="danger"
          size="sm"
          loading={memoryActionBusy() === "reset"}
          disabled={memoryActionBusy() !== null}
          accessibilityLabel="memory-reset"
          onPress={() => memoryResetPending.set(true)}
        />
      </SettingsRow>
      <If when={memoryResetPending()}>
        <View testID="memory-reset-confirm" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <InlineConfirmBar
            message={tr("settings.memory.resetConfirm")}
            confirmLabel={tr("settings.memory.reset")}
            danger={true}
            onConfirm={() => void resetMemory()}
            onCancel={() => memoryResetPending.set(false)}
          />
        </View>
      </If>
    </View>
  );
}

const SPEECH_STATE_KEYS: Record<string, MessageKey> = {
  not_installed: "settings.speech.notInstalled",
  downloading: "settings.speech.downloading",
  installed: "settings.speech.installed",
  verifying: "settings.speech.verifying",
  corrupt: "settings.speech.corrupt",
  deleting: "settings.speech.deleting",
  error: "settings.speech.error",
};

/**
 * The local speech models voice input runs on, with their install state and a
 * download (or cancel) per model, as the desktop's voice section offers them.
 * They live on the machine this window runs on, so this row says so while
 * another device is driven.
 */
function SpeechModelsRow() {
  void loadSpeechModels();
  const models = () => {
    const list = speechModels();
    return Array.isArray(list) ? list : [];
  };
  const stateText = (model: SpeechModelStatus): string => {
    const label = SPEECH_STATE_KEYS[model.state] ? tr(SPEECH_STATE_KEYS[model.state]) : model.state;
    if (model.state === "downloading" && model.progress && model.progress.totalBytes > 0) {
      return `${label} · ${formatBytes(model.progress.downloadedBytes)} / ${formatBytes(model.progress.totalBytes)}`;
    }
    if (model.state === "installed" && model.installedBytes) return `${label} · ${formatBytes(model.installedBytes)}`;
    if (model.state === "not_installed" && model.expectedBytes) return `${label} · ${formatBytes(model.expectedBytes)}`;
    return model.error ? `${label} · ${model.error}` : label;
  };
  return (
    <View>
      <SettingsRow
        label={tr("settings.speech.title")}
        description={
          speechModels() === false
            ? tr("settings.speech.unavailable")
            : tr("settings.speech.desc")
        }
      />
      <If when={speechNotice()}>
        {notice => (
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
            <InlineBanner tone="danger" message={localizeHostError(notice())} onDismiss={() => speechNotice.set("")} />
          </View>
        )}
      </If>
      <Each of={models()} key={model => model.modelId}>
        {model => (
          <View style={{ paddingHorizontal: 20, paddingBottom: 14, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={textStyle("label")}>{model().displayName || model().modelId}</Text>
                <Text style={textStyle("caption")}>{stateText(model())}</Text>
              </View>
              <If when={model().state === "not_installed" || model().state === "corrupt" || model().state === "error"}>
                <Button
                  label={tr("settings.speech.download")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="download"
                  accessibilityLabel={`speech-download-${model().modelId}`}
                  onPress={() => void downloadSpeechModel(model().modelId)}
                />
              </If>
              <If when={model().state === "downloading"}>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`speech-cancel-${model().modelId}`}
                  onPress={() => void cancelSpeechModelDownload(model().modelId)}
                />
              </If>
              <If when={model().state === "installed"}>
                <RowValue text={tr("settings.speech.ready")} />
              </If>
            </View>
            <If when={model().state === "downloading"}>
              <View style={{ height: 4, borderRadius: radii.pill, backgroundColor: palette().segmentedTrackBg, overflow: "hidden" }}>
                <View
                  style={{
                    height: "100%",
                    width: `${Math.max(2, Math.min(100, model().progress?.percent ?? 0))}%`,
                    borderRadius: radii.pill,
                    backgroundColor: palette().accent,
                  }}
                />
              </View>
            </If>
          </View>
        )}
      </Each>
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

function failSuperagent(error: unknown, command: string): void {
  if (isCommandUnavailable(error, command)) {
    obfState.set("unsupported");
    obfNote.set("");
  } else {
    obfState.set("failed");
    obfNote.set(error instanceof Error ? error.message : String(error ?? ""));
  }
}

async function loadSuperagentStatus(): Promise<void> {
  if (obfStatus() === null) obfState.set("loading");
  try {
    obfStatus.set(readSuperagentStatus(await superagentCall("superagent_status", {})));
    obfState.set("ready");
    obfNote.set("");
  } catch (error) {
    failSuperagent(error, "superagent_status");
  }
}

async function setSuperagentEnabled(next: boolean): Promise<void> {
  const command = next ? "superagent_enable" : "superagent_disable";
  obfBusy.set(true);
  try {
    const answer = (await superagentCall(command, {})) as Record<string, unknown> | null;
    const current = obfStatus();
    // The node answers the state it stored; the switch shows that, not the press.
    const enabled = typeof answer?.enabled === "boolean" ? answer.enabled : next;
    if (current) obfStatus.set({ ...current, enabled });
    await loadSuperagentStatus();
  } catch (error) {
    failSuperagent(error, command);
  } finally {
    obfBusy.set(false);
  }
}

async function deleteSuperagentData(): Promise<void> {
  obfBusy.set(true);
  try {
    await superagentCall("superagent_delete_data", { cancelJobs: true });
    obfDeleteOpen.set(false);
    await loadSuperagentStatus();
  } catch (error) {
    obfDeleteOpen.set(false);
    failSuperagent(error, "superagent_delete_data");
  } finally {
    obfBusy.set(false);
  }
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
              <Button
                label={tr("common.delete")}
                variant="secondary"
                size="sm"
                disabled={obfBusy()}
                accessibilityLabel="obf-delete-data"
                onPress={() => obfDeleteOpen.set(true)}
              />
            </SettingsRow>
          </SettingsGroup>
        </View>
      </If>
      <ModalDialog
        open={obfDeleteOpen()}
        title={tr("obf.deleteTitle")}
        subtitle={tr("obf.deleteBody")}
        size="sm"
        accessibilityLabel="obf-delete-dialog"
        onClose={() => obfDeleteOpen.set(false)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              accessibilityLabel="obf-delete-cancel"
              onPress={() => obfDeleteOpen.set(false)}
            />
            <Button
              label={tr("common.delete")}
              variant="danger"
              size="sm"
              loading={obfBusy()}
              accessibilityLabel="obf-delete-confirm"
              onPress={() => void deleteSuperagentData()}
            />
          </View>
        }
      />
    </View>
  );
}

// ── Account › Activity (the six-month heatmap the host computes) ──

/** Cell and gap of the activity heatmap (visual spec §4.9: 10 px cells, 2 px gap). */
const ACTIVITY_CELL = space.sm + space.hair;
const ACTIVITY_GAP = space.hair;
const ACTIVITY_CELL_RADIUS = radii.xs / 2;
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
  return (
    <View
      style={{
        width: ACTIVITY_CELL,
        height: ACTIVITY_CELL,
        borderRadius: ACTIVITY_CELL_RADIUS,
        backgroundColor: empty() ? "transparent" : zero() ? palette().heatmapZero : palette().accent,
        opacity: empty() || zero() ? 1 : ACTIVITY_STEPS[props.cell.level],
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
          <Text accessibilityLabel="activity-insights-error" style={textStyle("caption", { color: palette().danger })}>
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
        backgroundColor: selectedInsightsPath() === props.path ? palette().panelHover : undefined,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
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
            <>
              <Button
                label={tr("settings.insights.regenerate")}
                variant="secondary"
                size="sm"
                disabled={insightsGenerating()}
                accessibilityLabel="insights-regenerate"
                onPress={() => void generateInsightsReport()}
              />
              <If when={report().htmlPath}>
                <Button
                  label={tr("settings.insights.showHtml")}
                  variant="secondary"
                  size="sm"
                  disabled={!insightsOnThisDevice()}
                  tooltip={insightsOnThisDevice() ? undefined : tr("settings.insights.htmlElsewhere")}
                  accessibilityLabel="insights-show-html"
                  onPress={() => void revealInsightsHtml(report().htmlPath)}
                />
              </If>
              <Button label={tr("common.close")} variant="primary" size="sm" onPress={closeInsightsModal} />
            </>
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

/** `delete_all_archived_sessions` for the open workspace; the catalogue is read again after. */
async function deleteAllArchived(): Promise<void> {
  const workspace = activeWorkspace();
  if (!workspace || archivedDeletingAll()) return;
  archivedDeletingAll.set(true);
  try {
    const deleted = await invokeCommand<number>("delete_all_archived_sessions", {
      workspace_id: workspace.id,
      workspace_path: workspace.rootPath,
    });
    archivedDeleteAllOpen.set(false);
    pushToast(tr("settings.archived.deletedAll", { count: typeof deleted === "number" ? deleted : 0 }), "success");
    await loadSessions();
  } catch (error) {
    pushToast(localizeHostError(error instanceof Error ? error.message : String(error)), "error");
  } finally {
    archivedDeletingAll.set(false);
  }
}

function ArchivedSessionsSection() {
  const rows = () => sessions().filter(item => isSessionArchived(item));
  return (
    <View accessibilityLabel="settings-archived" style={{ gap: space.md }}>
      <If when={rows().length > 1}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button
            label={tr("settings.archived.deleteAll")}
            variant="ghost"
            size="sm"
            accessibilityLabel="settings-archived-delete-all"
            onPress={() => archivedDeleteAllOpen.set(true)}
          />
        </View>
      </If>
      <ModalDialog
        open={archivedDeleteAllOpen()}
        size="sm"
        title={tr("settings.archived.deleteAllTitle")}
        accessibilityLabel="settings-archived-delete-all-modal"
        onClose={() => archivedDeleteAllOpen.set(false)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="sm" onPress={() => archivedDeleteAllOpen.set(false)} />
            <Button
              label={tr("common.delete")}
              variant="danger"
              size="sm"
              loading={archivedDeletingAll()}
              accessibilityLabel="settings-archived-delete-all-confirm"
              onPress={() => void deleteAllArchived()}
            />
          </View>
        }
      >
        <Text style={textStyle("body", { color: palette().textSecondary })}>
          {tr("settings.archived.deleteAllBody", { count: rows().length })}
        </Text>
      </ModalDialog>
      <If
        when={rows().length > 0}
        else={
          <Text accessibilityLabel="settings-archived-empty" style={textStyle("body", { color: palette().textMuted })}>
            {tr("settings.archived.empty")}
          </Text>
        }
      >
        <SettingsGroup id="archived" title={tr("settings.page.archived")} hideTitle={true}>
          <Each of={rows()} key={row => row.sessionId}>
            {(row, index) => (
              <SettingsRow label={row().sessionName || row().sessionId} first={index() === 0}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Button
                    label={tr("session.delete")}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={`settings-archived-delete-${row().sessionId}`}
                    onPress={() =>
                      openSessionDelete({
                        sessionId: row().sessionId,
                        deviceId: deviceContext(),
                        workspaceId: activeWorkspace()?.id ?? "",
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
                    onPress={() => {
                      const id = row().sessionId;
                      archivedRestoring.set(id);
                      void archiveSessionRow(id, false).finally(() => archivedRestoring.set(null));
                    }}
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

function externalHealthKind(health: string, lifecycle: string): StatusPillKind {
  if (lifecycle === "removed" || lifecycle === "unavailable" || health === "unavailable") return "danger";
  if (health === "degraded" || health === "partial" || lifecycle === "degraded") return "warning";
  return "success";
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
function ExternalSourceRowView(props: { row: ExternalSourceRow; first: boolean }) {
  return (
    <View
      accessibilityLabel={`external-source-${props.row.stableKey}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: props.first ? 0 : 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13),
            fontWeight: "600",
            lineHeight: textLineHeight(13, 1.38),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.row.displayName || props.row.ecosystemId}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.4),
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {[externalScopeLabel(props.row.scope), props.row.location].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <StatusPill
        label={externalHealthLabel(props.row.health, props.row.lifecycle)}
        kind={externalHealthKind(props.row.health, props.row.lifecycle)}
      />
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
          <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
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
        <View style={{ borderTopWidth: 1, borderColor: palette().borderSubtle }}>
          <Each of={snapshot()?.sources ?? []} key={row => row.stableKey}>
            {(row, index) => <ExternalSourceRowView row={row()} first={index() === 0} />}
          </Each>
        </View>
      </If>
    </SettingsGroup>
  );
}

/** One MCP server another application declares, with what importing it would do. */
function McpImportRow(props: { item: McpImportItem; first: boolean }) {
  const selectable = () => mcpItemSelectable(props.item);
  const kind = (): StatusPillKind => {
    if (props.item.disposition === "already_imported") return "neutral";
    if (selectable()) return "success";
    return "warning";
  };
  return (
    <View
      accessibilityLabel={`external-mcp-${props.item.candidateId}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: props.first ? 0 : 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13),
            fontWeight: "600",
            lineHeight: textLineHeight(13, 1.38),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.item.displayName}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.4),
            numberOfLines: 2,
          }}
        >
          {[
            props.item.transport === "streamable_http"
              ? tr("settings.externalImports.transportHttp")
              : tr("settings.externalImports.transportStdio"),
            props.item.disposition === "automatic_rename" && props.item.proposedNativeId
              ? tr("settings.externalImports.renameTo", { name: props.item.proposedNativeId })
              : "",
            props.item.reasonCode === "external_mcp.import_setup_required"
              ? tr("settings.externalImports.setupRequired")
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <StatusPill label={tr(mcpItemStateKey(props.item) as MessageKey)} kind={kind()} />
      <If when={selectable()}>
        <Button
          label={tr("settings.externalImports.import")}
          variant="secondary"
          size="sm"
          loading={mcpImportBusy() === props.item.candidateId}
          disabled={Boolean(mcpImportBusy())}
          accessibilityLabel={`external-mcp-import-${props.item.candidateId}`}
          onPress={() => void applyMcpImport(props.item.candidateId)}
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
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
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
          {(item, index) => <McpImportRow item={item()} first={index() === 0} />}
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
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderTopWidth: index() === 0 ? 0 : 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13),
                    fontWeight: "600",
                    lineHeight: textLineHeight(13, 1.38),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {row().sessionName}
                </Text>
                <Text
                  style={{
                    color:
                      removedRestoreFailed() === removedSessionKey(row()) ? palette().danger : palette().textMuted,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.4),
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
    <View style={{ gap: 36 }}>
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
        <FieldSection sectionId="input">
          <SpeechModelsRow />
        </FieldSection>
        <Anchor id="send-policy">
          <SendPolicySection />
        </Anchor>
      </View>
    );
  }
  if (page === "shortcuts") return <KeyboardRow />;
  if (page === "pet") {
    return (
      <SettingsGroup id="pet" title={tr("settings.page.pet")} hideTitle={true}>
        <DesktopCompanionRow />
      </SettingsGroup>
    );
  }
  if (page === "profile") {
    return (
      <SettingsGroup id="profile" title={tr("settings.page.profile")} hideTitle={true}>
        <AccountRow />
      </SettingsGroup>
    );
  }
  if (page === "devices") return <AccountDevicesPage />;
  if (page === "openbitfun") return <OpenBitFunSection />;
  if (page === "activity") return <ActivityPage />;
  if (page === "archived") return <ArchivedSessionsSection />;
  if (page === "models") {
    return (
      <View style={{ gap: layout.sectionGap }}>
        <DefaultModelsSection />
        <Anchor id="models">
          <ModelSection />
        </Anchor>
        <Anchor id="subscriptions">
          <SubscriptionsSection />
        </Anchor>
        <Anchor id="pools">
          <PoolsSection />
        </Anchor>
        <FieldSection sectionId="network" />
      </View>
    );
  }
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
  if (page === "desktop-control") return <FieldSection sectionId="tools" />;
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
    </View>
  );
}

/** Save / Discard / Keep editing, when a page change would drop typed text. */
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
      if (ok) goToSettingsPage(target.pageId, target.anchor);
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
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flex: 1 }}>
          <Button
            label={tr("settings.unsaved.keepEditing")}
            variant="ghost"
            size="sm"
            accessibilityLabel="settings-unsaved-keep"
            onPress={() => pendingNavigation.set(null)}
          />
          <Button
            label={tr("settings.unsaved.discard")}
            variant="secondary"
            size="sm"
            accessibilityLabel="settings-unsaved-discard"
            onPress={() => {
              const target = pendingNavigation();
              drafts.set({});
              if (target) goToSettingsPage(target.pageId, target.anchor);
            }}
          />
          <Button
            label={tr("common.save")}
            variant="primary"
            size="sm"
            loading={saving()}
            accessibilityLabel="settings-unsaved-save"
            onPress={() => void saveAll()}
          />
        </View>
      }
    >
      <View style={{ gap: 6 }}>
        <Each of={dirtyFields()} key={spec => spec.id}>
          {spec => (
            <Text style={textStyle("caption")}>
              {`${fieldLabel(spec())}: ${draftOf(spec())}`}
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
  void loadSettingsValues();
  void loadModels();
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
  // Leaving Settings returns the compact layout to its page list.
  cleanup(() => compactPageOpen.set(false));
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
            width: SETTINGS_LIST_WIDTH,
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
                <If when={settingsCompact()}>
                  <View
                    role="button"
                    accessibilityLabel="settings-compact-back"
                    onPress={() => compactPageOpen.set(false)}
                    style={{
                      minWidth: layout.touchTarget,
                      minHeight: layout.touchTarget,
                      marginLeft: -space.md,
                      borderRadius: radii.pill,
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().panelHover }}
                    focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -2 }}
                  >
                    <Icon name="chevron-left" size={20} color={palette().accent} />
                  </View>
                </If>
                <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                  <Text role="header" testID="settings-page-title" style={textStyle("pageTitle")}>
                    {tr(page().labelKey)}
                  </Text>
                  <If when={settingsScopeOf(selectedSettingsPage()) === "preferences"}>
                    <Text accessibilityLabel="settings-synced" style={textStyle("caption", { color: palette().textMuted })}>
                      {tr("settings.synced")}
                    </Text>
                  </If>
                </View>
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
                        <SettingsPageBody pageId={id()} />
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
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={{ backgroundColor: palette().panelHover }}
      focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -2 }}
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
 * row pushes its page full width with a back control.
 */
function CompactSettingsList() {
  return (
    <View style={{ gap: layout.titleToSection }}>
      <Text role="header" style={textStyle("pageTitle")}>
        {tr("settings.title")}
      </Text>
      <SearchInput
        value={settingsSearchQuery()}
        onChange={value => settingsSearchQuery.set(value)}
        onSubmit={() => {
          const first = settingsSearchResults()[0];
          if (first) openSettingsSearchHit(first);
        }}
        placeholder={tr("settings.search.placeholder")}
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

/** One row of the left list: 30 high, 13/500, no icon; the open page is `chromeActive`. */
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
        backgroundColor: props.active ? palette().chromeActive : "transparent",
        justifyContent: "center",
        gap: space.hair,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.active ? palette().chromeActive : palette().panelHover }}
      activeStyle={{ backgroundColor: palette().chromeActive }}
      focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -1 }}
    >
      <Text
        style={{
          ...textStyle("label", { color: props.active ? palette().text : palette().textSecondary }),
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

/** A scope's header in the left list: 13/600 `textSecondary`. */
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
          ...textStyle("label", { color: palette().textSecondary }),
          fontWeight: "600",
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

/** The devices the Device scope may name: runtime devices, offline ones listed but disabled. */
function scopeDeviceOptions(): SelectDropdownOption<string>[] {
  return fleetDevices()
    .filter(device => device.hostKind !== "cloud" && !device.isClientDevice)
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
        maxWidth={SETTINGS_LIST_WIDTH - space.x4l * 2}
        value={deviceContext() || null}
        options={scopeDeviceOptions()}
        accessibilityLabel="settings-scope-chip"
        onChange={deviceId => void selectDeviceContext(deviceId)}
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

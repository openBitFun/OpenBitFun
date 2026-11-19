import { cleanup, effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import { Bar, Cell, Grid, Plot, PlotAxis } from "nsh/base/plot";
import { transport } from "../bridge";
import {
  accountStatus,
  githubUser,
  isAccountSignedIn,
  loadAccountState,
} from "../homeStore";
import {
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
} from "../modelDiscoveryStore";
import {
  catalogProviders,
  chooseCatalogModel,
  chooseCatalogProvider,
  closeModelForm,
  closeModelLimits,
  deleteModel,
  loadModels,
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
import { peerScope } from "../peerState";
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
  fieldUnit,
  loadSettingsValues,
  maxForField,
  optionLabel,
  sectionTitle,
  settingsLoaded,
  settingsNotice,
  settingsValues,
  writeAppLanguage,
  writeField,
  type FieldSpec,
  type SettingsSection,
} from "../settingsStore";
import {
  TASK_MODEL_ROWS,
  chooseTaskModel,
  ensureTaskModels,
  openTaskModelPicker,
  taskModelPicker,
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
  palette,
  radii,
  resolvedAppearanceId,
  resolvedScheme,
  selectAppearancePreset,
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
import { DropdownMenu, ModalDialog, SelectDropdown } from "../ui/overlays";
import {
  ActionButton,
  Badge,
  Button,
  ConfigRow,
  ConfigSection,
  IconButton,
  InlineBanner,
  InlineFieldSaveGroup,
  InputBox,
  KpiCell,
  PillChip,
  SearchInput,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
} from "../ui/primitives";
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

export type SettingsCategory =
  | "all"
  | "appearance"
  | "agent"
  | "models"
  | "permissions"
  | "mcp"
  | "workspace"
  | "usage";

/** Default to `"all"` so every section is immediately mounted when Settings opens. */
export const selectedCategory = signal<SettingsCategory>("all");
export const settingsSectionFilter = selectedCategory;

const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; labelKey: MessageKey }> = [
  { id: "all", labelKey: "settings.cat.all" },
  { id: "appearance", labelKey: "settings.cat.appearance" },
  { id: "agent", labelKey: "settings.cat.agent" },
  { id: "models", labelKey: "settings.cat.models" },
  { id: "permissions", labelKey: "settings.cat.permissions" },
  { id: "mcp", labelKey: "settings.cat.mcp" },
  { id: "workspace", labelKey: "settings.cat.workspace" },
  { id: "usage", labelKey: "settings.cat.usage" },
];

const SECTION_CATEGORY_MAP: Record<string, Exclude<SettingsCategory, "all">> = {
  general: "appearance",
  input: "appearance",
  "ai-experience": "agent",
  "ai-execution": "agent",
  memory: "agent",
  tools: "agent",
  "agent-hooks": "agent",
  editor: "workspace",
  terminal: "workspace",
  workspace: "workspace",
  diagnostics: "usage",
};

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
    labelKey: "settings.permissions.modeAsk",
    hintKey: "settings.permissions.modeAskHint",
    icon: "shield",
  },
  auto: {
    labelKey: "settings.permissions.modeAuto",
    hintKey: "settings.permissions.modeAutoHint",
    icon: "sparkles",
  },
  full_access: {
    labelKey: "settings.permissions.modeFull",
    hintKey: "settings.permissions.modeFullHint",
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

function sectionsFor(category: Exclude<SettingsCategory, "all">): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(section => (SECTION_CATEGORY_MAP[section.id] ?? "agent") === category);
}

function showCategory(category: Exclude<SettingsCategory, "all">): boolean {
  const current = selectedCategory();
  return current === "all" || current === category;
}

const drafts = signal<Record<string, string>>({});
/** Text being typed into the automatic-approval fields, before it is saved. */
const approvalDrafts = signal<Record<string, string>>({});
/** Tracks inline connect guidance reveal for disconnected subscriptions. */
const subscriptionConnectOpen = signal<Record<string, boolean>>({});

const PROVIDER_FORMATS = ["openai", "response", "anthropic", "gemini"] as const;
const rowMenuId = signal<string | null>(null);
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

function draftOf(spec: FieldSpec): string {
  return drafts()[spec.id] ?? "";
}

function signedInAccountDisplay(): string {
  const login = githubUser()?.login;
  if (login) return `@${login}`;
  return accountStatus()?.userId || tr("home.signedIn");
}

function storedText(spec: FieldSpec): string {
  const value = fieldDisplay(spec);
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  return fieldMissing(spec)
    ? tr("settings.field.defaultSuffix", { value: raw })
    : raw;
}

function formattedFieldPlaceholder(spec: FieldSpec): string {
  const base = fieldPlaceholder(spec);
  if (spec.kind !== "number") return base;
  const unit = fieldUnit(spec);
  if (!unit || base.toLowerCase().includes(unit.toLowerCase())) return base;
  return `${base} ${unit}`;
}

function saveDraft(spec: FieldSpec): void {
  const raw = draftOf(spec).trim();
  if (!raw) return;
  if (spec.kind === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      settingsNotice.set(tr("settings.notice.needsNumber", { label: fieldLabel(spec) }));
      return;
    }
    const min = spec.min ?? Number.NEGATIVE_INFINITY;
    const max = maxForField(spec) ?? Number.POSITIVE_INFINITY;
    void writeField(spec, Math.min(max, Math.max(min, Math.trunc(parsed))));
    drafts.update(current => ({ ...current, [spec.id]: "" }));
    return;
  }
  void writeField(spec, raw);
  drafts.update(current => ({ ...current, [spec.id]: "" }));
}

function Toggle(props: { spec: FieldSpec }) {
  const spec = props.spec;
  return (
    <ToggleSwitch
      value={fieldDisplay(spec) === true}
      accessibilityLabel={spec.id}
      onChange={next => void writeField(spec, next)}
    />
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

function Choice(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const current = () => String(fieldDisplay(spec) ?? "");
  const options = spec.options ?? [];
  return (
    <SegmentedTabs
      size="sm"
      value={current()}
      options={options.map(option => ({
        value: option.value,
        label: optionLabel(option),
        accessibilityLabel: `${spec.id}-${option.value}`,
      }))}
      onChange={value => void writeField(spec, value)}
    />
  );
}

function ModelChoice(props: { spec: FieldSpec }) {
  const spec = props.spec;
  const current = (): string => {
    const value = fieldDisplay(spec);
    return value === undefined || value === null ? "" : String(value);
  };
  const options = (): Array<{ value: string; label: string; missing?: boolean }> => {
    const rows: Array<{ value: string; label: string; missing?: boolean }> = [
      { value: "", label: fieldEmptyLabel(spec) ?? tr("settings.field.followSessionModel") },
      { value: "primary", label: tr("settings.field.primaryRole") },
      { value: "fast", label: tr("settings.field.fastRole") },
      ...storedModels()
        .filter(model => model.enabled !== false)
        .map(model => ({ value: model.id, label: model.name })),
    ];
    const selected = current();
    if (selected && !rows.some(row => row.value === selected)) {
      rows.push({
        value: selected,
        label: tr("settings.field.notConfiguredSuffix", { name: selected }),
        missing: true,
      });
    }
    return rows;
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        flexShrink: 1,
        minWidth: 0,
        justifyContent: "flex-end",
      }}
    >
      <Each of={options()} key={option => option.value || "inherit"}>
        {option => (
          <PillChip
            label={option().label}
            active={current() === option().value}
            tone={option().missing ? "warning" : undefined}
            accessibilityLabel={`${spec.id}-${option().value || "inherit"}`}
            onPress={() => (option().missing ? undefined : void writeField(spec, option().value || null))}
          />
        )}
      </Each>
    </View>
  );
}

function fieldDescription(spec: FieldSpec): string {
  const hint = fieldHint(spec) ?? "";
  if (spec.kind === "number" || spec.kind === "text") {
    const current = storedText(spec);
    if (current) {
      const currentText = tr("settings.field.currentValue", { value: current });
      return hint ? `${hint} · ${currentText}` : currentText;
    }
    if (fieldMissing(spec) && spec.defaultValue !== undefined) {
      return hint ? `${hint} · ${tr("common.default")}` : tr("settings.field.defaultSetting");
    }
    return hint ? `${hint} · ${tr("common.notSet")}` : tr("common.notConfigured");
  }
  if (hint) {
    return fieldMissing(spec) && spec.defaultValue !== undefined
      ? `${hint} · ${tr("common.default")}`
      : hint;
  }
  return fieldMissing(spec) && spec.defaultValue !== undefined
    ? tr("settings.field.defaultSetting")
    : tr("common.configured");
}

function FieldRow(props: { spec: FieldSpec; first?: boolean }) {
  const spec = props.spec;
  const isEditableInput = spec.kind === "number" || spec.kind === "text";
  const unavailable = () => fieldMissing(spec) && spec.defaultValue === undefined;
  return (
    <ConfigRow
      label={fieldLabel(spec)}
      description={fieldDescription(spec)}
      descriptionTabular={spec.kind === "number"}
      topDivider={!props.first}
      divider={false}
      controlWidth={isEditableInput ? 300 : undefined}
      controlAlign={isEditableInput ? "stretch" : "end"}
    >
      <If when={spec.kind === "boolean"}>
        <Toggle spec={spec} />
      </If>
      <If when={spec.kind === "select"}>
        <Choice spec={spec} />
      </If>
      <If when={spec.kind === "model"}>
        <ModelChoice spec={spec} />
      </If>
      <If when={isEditableInput}>
        <View style={{ position: "relative", flex: 1, minWidth: 0, width: "100%" }}>
          <View
            role="button"
            accessibilityLabel={`${spec.id}-save`}
            onPress={() => {
              if (!unavailable() && draftOf(spec).trim().length > 0) saveDraft(spec);
            }}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 68,
              height: controlHeight.sm,
              opacity: 0,
            }}
          />
          <InlineFieldSaveGroup
            value={draftOf(spec)}
            onChange={value => drafts.update(current => ({ ...current, [spec.id]: value }))}
            onSave={() => saveDraft(spec)}
            placeholder={
              unavailable()
                ? tr("common.unavailable").toLowerCase()
                : formattedFieldPlaceholder(spec)
            }
            saveLabel={tr("settings.field.saveShort")}
            buttonWidth={68}
            size="sm"
            dirty={draftOf(spec).trim().length > 0}
            disabled={unavailable()}
            readonly={unavailable()}
            inputAccessibilityLabel={spec.id}
            saveAccessibilityLabel={tr("settings.field.saveField", { label: fieldLabel(spec) })}
          />
        </View>
      </If>
    </ConfigRow>
  );
}

function LanguageRow() {
  return (
    <ConfigRow
      label={tr("settings.language.title")}
      description={tr("settings.language.hint")}
      divider={false}
    >
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
    </ConfigRow>
  );
}

function AccountRow() {
  return (
    <ConfigRow
      label={tr("settings.account.title")}
      description={
        isAccountSignedIn()
          ? tr("devices.accountSignedInAs", { account: signedInAccountDisplay() })
          : tr("settings.account.subtitle")
      }
      topDivider={true}
      divider={false}
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
    </ConfigRow>
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
    <ConfigRow
      label={tr("settings.shortcuts.title")}
      description={tr("settings.shortcuts.hint")}
      topDivider={true}
      divider={false}
    >
      <Badge
        label={
          overrides()
            ? formatPlural(
                overrides(),
                "settings.shortcuts.overridesStoredOne",
                "settings.shortcuts.overridesStoredOther",
              )
            : tr("settings.shortcuts.defaults")
        }
        tone="neutral"
      />
    </ConfigRow>
  );
}

function PermissionsSection() {
  ensurePermissions();
  const rulesModalOpen = usePresenceFlag(() => ruleDraft() !== null);
  const modeLabel = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].labelKey);
  const modeHint = (mode: PermissionMode): string => tr(PERMISSION_MODE_META[mode].hintKey);

  return (
    <If when={permissionsSupported() !== false}>
      <ConfigSection
        title={tr("settings.permissions.title")}
        bodyPadding={16}
        subtitle={
          permissionMode() === null
            ? tr("settings.permissions.reading")
            : tr("settings.permissions.subtitleActive", {
                mode: modeLabel(permissionMode()!),
                hint: modeHint(permissionMode()!),
              })
        }
        extra={
          permissionsNotice() ? (
            <Badge label={localizeHostError(permissionsNotice())} tone="accent" />
          ) : undefined
        }
      >
        <View style={{ gap: 16 }}>
          {/* 3 Visual Selectable Mode Cards */}
          <View
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <Each of={PERMISSION_MODES} key={entry => entry.value}>
              {entry => {
                const isSelected = () => permissionMode() === entry().value;
                const isFull = () => entry().value === "full_access";
                const isHighlighted = () =>
                  isSelected() || (isFull() && pendingFullAccess());
                const accentColor = () =>
                  isFull() ? palette().warning : palette().accent;
                const softBg = () =>
                  isFull() ? palette().warningSoft : palette().accentSoft;
                const activeBorder = () =>
                  isFull() ? palette().warningBorder : palette().accent;
                return (
                  <View
                    role="button"
                    accessibilityLabel={`permission-mode-${entry().value}`}
                    accessibilityState={{ selected: isSelected() }}
                    onPress={() => void choosePermissionMode(entry().value)}
                    style={{
                      gap: 8,
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                      borderRadius: radii.md,
                      borderCurve: "continuous",
                      borderWidth: isHighlighted() ? 1.5 : 1,
                      borderColor: isHighlighted()
                        ? activeBorder()
                        : palette().border,
                      backgroundColor: isHighlighted()
                        ? softBg()
                        : palette().surfaceTertiary,
                      cursor: "pointer",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{
                      borderColor: isHighlighted()
                        ? activeBorder()
                        : palette().borderStrong,
                      backgroundColor: isHighlighted()
                        ? softBg()
                        : palette().panelHover,
                    }}
                    activeStyle={tactileActiveStyle(0.985)}
                    focusVisibleStyle={{
                      outlineWidth: 2,
                      outlineColor: palette().borderFocus,
                      outlineOffset: 2,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: radii.sm,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: isHighlighted()
                            ? isFull()
                              ? palette().warningBorder
                              : palette().accentBorder
                            : palette().borderSubtle,
                          backgroundColor: isHighlighted()
                            ? palette().panelRaised
                            : palette().surfaceSubtle,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon
                          name={PERMISSION_MODE_META[entry().value].icon}
                          size={14}
                          color={
                            isHighlighted()
                              ? accentColor()
                              : palette().textSecondary
                          }
                        />
                      </View>
                      <If when={isSelected()}>
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: radii.pill,
                            backgroundColor: isFull()
                              ? palette().warning
                              : palette().actionSolid,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon
                            name="check"
                            size={11}
                            color={
                              isFull()
                                ? palette().canvas
                                : palette().actionSolidFg
                            }
                          />
                        </View>
                      </If>
                    </View>
                    <View style={{ gap: 3 }}>
                      <Text
                        style={{
                          color: isFull() && isHighlighted()
                            ? palette().warning
                            : palette().text,
                          fontSize: textSize(13.5),
                          fontWeight: "600",
                          letterSpacing: textTracking(13.5),
                          lineHeight: textLineHeight(13.5, 1.3),
                        }}
                      >
                        {modeLabel(entry().value)}
                      </Text>
                      <Text
                        style={{
                          color: palette().textMuted,
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.42),
                        }}
                      >
                        {modeHint(entry().value)}
                      </Text>
                    </View>
                  </View>
                );
              }}
            </Each>
          </View>

          <If when={pendingFullAccess()}>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 11,
                borderRadius: radii.md,
                borderCurve: "continuous",
                backgroundColor: palette().warningSoft,
                borderWidth: 1,
                borderColor: palette().warningBorder,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, flex: 1, minWidth: 220 }}>
                <View style={{ flexShrink: 0, marginTop: 2 }}>
                  <Icon name="warning" size={15} color={palette().warning} />
                </View>
                <Text
                  style={{
                    color: palette().warning,
                    fontSize: textSize(12),
                    fontWeight: "500",
                    lineHeight: textLineHeight(12, 1.44),
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {tr("settings.permissions.fullAccessWarning")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
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

          {/* Global Rules Row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingTop: 14,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                fontVariant: ["tabular-nums"],
                lineHeight: textLineHeight(12, 1.44),
                flex: 1,
                minWidth: 0,
              }}
            >
              {formatPlural(
                permissionRuleCount(),
                "settings.permissions.rulesInForceOne",
                "settings.permissions.rulesInForceOther",
              )}
            </Text>
            <Button
              label={tr("settings.permissions.editRules")}
              variant="secondary"
              size="sm"
              accessibilityLabel="edit-permission-rules"
              onPress={() => beginRulesDraft()}
            />
          </View>

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
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.38),
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
                        <InputBox
                          label={tr("settings.permissions.action")}
                          size="md"
                          monospace
                          value={rule().action}
                          placeholder={tr("settings.permissions.actionPlaceholder")}
                          accessibilityLabel={`permission-rule-${rule().localId}-action`}
                          style={{ flex: 1, minWidth: 140 }}
                          onChange={val => patchPermissionRule(rule().localId, { action: val })}
                        />
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

          <If when={permissionModeControl() !== null}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                paddingTop: 14,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13),
                    fontWeight: "500",
                    lineHeight: textLineHeight(13, 1.35),
                  }}
                >
                  {permissionModeControl() === true
                    ? tr("settings.permissions.composerSwitchOn")
                    : tr("settings.permissions.composerSwitchOff")}
                </Text>
                <Text style={textStyle("caption")}>
                  {tr("settings.permissions.composerSwitchHint")}
                </Text>
              </View>
              <ToggleSwitch
                value={permissionModeControl() === true}
                accessibilityLabel="permission-mode-control"
                onChange={next => void setPermissionModeControl(next)}
              />
            </View>
          </If>
        </View>
      </ConfigSection>
    </If>
  );
}

function ApprovalSection() {
  const kind = (): "chat" | "decision" => approvalSettings()?.modelKind ?? "chat";
  const pick = (field: string, fallback = ""): string => approvalDrafts()[field] ?? fallback;
  return (
    <View
      style={{
        gap: 10,
        paddingTop: 14,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={textStyle("cardTitle")}>{tr("settings.permissions.autoTitle")}</Text>
        <If when={approvalNotice()}>
          {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
        </If>
      </View>
      <If when={permissionMode() !== "auto"}>
        <Text style={textStyle("caption")}>
          {tr("settings.permissions.autoHint")}
        </Text>
      </If>
      <If when={permissionMode() === "auto"}>
        <View
          style={{
            gap: 14,
            padding: 14,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().surfaceTertiary,
          }}
        >
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
          <If when={kind() === "chat"}>
            <View style={{ gap: 8 }}>
              <Text style={textStyle("caption")}>
                {approvalModels().length === 0
                  ? tr("settings.permissions.noApprovalModels")
                  : tr("settings.permissions.chatApprovalHint")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Each of={approvalModels()} key={option => option.value}>
                  {option => (
                    <PillChip
                      label={`${option().label} · ${option().hint}`}
                      active={approvalSettings()?.chatModelId === option().value}
                      accessibilityLabel={`approval-model-${option().value}`}
                      onPress={() =>
                        option().disabled ? undefined : void saveApproval({ chatModelId: option().value })
                      }
                    />
                  )}
                </Each>
              </View>
            </View>
          </If>
          <If when={kind() === "decision"}>
            <View style={{ gap: 10 }}>
              <Text style={textStyle("caption")}>
                {tr("settings.permissions.decisionModelHint")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <InputBox
                  size="sm"
                  value={pick("decision-name")}
                  placeholder={
                    decisionModel()?.modelName || tr("settings.permissions.decisionModelNamePlaceholder")
                  }
                  accessibilityLabel="approval-decision-name"
                  style={{ flex: 1, minWidth: 140 }}
                  onChange={val =>
                    approvalDrafts.update(current => ({ ...current, "decision-name": val }))
                  }
                />
                <InputBox
                  size="sm"
                  monospace
                  value={pick("decision-endpoint")}
                  placeholder={
                    decisionModel()?.endpoint || tr("settings.permissions.decisionEndpointPlaceholder")
                  }
                  accessibilityLabel="approval-decision-endpoint"
                  style={{ flex: 2, minWidth: 200 }}
                  onChange={val =>
                    approvalDrafts.update(current => ({ ...current, "decision-endpoint": val }))
                  }
                />
                <Button
                  label={tr("settings.field.saveShort")}
                  variant={
                    pick("decision-name").trim().length > 0 || pick("decision-endpoint").trim().length > 0
                      ? "primary"
                      : "secondary"
                  }
                  size="sm"
                  accessibilityLabel="save-approval-decision"
                  style={{ minWidth: 68 }}
                  onPress={() =>
                    void saveDecisionModel(
                      pick("decision-name") || (decisionModel()?.modelName ?? ""),
                      pick("decision-endpoint") || (decisionModel()?.endpoint ?? ""),
                    )
                  }
                />
              </View>
              <If when={decisionCredential() !== null}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
                    style={{ flex: 1, minWidth: 180 }}
                    onChange={val =>
                      approvalDrafts.update(current => ({ ...current, "decision-secret": val }))
                    }
                  />
                  <Button
                    label={tr("settings.field.saveShort")}
                    variant={pick("decision-secret").trim().length > 0 ? "primary" : "secondary"}
                    size="sm"
                    accessibilityLabel="save-approval-decision-key"
                    style={{ minWidth: 68 }}
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
                </View>
              </If>
            </View>
          </If>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {tr("settings.permissions.timeout")}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <InputBox
                size="sm"
                value={pick("timeout")}
                placeholder={String(approvalSettings()?.timeoutSeconds ?? 30)}
                accessibilityLabel="approval-timeout"
                style={{ width: 84 }}
                onChange={val => approvalDrafts.update(current => ({ ...current, timeout: val }))}
              />
              <Text style={textStyle("caption")}>{tr("settings.permissions.seconds")}</Text>
              <Button
                label={tr("settings.field.saveShort")}
                variant={pick("timeout").trim().length > 0 ? "primary" : "secondary"}
                size="sm"
                accessibilityLabel="save-approval-timeout"
                style={{ minWidth: 68 }}
                onPress={() => {
                  const typed = pick("timeout").trim();
                  const seconds = typed
                    ? Number.parseInt(typed, 10)
                    : (approvalSettings()?.timeoutSeconds ?? 30);
                  if (!Number.isFinite(seconds)) {
                    approvalNotice.set(tr("settings.permissions.timeoutValidation"));
                    return;
                  }
                  void saveApproval({ timeoutSeconds: Math.min(300, Math.max(1, seconds)) });
                }}
              />
            </View>
          </View>
          <View
            style={{
              gap: 10,
              paddingTop: 10,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.permissions.whenUnsure")}
              </Text>
              <SegmentedTabs
                size="sm"
                value={approvalSettings()?.onAsk ?? "user"}
                options={[
                  {
                    value: "user",
                    label: tr("settings.permissions.askMe"),
                    accessibilityLabel: "approval-on-ask-user",
                  },
                  {
                    value: "reject",
                    label: tr("sessions.reject"),
                    accessibilityLabel: "approval-on-ask-reject",
                  },
                ]}
                onChange={val =>
                  void saveApproval({ onAsk: val === "reject" ? "reject" : "user" })
                }
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("settings.permissions.whenFails")}
              </Text>
              <SegmentedTabs
                size="sm"
                value={approvalSettings()?.onError ?? "ask"}
                options={[
                  {
                    value: "ask",
                    label: tr("settings.permissions.askMe"),
                    accessibilityLabel: "approval-on-error-ask",
                  },
                  {
                    value: "reject",
                    label: tr("sessions.reject"),
                    accessibilityLabel: "approval-on-error-reject",
                  },
                ]}
                onChange={val =>
                  void saveApproval({ onError: val === "reject" ? "reject" : "ask" })
                }
              />
            </View>
          </View>
        </View>
      </If>
    </View>
  );
}

function SendPolicySection() {
  ensureSendPolicy();
  const currentHint = (): string => {
    const entry = MID_TURN_KEYS[midTurnSendPolicy()];
    return entry ? tr(entry.hintKey) : tr("settings.sendPolicy.steerNowHint");
  };
  return (
    <ConfigSection
      flush={true}
      title={tr("settings.sendPolicy.title")}
      subtitle={tr("settings.sendPolicy.subtitle")}
      extra={
        sendPolicyNotice() ? (
          <Badge label={localizeHostError(sendPolicyNotice())} tone="accent" />
        ) : undefined
      }
    >
      <ConfigRow
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
      </ConfigRow>
    </ConfigSection>
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
    <ConfigRow
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
    </ConfigRow>
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
    <ConfigSection
      flush={true}
      title={tr("settings.webSearch.title")}
      subtitle={tr("settings.webSearch.subtitle")}
      extra={
        webSearchNotice() ? (
          <Badge label={localizeHostError(webSearchNotice())} tone="accent" />
        ) : undefined
      }
    >
      <View>
        <ConfigRow
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
        </ConfigRow>
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
            <ConfigRow
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
            </ConfigRow>
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
              minHeight: 52,
              flexDirection: "row",
              alignItems: "center",
              gap: 20,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13.5),
                    fontWeight: "500",
                    letterSpacing: textTracking(13.5),
                    lineHeight: textLineHeight(13.5, 1.32),
                  }}
                >
                  {tr("settings.models.apiKey")}
                </Text>
                <If when={credentialLine()}>
                  {line => <Badge label={line()} tone="neutral" />}
                </If>
              </View>
              <Text style={textStyle("caption")}>
                {tr("settings.webSearch.vaultHint")}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
                width: 300,
                maxWidth: "60%",
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
    </ConfigSection>
  );
}

function QuickActionsSection() {
  ensureQuickActions();
  const draft = () => quickActionDraft();
  const quickActionModalOpen = usePresenceFlag(() => Boolean(quickActionDraft()));
  return (
    <ConfigSection
      flush={true}
      title={tr("settings.quickActions.title")}
      subtitle={tr("settings.quickActions.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={quickActionsNotice()}>
            {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
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
                borderTopWidth: index() === 0 ? 0 : 1,
                borderColor: palette().borderSubtle,
                opacity: action().enabled ? 1 : 0.65,
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13.5),
                    fontWeight: "500",
                    letterSpacing: textTracking(13.5),
                    lineHeight: textLineHeight(13.5, 1.35),
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
    </ConfigSection>
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
    <ConfigSection
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
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceSubtle,
              }}
            >
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
                paddingVertical: 14,
                borderTopWidth: index() === 0 ? 0 : 1,
                borderColor: palette().borderSubtle,
                opacity: row().enabled ? 1 : 0.72,
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            >
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
                size={6.5}
              />
              <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13.5),
                    fontWeight: "500",
                    letterSpacing: textTracking(13.5),
                    lineHeight: textLineHeight(13.5, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${row().name} · ${row().id}`}
                </Text>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(11.5, 1.4),
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
                <Badge
                  label={row().enabled ? row().status : tr("common.disabled")}
                  tone={
                    row().status.trim().toLowerCase() === "healthy" ||
                    row().status.trim().toLowerCase() === "connected"
                      ? "success"
                      : row().status.trim().toLowerCase() === "failed"
                        ? "danger"
                        : "neutral"
                  }
                />
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
                    variant="primary"
                    size="sm"
                    accessibilityLabel={`mcp-start-${row().id}`}
                    onPress={() =>
                      canStart(row()) ? void startMcpServer(row().id) : openMcpDraft(row().id)
                    }
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
                          onSelect: () => openMcpDraft(row().id),
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
                    onSelect: () => void deleteMcpServer(row().id),
                  },
                ]}
                onClose={() => rowMenuId.set(null)}
              />
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
              paddingVertical: 18,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: radii.sm,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="plug" size={15} color={palette().textMuted} />
            </View>
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
                        fontSize: textSize(11.5),
                        fontFamily: fontMono,
                        lineHeight: textLineHeight(11.5, 1.42),
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
                    fontSize: textSize(11.5),
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
                          fontSize: textSize(11.5),
                          fontFamily: fontMono,
                          lineHeight: textLineHeight(11.5, 1.5),
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
    </ConfigSection>
  );
}

function AcpSection() {
  ensureAcp();
  void probeAcpClients();
  return (
    <If when={acpSupported() !== false}>
      <ConfigSection
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
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceSubtle,
                }}
              >
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
                paddingVertical: 18,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="bot" size={15} color={palette().textMuted} />
              </View>
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
                  paddingVertical: 14,
                  borderTopWidth: index() === 0 ? 0 : 1,
                  borderColor: palette().borderSubtle,
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              >
                <StatusDot
                  kind={
                    client().status === "running"
                      ? "success"
                      : client().status === "starting"
                        ? "accent"
                        : "muted"
                  }
                  size={6.5}
                  pulse={client().status === "starting"}
                />
                <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(13.5),
                      fontWeight: "500",
                      letterSpacing: textTracking(13.5),
                      lineHeight: textLineHeight(13.5, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${client().name} · ${client().id}`}
                  </Text>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      fontFamily: fontMono,
                      lineHeight: textLineHeight(11.5, 1.4),
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
                  <Badge
                    label={`${client().enabled ? tr("common.enabled").toLowerCase() : tr("common.disabled").toLowerCase()} · ${client().permissionMode || "ask"}`}
                    tone="neutral"
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
                      variant="primary"
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
      </ConfigSection>
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
    <ConfigSection
      title={tr("settings.usage.title")}
      bodyPadding={16}
      subtitle={tr("settings.usage.subtitle")}
      extra={
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <If when={usageNotice()}>
            {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
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
      <View style={{ gap: 16 }}>
        {/* 6-Month Activity Heatmap */}
        <View
          style={{
            gap: 10,
            padding: 14,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().surfaceTertiary,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Text style={textStyle("label", { tabular: true })}>
              {tr("settings.usage.activityHeading", {
                span: activitySpan() || tr("settings.usage.lastSixMonths"),
              })}
            </Text>
            <If when={Boolean(usageActivity())}>
              <Text
                style={{
                  color: hoveredActivityDay() ? palette().text : palette().textMuted,
                  fontSize: textSize(11.5),
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

          <If when={usageActivity()}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ width: 24, height: HEATMAP_HEIGHT, flexShrink: 0, justifyContent: "space-between" }}>
                <Each of={localizedDayAxis()} key="index">
                  {label => (
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      <Text style={{ color: palette().textMuted, fontSize: textSize(9.5) }}>
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

        <View style={{ gap: 14 }}>
          <If when={usageUnsupported()}>
            <InlineBanner tone="neutral" message={tr("settings.usage.unsupported")} />
          </If>

          <If when={usageTotals()}>
            {totals => (
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
                <View
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  }}
                >
                  <KpiCell
                    label={tr("settings.usage.total")}
                    icon="activity"
                    value={formatTokens(totals().tokens) || "0"}
                    style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                  />
                  <KpiCell
                    label={tr("settings.usage.input")}
                    borderLeft={true}
                    value={formatTokens(totals().inputTokens) || "0"}
                    style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                  />
                  <KpiCell
                    label={tr("settings.usage.output")}
                    borderLeft={true}
                    value={formatTokens(totals().outputTokens) || "0"}
                    style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                  />
                  <KpiCell
                    label={tr("settings.usage.cache")}
                    borderLeft={true}
                    value={formatTokens(totals().cachedTokens) || "0"}
                    detail={hitRate() ? tr("settings.usage.cacheHitShort", { rate: hitRate() }) : undefined}
                    style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                  />
                  <KpiCell
                    label={tr("settings.usage.requests")}
                    icon="zap"
                    borderLeft={true}
                    value={formatCount(totals().requests) || "0"}
                    style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                  />
                </View>

                {/* Quiet single-row telemetry footnote */}
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderTopWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().surfaceSubtle,
                  }}
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <Text style={textStyle("micro", { color: palette().textMuted })}>
                      {tr("settings.usage.summaryRequestsTokens", {
                        requests: formatCount(totals().requests),
                        tokens: formatTokens(totals().tokens),
                      })}
                    </Text>
                    <Text style={textStyle("micro", { color: palette().textMuted })}>
                      {tr("settings.usage.tokenBreakdown", {
                        input: formatTokens(totals().inputTokens),
                        output: formatTokens(totals().outputTokens),
                        cached: formatTokens(totals().cachedTokens),
                        cacheWrites: formatTokens(totals().cacheWriteTokens),
                      })}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <If when={hitRate()}>
                      {rate => (
                        <Text style={textStyle("micro", { color: palette().textMuted })}>
                          {tr("settings.usage.cacheHitRate", { rate: rate() })}
                        </Text>
                      )}
                    </If>
                    <If when={totals().failedRequests > 0 || totals().unknownRequests > 0}>
                      <Text style={textStyle("micro", { color: palette().warning })}>
                        {tr("settings.usage.failedUnknown", {
                          failed: totals().failedRequests,
                          unknown: totals().unknownRequests,
                        })}
                      </Text>
                    </If>
                  </View>
                </View>
              </View>
            )}
          </If>

          {/* Interactive Trend Bar Chart */}
          <If when={trendBars().length > 0}>
            <View
              style={{
                gap: 10,
                padding: 14,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <Text style={textStyle("label", { tabular: true })}>
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
                        fontSize: textSize(11.5),
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
          </If>

          {/* Model / Group Breakdown */}
          <If when={usageModels().length > 0 || usageGroups().length > 0}>
            <View style={{ gap: 10 }}>
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
                <Text style={textStyle("caption")}>
                  {tr("settings.usage.noMatchingRows")}
                </Text>
              </If>

              <View
                style={{
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: usageVisibleRows().rows.length > 0 ? 1 : 0,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                  overflow: "hidden",
                }}
              >
                <Each of={usageVisibleRows().rows} key="index">
                  {(entry, index) => (
                    <View
                      style={{
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderTopWidth: index() === 0 ? 0 : 1,
                        borderColor: palette().borderSubtle,
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text
                          style={{
                            color: palette().text,
                            fontSize: textSize(12.5),
                            fontWeight: "500",
                            lineHeight: textLineHeight(12.5, 1.38),
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
                            fontSize: textSize(11.5),
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {tr("settings.usage.rowMetrics", {
                            requests: formatCount(entry().requests),
                            tokens: formatTokens(entry().tokens),
                          })}
                        </Text>
                        <If when={entry().cacheHitRate !== null}>
                          <Badge
                            label={tr("settings.usage.cacheBadge", {
                              rate: formatPercent(entry().cacheHitRate, 0),
                            })}
                            tone="neutral"
                          />
                        </If>
                      </View>
                      <View
                        style={{
                          height: 3.5,
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
            <View style={{ gap: 6 }}>
              <Text style={textStyle("meta")}>{tr("settings.usage.byEndpoint")}</Text>
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
                <Each of={usageEndpoints()} key="index">
                  {(endpoint, index) => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        borderTopWidth: index() === 0 ? 0 : 1,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(12),
                          fontWeight: "500",
                          lineHeight: textLineHeight(12, 1.38),
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
            <View style={{ gap: 6 }}>
              <Text style={textStyle("meta")}>
                {hourly() ? tr("settings.usage.byHour") : tr("settings.usage.byDay")}
              </Text>
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
                <Each of={usageBuckets().slice(-12)} key={bucket => bucket.bucket}>
                  {(bucket, index) => (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderTopWidth: index() === 0 ? 0 : 1,
                        borderColor: palette().borderSubtle,
                      }}
                    >
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
                          fontSize: textSize(11.5),
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
      </View>
    </ConfigSection>
  );
}

function TaskModelsSection() {
  ensureTaskModels();
  const choiceOf = (task: string): TaskModelChoice => taskModels()[task] ?? { kind: "inherit", modelId: "" };
  const labelOf = (choice: TaskModelChoice): string => {
    if (choice.kind === "inherit") return tr("settings.taskModels.inheritsSession");
    const name = storedModels().find(model => model.id === choice.modelId)?.name || choice.modelId;
    return taskModelsAbsent()
      ? tr("settings.field.defaultSuffix", { value: name })
      : name;
  };
  return (
    <If when={taskModelsSupported() !== false}>
      <ConfigSection
        flush={true}
        title={tr("settings.taskModels.title")}
        subtitle={tr("settings.taskModels.subtitle")}
        extra={
          taskModelsNotice() ? (
            <Badge label={localizeHostError(taskModelsNotice())} tone="accent" />
          ) : undefined
        }
      >
        <View>
          <If when={taskModelsSupported() === null}>
            <View style={{ padding: 16 }}>
              <Text style={textStyle("caption")}>{tr("settings.taskModels.reading")}</Text>
            </View>
          </If>
          <Each of={TASK_MODEL_ROWS} key={row => row.id}>
            {(row, index) => (
              <View
                style={{
                  gap: 10,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderTopWidth: index() === 0 ? 0 : 1,
                  borderColor: palette().borderSubtle,
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text
                      style={{
                        color: palette().text,
                        fontSize: textSize(13.5),
                        fontWeight: "500",
                        letterSpacing: textTracking(13.5),
                        lineHeight: textLineHeight(13.5, 1.35),
                      }}
                    >
                      {TASK_MODEL_KEYS[row().id] ? tr(TASK_MODEL_KEYS[row().id]) : row().label}
                    </Text>
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.42),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {labelOf(choiceOf(row().id))}
                    </Text>
                  </View>
                  <Button
                    label={
                      taskModelPicker() === row().id
                        ? tr("common.close")
                        : tr("settings.taskModels.change")
                    }
                    variant="secondary"
                    size="sm"
                    accessibilityLabel={`task-model-${row().id}`}
                    onPress={() => openTaskModelPicker(row().id)}
                  />
                </View>
                <If when={taskModelPicker() === row().id}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
                    <PillChip
                      label={tr("common.inherit")}
                      active={choiceOf(row().id).kind === "inherit"}
                      accessibilityLabel={`task-model-inherit-${row().id}`}
                      onPress={() => void chooseTaskModel(row().id, { kind: "inherit", modelId: "" })}
                    />
                    <Each of={storedModels()} key={model => model.id}>
                      {model => (
                        <PillChip
                          label={model().name || model().id}
                          active={
                            choiceOf(row().id).kind === "fixed" && choiceOf(row().id).modelId === model().id
                          }
                          accessibilityLabel={`task-model-choice-${row().id}-${model().id}`}
                          onPress={() =>
                            void chooseTaskModel(row().id, { kind: "fixed", modelId: model().id })
                          }
                        />
                      )}
                    </Each>
                    <If when={storedModels().length === 0}>
                      <Text style={textStyle("meta")}>{tr("settings.taskModels.noModels")}</Text>
                    </If>
                  </View>
                </If>
              </View>
            )}
          </Each>
        </View>
      </ConfigSection>
    </If>
  );
}

function Section(props: { section: SettingsSection }) {
  const isGeneral = props.section.id === "general";
  return (
    <ConfigSection flush={true} title={sectionTitle(props.section)}>
      <View>
        <If when={isGeneral}>
          <LanguageRow />
        </If>
        <If when={isGeneral}>
          <AccountRow />
        </If>
        <If when={isGeneral}>
          <KeyboardRow />
        </If>
        <Each of={props.section.fields} key={field => field.id}>
          {(field, index) => (
            <FieldRow
              spec={field()}
              first={!isGeneral && index() === 0}
            />
          )}
        </Each>
      </View>
    </ConfigSection>
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
        paddingVertical: 14,
        borderTopWidth: props.index === 0 ? 0 : 1,
        borderColor: palette().borderSubtle,
        opacity: disabled() ? 0.62 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <StatusDot kind={disabled() ? "muted" : "success"} size={6.5} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, minWidth: 0 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(13.5),
                fontWeight: "600",
                letterSpacing: textTracking(13.5),
                lineHeight: textLineHeight(13.5, 1.34),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {model.name}
            </Text>
            <Badge label={model.provider} tone="neutral" />
            <If when={outcome().status === "testing"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Spinner size={11} color={palette().accent} />
                <Text style={textStyle("micro")}>{tr("common.testing")}</Text>
              </View>
            </If>
            <If when={outcome().status === "success"}>
              <Badge label={outcome().message || tr("common.connected")} tone="success" />
            </If>
            <If when={outcome().status === "error"}>
              <Badge label={tr("common.failed")} tone="danger" />
            </If>
          </View>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(11.5),
              fontFamily: fontMono,
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(11.5, 1.4),
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
                void deleteModel(model.id);
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
  ensureRuntimeLogging();
  return (
    <ConfigSection
      title={tr("settings.logs.title")}
      bodyPadding={16}
      subtitle={tr("settings.logs.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <If when={loggingNotice()}>
            {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
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
      <View style={{ gap: 12 }}>
        <If when={runtimeLogging()}>
          {info => (
            <View style={{ gap: 12 }}>
              <Text style={textStyle("label")}>
                {tr("settings.logs.effectiveLevel", {
                  level: info().effectiveLevel || tr("common.unknown").toLowerCase(),
                })}
              </Text>
              <View
                style={{
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text
                  style={{
                    minWidth: 0,
                    color: palette().textSecondary,
                    fontSize: textSize(11.5),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(11.5, 1.45),
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
                  <InlineBanner
                    tone="warning"
                    message={tr("settings.logs.previousCrash", {
                      category: crash().category || tr("common.unknown").toLowerCase(),
                      dir: crash().sessionLogDir || tr("settings.logs.thatFolder"),
                    })}
                  />
                )}
              </If>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
                  onPress={() => void exportDiagnosticsBundle()}
                />
              </View>
            </View>
          )}
        </If>
        <If when={!runtimeLogging()}>
          <Text style={textStyle("caption")}>{tr("settings.logs.noLocation")}</Text>
        </If>
      </View>
    </ConfigSection>
  );
}

function ExternalImportSection() {
  return (
    <ConfigSection title={tr("settings.externalImports.title")} bodyPadding={16}>
      <Text style={textStyle("caption")}>
        {transport() === "tauri"
          ? tr("settings.externalImports.descriptionDesktop")
          : tr("settings.externalImports.description")}
      </Text>
    </ConfigSection>
  );
}

function quotaRemainingPercent(
  win?: { used_percent?: number; remaining_percent?: number } | null,
): number | null {
  if (!win) return null;
  if (typeof win.remaining_percent === "number" && Number.isFinite(win.remaining_percent)) {
    return Math.max(0, Math.min(100, Math.round(win.remaining_percent)));
  }
  if (typeof win.used_percent === "number" && Number.isFinite(win.used_percent)) {
    return Math.max(0, Math.min(100, Math.round(100 - win.used_percent)));
  }
  return null;
}

function quotaBarColor(percent: number): string {
  if (percent < 15) return palette().danger;
  if (percent < 40) return palette().warning;
  return palette().accent;
}

function SubscriptionsSection() {
  void loadSubscriptions();
  const formatQuotaWindow = (
    fallbackKey: MessageKey,
    win?: { label?: string; used_percent?: number; remaining_percent?: number; reset_at?: string | number } | null,
  ): string => {
    if (!win) return "";
    const windowTitle =
      currentLocale() === "en-US" && win.label?.trim()
        ? win.label.trim()
        : localizeQuotaWindowLabel(win.label, fallbackKey);
    const parts: string[] = [windowTitle];
    if (typeof win.remaining_percent === "number") {
      parts.push(
        tr("settings.subscriptions.percentLeft", { percent: Math.round(win.remaining_percent) }),
      );
    } else if (typeof win.used_percent === "number") {
      parts.push(
        tr("settings.subscriptions.percentUsed", { percent: Math.round(win.used_percent) }),
      );
    }
    if (win.reset_at !== undefined && win.reset_at !== null && String(win.reset_at).trim()) {
      parts.push(formatResetAt(win.reset_at));
    }
    return parts.join(" · ");
  };

  return (
    <If when={subscriptionAccounts().length > 0}>
      <ConfigSection
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
          <Each of={subscriptionAccounts()} key={item => item.provider}>
            {(item, index) => {
              const quota = () => subscriptionQuotas()[item().provider] ?? null;
              const connectExpanded = () =>
                Boolean(subscriptionConnectOpen()[item().provider]);
              return (
                <View
                  style={{
                    gap: 10,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: index() === 0 ? 0 : 1,
                    borderColor: palette().borderSubtle,
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <StatusDot
                      kind={
                        item().reauthentication_required
                          ? "warning"
                          : item().connected
                            ? "success"
                            : "muted"
                      }
                      size={6.5}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(13.5),
                          fontWeight: "600",
                          letterSpacing: textTracking(13.5),
                          lineHeight: textLineHeight(13.5, 1.34),
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
                            fontSize: textSize(11.5),
                            lineHeight: textLineHeight(11.5, 1.4),
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
                      <Badge label={tr("settings.subscriptions.reauthNeeded")} tone="warning" />
                    </If>
                    <If when={!item().connected && !item().reauthentication_required}>
                      <Button
                        label={tr("common.connect")}
                        variant="ghost"
                        size="sm"
                        accessibilityLabel={`subscription-connect-${item().provider}`}
                        onPress={() =>
                          subscriptionConnectOpen.update(current => ({
                            ...current,
                            [item().provider]: !current[item().provider],
                          }))
                        }
                      />
                    </If>
                  </View>

                  <If when={!item().connected && connectExpanded()}>
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
                      <Text style={textStyle("caption")}>
                        {tr("settings.subscriptions.connectHint")}
                      </Text>
                    </View>
                  </If>

                  <If when={quota()?.primary_window || quota()?.secondary_window}>
                    <View style={{ gap: 10, paddingTop: 2 }}>
                      <If when={quota()?.primary_window}>
                        {win => (
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
                              {formatQuotaWindow("settings.subscriptions.primaryWindow", win())}
                            </Text>
                            <If when={quotaRemainingPercent(win()) !== null}>
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
                                    width: `${quotaRemainingPercent(win()) ?? 0}%`,
                                    borderRadius: radii.pill,
                                    backgroundColor: quotaBarColor(quotaRemainingPercent(win()) ?? 0),
                                  }}
                                />
                              </View>
                            </If>
                          </View>
                        )}
                      </If>
                      <If when={quota()?.secondary_window}>
                        {win => (
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
                              {formatQuotaWindow("settings.subscriptions.secondaryWindow", win())}
                            </Text>
                            <If when={quotaRemainingPercent(win()) !== null}>
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
                                    width: `${quotaRemainingPercent(win()) ?? 0}%`,
                                    borderRadius: radii.pill,
                                    backgroundColor: quotaBarColor(quotaRemainingPercent(win()) ?? 0),
                                  }}
                                />
                              </View>
                            </If>
                          </View>
                        )}
                      </If>
                    </View>
                  </If>
                </View>
              );
            }}
          </Each>
        </View>
      </ConfigSection>
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
    <ConfigSection
      flush={true}
      title={tr("settings.models.title")}
      subtitle={tr("settings.models.subtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={modelSettingsNotice()}>
            {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
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
            <View
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: radii.sm,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="cpu" size={15} color={palette().textMuted} />
            </View>
            <Text style={textStyle("caption")}>{tr("settings.models.empty")}</Text>
          </View>
        </If>
        <Each of={storedModels()} key={model => model.id}>
          {(model, index) => <ModelRow model={model()} index={index()} />}
        </Each>

        {/* Add Model Modal */}
        <ModalDialog
          open={modelFormOpen()}
          title={tr("settings.models.addModalTitle")}
          subtitle={tr("settings.models.addModalSubtitle")}
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
                  label={tr("settings.models.addModel")}
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
            <If when={peerScope() === null && modelCatalogLoaded() && modelCatalog().length > 0}>
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
                      fontSize: textSize(11.5),
                      fontFamily: fontMono,
                      lineHeight: textLineHeight(11.5, 1.42),
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
                              fontSize: textSize(12.5),
                              fontWeight: "600",
                              lineHeight: textLineHeight(12.5, 1.35),
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
    </ConfigSection>
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
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
                  borderColor: active() ? palette().accent : palette().border,
                  backgroundColor: active() ? palette().accentSoft : palette().surfaceTertiary,
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

                  {/* Crisp Accent Checkmark Badge on Active Preset */}
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
                        boxShadow: palette().shadowButton,
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
                      fontSize: textSize(11.5),
                      fontWeight: active() ? "600" : "500",
                      lineHeight: textLineHeight(11.5, 1.32),
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
    <ConfigSection
      flush={true}
      title={tr("settings.appearance.title")}
      subtitle={tr("settings.appearance.subtitle")}
    >
      <View>
        <AppearanceSwatchGallery />
        <ConfigRow
          label={tr("settings.appearance.colorScheme")}
          description={
            resolvedScheme() === "light"
              ? tr("settings.appearance.showingLight")
              : tr("settings.appearance.showingDark")
          }
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
        </ConfigRow>
        <FontSizeRows />
        <ContentWidthRow />
      </View>
    </ConfigSection>
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
        boxShadow: palette().shadowInset,
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
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 200, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(13.5),
                fontWeight: "500",
                letterSpacing: textTracking(13.5),
                lineHeight: textLineHeight(13.5, 1.35),
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
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <View style={{ flex: 1, minWidth: 200, gap: 3 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13.5),
              fontWeight: "500",
              letterSpacing: textTracking(13.5),
              lineHeight: textLineHeight(13.5, 1.35),
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Each of={FONT_LEVELS} key={entry => entry.level}>
          {entry => (
            <PillChip
              label={`${tr(FONT_LEVEL_KEYS[entry().level])} ${entry().px}`}
              active={fontLevel() === entry().level}
              accessibilityLabel={`font-level-${entry().level}`}
              onPress={() => void chooseFontLevel(entry().level)}
            />
          )}
        </Each>
        <PillChip
          label={`${tr("settings.appearance.fontCustom")}${fontLevel() === "custom" ? ` ${fontPx()}` : ""}`}
          active={fontLevel() === "custom"}
          accessibilityLabel="font-level-custom"
          onPress={() => void chooseFontLevel("custom")}
        />
      </View>
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
      <ConfigSection
        flush={true}
        title={tr("settings.pools.title")}
        subtitle={tr("settings.pools.subtitle")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <If when={poolsNotice()}>
              {notice => <Badge label={localizeHostError(notice())} tone="accent" />}
            </If>
            <Button
              label={tr("settings.pools.addPool")}
              leadingIcon="plus"
              variant="primary"
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
                gap: 13,
                paddingHorizontal: 16,
                paddingVertical: 18,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="layers" size={16} color={palette().textMuted} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13),
                    fontWeight: "500",
                    lineHeight: textLineHeight(13, 1.35),
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
      </ConfigSection>
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
        paddingVertical: 14,
        borderTopWidth: props.first ? 0 : 1,
        borderColor: palette().borderSubtle,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13.5),
            fontWeight: "600",
            letterSpacing: textTracking(13.5),
            lineHeight: textLineHeight(13.5, 1.35),
            flex: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {pool.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <Badge
            label={tr("settings.pools.membersSummary", {
              strategy: strategyLabel(),
              count: pool.memberModelIds.length,
            })}
          />
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
          <Each of={statusesOf()} key={entry => entry.modelId}>
            {entry => (
              <Badge
                label={`${entry().modelId}: ${entry().status}${entry().reason ? ` (${entry().reason})` : ""}`}
                tone={poolMemberTone(entry().status)}
              />
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
                    borderTopWidth: index() === 0 ? 0 : 1,
                    borderColor: palette().borderSubtle,
                  }}
                >
                  <Badge label={`#${index() + 1}`} tone="neutral" />
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(11.5),
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

let lastSettingsLocale: AppLocale | null = null;

export function SettingsScene() {
  void loadAccountState();
  void loadSettingsValues();
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
  const activeCategoryLabel = (): string => {
    const match = SETTINGS_CATEGORIES.find(cat => cat.id === selectedCategory());
    return match ? tr(match.labelKey) : tr("settings.title");
  };
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}>
      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ alignItems: "center" }}>
        <View
          style={{
            width: "100%",
            maxWidth: 820,
            paddingHorizontal: 28,
            paddingTop: 24,
            paddingBottom: 64,
            gap: 28,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={textStyle("pageTitle")}>{tr("settings.title")}</Text>
              <Text style={textStyle("caption")}>
                {selectedCategory() === "all"
                  ? tr("settings.subtitleAll")
                  : activeCategoryLabel()}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
              <If when={selectedCategory() !== "all"}>
                <Button
                  label={tr("common.showAll")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="settings-show-all"
                  onPress={() => selectedCategory.set("all")}
                />
              </If>
              <If
                when={
                  settingsNotice() && settingsNoticeTone(settingsNotice()) === "success"
                    ? settingsNotice()
                    : ""
                }
              >
                {notice => (
                  <View
                    role="button"
                    accessibilityLabel="settings-notice-dismiss"
                    onPress={() => settingsNotice.set("")}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radii.pill,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().successBorder,
                      backgroundColor: palette().successSoft,
                      cursor: "pointer",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                  >
                    <Text
                      style={{
                        color: palette().success,
                        fontSize: textSize(11),
                        fontWeight: "500",
                        lineHeight: textLineHeight(11, 1.24),
                        numberOfLines: 1,
                      }}
                    >
                      {localizeHostError(notice())}
                    </Text>
                    <Icon name="close" size={11} color={palette().success} />
                  </View>
                )}
              </If>
              <IconButton
                icon="refresh"
                size="sm"
                tooltip={tr("settings.reloadTooltip")}
                accessibilityLabel="settings-reload"
                onPress={() => {
                  void loadAccountState();
                  void loadSettingsValues();
                }}
              />
            </View>
          </View>
          <If
            when={
              settingsNotice() && settingsNoticeTone(settingsNotice()) !== "success"
                ? settingsNotice()
                : ""
            }
          >
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
            <View style={{ gap: 28 }}>
              <If when={showCategory("appearance")}>
                <View style={{ gap: 28 }}>
                  <AppearanceSection />
                  <Each of={sectionsFor("appearance")} key={section => section.id}>
                    {section => <Section section={section()} />}
                  </Each>
                </View>
              </If>
              <If when={showCategory("models")}>
                <View style={{ gap: 28 }}>
                  <SubscriptionsSection />
                  <ModelSection />
                  <PoolsSection />
                  <TaskModelsSection />
                </View>
              </If>
              <If when={showCategory("permissions")}>
                <View style={{ gap: 28 }}>
                  <PermissionsSection />
                  <SendPolicySection />
                </View>
              </If>
              <If when={showCategory("mcp")}>
                <View style={{ gap: 28 }}>
                  <WebSearchSection />
                  <McpSection />
                </View>
              </If>
              <If when={showCategory("agent")}>
                <View style={{ gap: 28 }}>
                  <QuickActionsSection />
                  <AcpSection />
                  <ExternalImportSection />
                  <Each of={sectionsFor("agent")} key={section => section.id}>
                    {section => <Section section={section()} />}
                  </Each>
                </View>
              </If>
              <If when={showCategory("workspace")}>
                <View style={{ gap: 28 }}>
                  <Each of={sectionsFor("workspace")} key={section => section.id}>
                    {section => <Section section={section()} />}
                  </Each>
                </View>
              </If>
              <If when={showCategory("usage")}>
                <View style={{ gap: 28 }}>
                  <UsageSection />
                  <Each of={sectionsFor("usage")} key={section => section.id}>
                    {section => <Section section={section()} />}
                  </Each>
                  <LogFilesSection />
                </View>
              </If>
            </View>
          </If>
        </View>
      </Scroll>
    </View>
  );
}

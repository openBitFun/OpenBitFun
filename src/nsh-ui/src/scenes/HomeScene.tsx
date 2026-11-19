import { computed, effect, Scroll, signal, Text, untracked, View, type JSX } from "nsh";
import { Input, TextView } from "nsh/base";
import { Cell, Plot } from "nsh/base/plot";
import { formatCount, formatPlural, formatTokens, weekdayShortLabels } from "../format";
import {
  activeInsightsReport,
  activeTurnEntries,
  agentsCount,
  agentsPulseNote,
  assistantsCount,
  assistantsPulseNote,
  authError,
  authLoading,
  authNotice,
  cancelInsights,
  closeInsightsModal,
  dueSoonRoutines,
  generateInsightsReport,
  githubAuthFlow,
  githubUser,
  homePulseLoading,
  homeQuickBusy,
  homeQuickPrompt,
  homeSshList,
  insightsError,
  insightsGenerating,
  insightsLoading,
  insightsMetas,
  insightsModalOpen,
  insightsNotice,
  insightsProgress,
  installedSpaces,
  isAccountSignedIn,
  jumpToSessions,
  loadEcosystemPulse,
  loadLatestInsights,
  modesCount,
  openInsightsReport,
  overviewUsageMetrics,
  pendingPermissionCount,
  refreshHomeAll,
  routinesCount,
  routinesEnabledCount,
  routinesPulseNote,
  selectedInsightsPath,
  signOutAccount,
  skillsCount,
  skillsEnabledCount,
  skillsPulseNote,
  spacesCount,
  spacesPulseNote,
  spacesRunningCount,
  subagentsCount,
  submitHomeQuickPrompt,
  syncHomeScope,
  usageActivityGrid,
  usageActivityNote,
  usageActivityStatus,
  usagePulseNote,
  usageSummary,
} from "../homeStore";
import { isAuthRequiredError, localizeHostError, tr, type MessageKey } from "../i18n";
import { peerScope } from "../peerState";
import { pendingPermissions } from "../permissionStore";
import {
  activeRemoteWorkspaceForCurrent,
  connectionStatuses,
  openNewWorkspaceModal,
  openSshConnectionModal,
  quickConnectSavedConnection,
} from "../sshRemoteStore";
import {
  activeWorkspace,
  activeWorkspaceId,
  activeWorkspaceRoot,
  navigateScene,
  type SceneId,
} from "../state";
import {
  controlHeight,
  fontMono,
  isLightAppearance,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { accountAuthModalOpen, openAccountAuthModal } from "../ui/AccountAuthModal";
import { BotCharacter, Icon, type IconName } from "../ui/icons";
import {
  STATIC_MARKDOWN_OPTIONS,
  createMarkdownCodeActions,
  createMarkdownStyles,
} from "../ui/markdown";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "../ui/motion";
import { ModalDialog, SelectDropdown, type SelectDropdownOption } from "../ui/overlays";
import {
  Badge,
  Button,
  ConfigSection,
  IconButton,
  InlineBanner,
  KpiCell,
  PillChip,
  SkeletonBlock,
  StatusDot,
} from "../ui/primitives";

const QUICK_STARTERS: ReadonlyArray<{
  id: string;
  labelKey: MessageKey;
  shortLabelKey: MessageKey;
  descKey: MessageKey;
  promptKey: MessageKey;
  icon: IconName;
}> = [
  {
    id: "changes",
    labelKey: "home.starterChangesTitle",
    shortLabelKey: "home.starterChangesShort",
    descKey: "home.starterChangesDesc",
    promptKey: "home.starterChangesPrompt",
    icon: "history",
  },
  {
    id: "review",
    labelKey: "home.starterGitTitle",
    shortLabelKey: "home.starterGitShort",
    descKey: "home.starterGitDesc",
    promptKey: "home.starterGitPrompt",
    icon: "git",
  },
  {
    id: "plan",
    labelKey: "home.starterMilestoneTitle",
    shortLabelKey: "home.starterMilestoneShort",
    descKey: "home.starterMilestoneDesc",
    promptKey: "home.starterMilestonePrompt",
    icon: "compass",
  },
];

function starterOptions(): ReadonlyArray<SelectDropdownOption<string>> {
  return QUICK_STARTERS.map(item => ({
    value: item.id,
    label: tr(item.labelKey),
    description: tr(item.descKey),
    icon: "sparkles",
    accessibilityLabel: `home-starter-${item.id}`,
  }));
}

const DAY_ROWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const selectedStarter = signal<string | null>(null);
const hoveredActivityIdx = signal<number | null>(null);

const HEATMAP_HEIGHT = 136;
const HEATMAP_PADDING_INNER = 0.22;
const HEATMAP_WEEKDAY_COL_WIDTH = 30;
const HEATMAP_WEEKDAY_GAP = 8;

function withColorAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hex6) {
    const hex = hex6[1];
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (hex3) {
    const hex = hex3[1];
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(trimmed);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  return trimmed;
}

/**
 * Unified 5-step heatmap color ramp shared 1:1 between the `<Plot><Cell />`
 * colorScale and the footer legend swatches across all 9 appearance presets.
 * Level 0 uses foundation `heatmapZero` for reliable contrast across Dark, Light,
 * Monochrome, and Slate themes.
 */
function heatmapStepColors(): string[] {
  const p = palette();
  const stops = isLightAppearance() ? [0.22, 0.46, 0.72, 1] : [0.3, 0.54, 0.78, 1];
  return [
    p.heatmapZero,
    withColorAlpha(p.accent, stops[0]),
    withColorAlpha(p.accent, stops[1]),
    withColorAlpha(p.accent, stops[2]),
    p.accent,
  ];
}

interface HomeHeatmapDatum {
  weekKey: string;
  dow: string;
  levelKey: string;
  dateKey: string;
  tokens: number;
}

interface HomeHeatmapPlotModel {
  weekCount: number;
  plotWidth: number;
  activeDays: number;
  weeks: string[];
  rows: HomeHeatmapDatum[];
}

const homeHeatmapPlotData = computed<HomeHeatmapPlotModel>(() => {
  const grid = usageActivityGrid();
  const weekCount = Math.max(1, grid.weekCount);
  const weeks = Array.from({ length: weekCount }, (_, idx) => `w${idx}`);
  const rows: HomeHeatmapDatum[] = [];
  let activeDays = 0;
  grid.days.forEach((day, idx) => {
    if (!day.inRange) return;
    if (day.tokens > 0) activeDays += 1;
    const col = Math.floor(idx / 7);
    const row = idx % 7;
    rows.push({
      weekKey: `w${col}`,
      dow: DAY_ROWS[row] ?? "Mon",
      levelKey: String(day.level),
      dateKey: day.key,
      tokens: day.tokens,
    });
  });
  // Exact 1:1 square cell geometry: bandwidthX === bandwidthY for d3 band scales (paddingOuter: 0).
  const plotWidth = Math.max(
    180,
    Math.round(
      (HEATMAP_HEIGHT * (weekCount - HEATMAP_PADDING_INNER)) / (7 - HEATMAP_PADDING_INNER),
    ),
  );
  return { weekCount, plotWidth, activeDays, weeks, rows };
});

function SectionHeader(props: {
  title: string;
  subtitle?: string;
  right?: JSX.Element;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        paddingHorizontal: 2,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(15),
            fontWeight: "600",
            letterSpacing: textTracking(15),
            lineHeight: textLineHeight(15, 1.28),
          }}
        >
          {props.title}
        </Text>
        <If when={props.subtitle ?? ""}>
          {sub => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.42),
              }}
            >
              {sub()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.right)}>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6, flexWrap: "wrap" }}>
          {props.right}
        </View>
      </If>
    </View>
  );
}

function SplitPairCard(props: { children?: JSX.Element }) {
  return (
    <View
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 1,
        borderRadius: radii.xl,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().borderSubtle,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        overflow: "hidden",
      }}
    >
      {props.children}
    </View>
  );
}

function SplitStatHalf(props: {
  title: string;
  icon: IconName;
  valueText: string;
  valueMuted?: boolean;
  subtitle: string;
  targetScene: SceneId;
  accessibilityLabel: string;
  extra?: JSX.Element;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => navigateScene(props.targetScene)}
      style={{
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 6,
        backgroundColor: palette().panelRaised,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
      }}
      activeStyle={{
        backgroundColor: palette().panelHover,
        opacity: 0.92,
      }}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().borderFocus,
        outlineOffset: -2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
          <Icon name={props.icon} size={14} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              fontWeight: "600",
              lineHeight: textLineHeight(13, 1.32),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title}
          </Text>
        </View>
        <Icon name="chevron-right" size={14} color={palette().textMuted} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap", paddingTop: 2 }}>
        <Text
          style={{
            color: props.valueMuted ? palette().textMuted : palette().text,
            fontSize: textSize(props.valueMuted ? 16 : 22),
            fontWeight: props.valueMuted ? "500" : "600",
            letterSpacing: props.valueMuted ? 0 : textTracking(22),
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(props.valueMuted ? 16 : 22, 1.18),
          }}
        >
          {props.valueText}
        </Text>
        <Text
          style={{
            flex: 1,
            minWidth: 110,
            color: palette().textMuted,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.4),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.subtitle}
        </Text>
      </View>
      <If when={Boolean(props.extra)}>
        <View style={{ paddingTop: 4 }}>{props.extra}</View>
      </If>
    </View>
  );
}

function EcosystemCard(props: {
  title: string;
  icon: IconName;
  valueText: string;
  valueMuted?: boolean;
  subtitle: string;
  targetScene: SceneId;
  accessibilityLabel: string;
  extra?: JSX.Element;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => navigateScene(props.targetScene)}
      style={{
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 8,
        borderRadius: radii.xl,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().panelRaised,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: palette().borderStrong,
      }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().borderFocus,
        outlineOffset: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
          <Icon name={props.icon} size={14} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(13.5),
              fontWeight: "600",
              lineHeight: textLineHeight(13.5, 1.32),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title}
          </Text>
        </View>
        <Icon name="chevron-right" size={14} color={palette().textMuted} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <Text
          style={{
            color: props.valueMuted ? palette().textMuted : palette().text,
            fontSize: textSize(props.valueMuted ? 16 : 22),
            fontWeight: props.valueMuted ? "500" : "600",
            letterSpacing: props.valueMuted ? 0 : textTracking(22),
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(props.valueMuted ? 16 : 22, 1.18),
          }}
        >
          {props.valueText}
        </Text>
        <Text
          style={{
            flex: 1,
            minWidth: 100,
            color: palette().textMuted,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.42),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.subtitle}
        </Text>
      </View>
      <If when={Boolean(props.extra)}>
        <View style={{ paddingTop: 2 }}>{props.extra}</View>
      </If>
    </View>
  );
}

function IdentityHeader() {
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(11),
              fontWeight: "600",
              letterSpacing: textTracking(11, true),
              lineHeight: textLineHeight(11, 1.3),
            }}
          >
            {tr("home.eyebrow")}
          </Text>
          <If when={Boolean(peerScope())}>
            <Badge label={tr("common.controllerLocal")} tone="neutral" />
          </If>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            flexShrink: 0,
            gap: 8,
          }}
        >
          <If when={isAccountSignedIn()}>
            <View
              style={{
                height: controlHeight.sm,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingLeft: 4,
                paddingRight: 3,
                borderRadius: radii.pill,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().panelRaised,
                maxWidth: 260,
              }}
            >
              <View
                role="button"
                accessibilityLabel="home-account-profile"
                onPress={() => openAccountAuthModal()}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 6,
                  height: 22,
                  borderRadius: radii.pill,
                  borderCurve: "continuous",
                  minWidth: 0,
                  flexShrink: 1,
                  cursor: "pointer",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                activeStyle={{ opacity: 0.88 }}
                focusVisibleStyle={{
                  outlineWidth: 2,
                  outlineColor: palette().borderFocus,
                  outlineOffset: 1,
                }}
              >
                <StatusDot kind="success" size={6} />
                <Text
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    color: palette().text,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.25),
                    fontWeight: "600",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {githubUser()?.login ? `@${githubUser()!.login}` : tr("home.signedIn")}
                </Text>
              </View>
              <Button
                label={authLoading() ? tr("home.signingOut") : tr("home.githubSignOut")}
                variant="ghost"
                size="xs"
                pill={true}
                disabled={authLoading()}
                accessibilityLabel="home-github-sign-out"
                onPress={() => void signOutAccount()}
              />
            </View>
          </If>
          <If when={!isAccountSignedIn()}>
            <Button
              label={authLoading() ? tr("home.starting") : tr("home.githubSignIn")}
              variant="secondary"
              size="sm"
              pill={true}
              leadingIcon="log-in"
              disabled={authLoading()}
              accessibilityLabel="home-github-sign-in"
              onPress={() => openAccountAuthModal({ autoStart: true })}
            />
          </If>
          <IconButton
            icon="refresh"
            size="sm"
            disabled={homePulseLoading()}
            tooltip={tr("home.refreshTooltip")}
            accessibilityLabel="home-refresh"
            onPress={() => void refreshHomeAll()}
          />
        </View>
      </View>

      <If when={peerScope()}>
        {scope => (
          <InlineBanner
            tone="info"
            icon="laptop"
            message={tr("home.peerBanner", { label: scope().label })}
          />
        )}
      </If>

      <View
        style={{
          alignItems: "center",
          gap: 12,
          paddingTop: 8,
          paddingBottom: 6,
        }}
      >
        <BotCharacter
          variant="grok"
          size={66}
          ringColor={palette().canvas}
        />
        <View style={{ alignItems: "center", gap: 4, maxWidth: "100%" }}>
          <Text
            style={{
              maxWidth: "100%",
              color: palette().text,
              fontSize: textSize(26),
              fontWeight: "700",
              letterSpacing: Number((-textSize(26) * 0.025).toFixed(2)),
              lineHeight: textLineHeight(26, 1.16),
              textAlign: "center",
              numberOfLines: 2,
              textOverflow: "ellipsis",
            }}
          >
            {githubUser()?.login
              ? tr("home.welcomeBackUser", { user: githubUser()!.login })
              : tr("home.welcomeBack")}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.42),
              textAlign: "center",
            }}
          >
            {tr("home.title")}
          </Text>
        </View>
      </View>

      <If when={!accountAuthModalOpen() && !githubAuthFlow() && authNotice() ? authNotice() : ""}>
        {notice => (
          <InlineBanner
            tone="success"
            message={localizeHostError(notice())}
            onDismiss={() => authNotice.set("")}
          />
        )}
      </If>
      <If when={!accountAuthModalOpen() && !githubAuthFlow() && authError() ? authError() : ""}>
        {err => (
          <InlineBanner
            tone="danger"
            message={localizeHostError(err())}
            actionLabel={isAuthRequiredError(err()) ? tr("devices.signInCta") : undefined}
            onAction={
              isAuthRequiredError(err())
                ? () => openAccountAuthModal({ autoStart: true })
                : undefined
            }
            onDismiss={() => authError.set("")}
          />
        )}
      </If>
    </View>
  );
}

function QuickPromptLaunchpad() {
  return (
    <View style={{ gap: 11, alignItems: "center" }}>
      <View
        style={{
          width: "100%",
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surfaceElevated,
          boxShadow: `${palette().shadowComposer}, ${palette().innerHighlight}`,
          paddingHorizontal: 14,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ borderColor: palette().borderStrong }}
        focusWithinStyle={{
          borderColor: palette().fieldFocusBorder,
          boxShadow: palette().shadowComposerFocus,
        }}
      >
        <Icon name="sparkles" size={15} color={palette().textMuted} />
        <Input
          value={homeQuickPrompt()}
          placeholder={tr("home.askPlaceholder")}
          accessibilityLabel="home-quick-prompt"
          submitBehavior="submit"
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().text,
            placeholderColor: palette().textMuted,
            caretColor: palette().accent,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.45),
          }}
          onChange={event => homeQuickPrompt.set(event.value)}
          onSubmit={() => void submitHomeQuickPrompt()}
        />
        <View style={{ flexShrink: 0 }}>
          <SelectDropdown
            options={starterOptions()}
            value={selectedStarter()}
            placeholder={tr("home.starters")}
            variant="ghost"
            size="sm"
            accessibilityLabel="home-starter-select"
            onChange={value => {
              selectedStarter.set(value);
              const match = QUICK_STARTERS.find(item => item.id === value);
              if (match) {
                homeQuickPrompt.set(tr(match.promptKey));
              }
            }}
          />
        </View>
        <Button
          label={homeQuickBusy() ? tr("home.starting") : tr("home.askButton")}
          variant="primary"
          size="sm"
          pill={true}
          leadingIcon="arrow-up"
          loading={homeQuickBusy()}
          disabled={homeQuickBusy() || !homeQuickPrompt().trim()}
          accessibilityLabel="home-quick-ask"
          onPress={() => void submitHomeQuickPrompt()}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 7,
        }}
      >
        <Each of={QUICK_STARTERS} key={item => item.id}>
          {item => (
            <PillChip
              label={tr(item().shortLabelKey)}
              icon={item().icon}
              active={selectedStarter() === item().id}
              accessibilityLabel={`home-starter-chip-${item().id}`}
              onPress={() => {
                selectedStarter.set(item().id);
                homeQuickPrompt.set(tr(item().promptKey));
              }}
            />
          )}
        </Each>
      </View>
    </View>
  );
}

function MetricsBarSection() {
  const usageReady = () => usageSummary() !== null;
  const activityReady = () => usageSummary() !== null || usageActivityStatus() === "ready";
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
          gap: 1,
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().borderSubtle,
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          overflow: "hidden",
        }}
      >
        <KpiCell
          label={tr("home.kpiTotalTokens")}
          align="center"
          valueFirst={true}
          valueMuted={!usageReady()}
          value={
            usageReady()
              ? formatTokens(usageSummary()!.totalTokens) || "0"
              : tr("common.unavailable")
          }
          style={{
            backgroundColor: palette().panelRaised,
            paddingHorizontal: 10,
            paddingVertical: 15,
          }}
        />
        <KpiCell
          label={tr("home.kpiPeakDaily")}
          align="center"
          valueFirst={true}
          valueMuted={!activityReady()}
          value={
            activityReady()
              ? formatTokens(overviewUsageMetrics().peakTokens) || "0"
              : tr("common.unavailable")
          }
          style={{
            backgroundColor: palette().panelRaised,
            paddingHorizontal: 10,
            paddingVertical: 15,
          }}
        />
        <KpiCell
          label={tr("home.kpiRequests30d")}
          align="center"
          valueFirst={true}
          valueMuted={!usageReady()}
          value={
            usageReady()
              ? formatCount(usageSummary()!.totalRequests) || "0"
              : tr("common.unavailable")
          }
          style={{
            backgroundColor: palette().panelRaised,
            paddingHorizontal: 10,
            paddingVertical: 15,
          }}
        />
        <KpiCell
          label={tr("home.kpiLongestStreak")}
          align="center"
          valueFirst={true}
          valueMuted={!activityReady()}
          value={
            activityReady()
              ? tr("home.kpiStreakDays", {
                  count: formatCount(overviewUsageMetrics().longestStreak) || "0",
                })
              : tr("common.unavailable")
          }
          style={{
            backgroundColor: palette().panelRaised,
            paddingHorizontal: 10,
            paddingVertical: 15,
          }}
        />
        <KpiCell
          label={tr("home.kpiCurrentStreak")}
          align="center"
          valueFirst={true}
          valueMuted={!activityReady()}
          value={
            activityReady()
              ? tr("home.kpiStreakDays", {
                  count: formatCount(overviewUsageMetrics().currentStreak) || "0",
                })
              : tr("common.unavailable")
          }
          style={{
            backgroundColor: palette().panelRaised,
            paddingHorizontal: 10,
            paddingVertical: 15,
          }}
        />
      </View>

      <If when={usageSummary()}>
        {summary => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: summary().topModelName ? "space-between" : "flex-end",
              gap: 10,
              paddingHorizontal: 4,
            }}
          >
            <If when={summary().topModelName}>
              {topModel => (
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.38),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {tr("home.topModel", { name: topModel() })}
                </Text>
              )}
            </If>
            <Button
              label={tr("home.usageSettings")}
              variant="ghost"
              size="xs"
              accessibilityLabel="home-open-usage-settings"
              onPress={() => navigateScene("settings")}
            />
          </View>
        )}
      </If>

      <If when={!usageSummary() && usagePulseNote() ? usagePulseNote() : ""}>
        {note => (
          <InlineBanner
            tone="warning"
            message={localizeHostError(note())}
            actionLabel={tr("common.retry")}
            onAction={() => void loadEcosystemPulse(true)}
          />
        )}
      </If>
    </View>
  );
}

function AgentsAndAssistantsSection() {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={tr("home.agentsAssistants")}
        right={
          <>
            <Button
              label={tr("home.createAgent")}
              variant="ghost"
              size="xs"
              leadingIcon="plus"
              accessibilityLabel="home-quick-create-agent"
              onPress={() => navigateScene("agents")}
            />
            <Button
              label={tr("home.newAssistant")}
              variant="ghost"
              size="xs"
              leadingIcon="plus"
              accessibilityLabel="home-quick-new-assistant"
              onPress={() => navigateScene("assistants")}
            />
          </>
        }
      />

      <SplitPairCard>
        <SplitStatHalf
          title={tr("home.agentTeam")}
          icon="bot"
          valueText={agentsCount() !== null ? formatCount(agentsCount()!) : tr("common.unavailable")}
          valueMuted={agentsCount() === null}
          subtitle={
            (agentsPulseNote() ? localizeHostError(agentsPulseNote()) : "") ||
            (subagentsCount() > 0
              ? `${formatPlural(modesCount() ?? 0, "format.modeOne", "format.modeOther")} · ${formatPlural(subagentsCount(), "format.subagentOne", "format.subagentOther")}`
              : tr("home.agentTeamFallback"))
          }
          targetScene="agents"
          accessibilityLabel="home-card-agents"
        />
        <SplitStatHalf
          title={tr("home.personalAssistants")}
          icon="sparkles"
          valueText={
            assistantsCount() !== null ? formatCount(assistantsCount()!) : tr("common.unavailable")
          }
          valueMuted={assistantsCount() === null}
          subtitle={
            (assistantsPulseNote() ? localizeHostError(assistantsPulseNote()) : "") ||
            tr("home.assistantsFallback")
          }
          targetScene="assistants"
          accessibilityLabel="home-card-assistants"
        />
      </SplitPairCard>
    </View>
  );
}

function WorkspaceAndSshSection() {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={tr("home.workspaceSsh")}
        right={
          <>
            <Button
              label={tr("home.newWorkspace")}
              variant="ghost"
              size="xs"
              leadingIcon="folder-plus"
              accessibilityLabel="home-new-workspace"
              onPress={() => void openNewWorkspaceModal()}
            />
            <Button
              label={tr("home.connectSsh")}
              variant="ghost"
              size="xs"
              leadingIcon="server"
              accessibilityLabel="home-connect-ssh"
              onPress={() => void openSshConnectionModal()}
            />
          </>
        }
      />

      <View
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <View
          style={{
            paddingHorizontal: 18,
            paddingVertical: 16,
            gap: 10,
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name="folder-open" size={14} color={palette().textMuted} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  fontWeight: "600",
                  lineHeight: textLineHeight(13, 1.32),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("home.activeWorkspace")}
              </Text>
            </View>
            <If
              when={Boolean(
                activeRemoteWorkspaceForCurrent() ||
                  (activeWorkspace()?.workspaceKind ?? "").toLowerCase() === "remote",
              )}
            >
              <Badge label={tr("home.remoteSsh")} tone="accent" />
            </If>
          </View>
          <View style={{ gap: 3, flex: 1 }}>
            <Text
              style={{
                color: activeWorkspace() ? palette().text : palette().textMuted,
                fontSize: textSize(15),
                fontWeight: "600",
                letterSpacing: textTracking(15),
                lineHeight: textLineHeight(15, 1.32),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {activeWorkspace()?.name || tr("home.noWorkspaceActive")}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11.5),
                fontFamily: activeWorkspaceRoot() ? fontMono : undefined,
                lineHeight: textLineHeight(11.5, 1.42),
                numberOfLines: activeWorkspaceRoot() ? 1 : 2,
                textOverflow: activeWorkspaceRoot() ? "ellipsis-middle" : "ellipsis",
              }}
            >
              {activeWorkspaceRoot() || tr("home.openWorkspaceHint")}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
            <Button
              label={tr("home.openWorkspace")}
              variant="secondary"
              size="sm"
              leadingIcon="folder-plus"
              onPress={() => void openNewWorkspaceModal()}
            />
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 18,
            paddingVertical: 16,
            gap: 10,
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name="server" size={14} color={palette().textMuted} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  fontWeight: "600",
                  lineHeight: textLineHeight(13, 1.32),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("home.savedSshHosts")}
              </Text>
            </View>
            <Badge label={formatCount(homeSshList().length)} tone="neutral" />
          </View>

          <If
            when={homeSshList().length > 0}
            else={
              <View style={{ gap: 10, flex: 1, justifyContent: "space-between" }}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.46),
                  }}
                >
                  {tr("home.sshEmptyHint")}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Button
                    label={tr("home.manageSsh")}
                    variant="secondary"
                    size="sm"
                    leadingIcon="server"
                    onPress={() => void openSshConnectionModal()}
                  />
                </View>
              </View>
            }
          >
            {/* Clean borderless rows divided by whisper hairlines directly inside panelRaised card */}
            <View>
              <Each of={homeSshList().slice(0, 3)} key={conn => conn.id}>
                {(conn, idx) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 9,
                      marginHorizontal: -6,
                      paddingHorizontal: 8,
                      paddingVertical: 8,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderTopWidth: idx() > 0 ? 1 : 0,
                      borderColor: palette().borderSubtle,
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                  >
                    <StatusDot
                      kind={connectionStatuses()[conn().id] === "connected" ? "success" : "muted"}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(12.5),
                          fontWeight: "500",
                          lineHeight: textLineHeight(12.5, 1.32),
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {conn().name || conn().host}
                      </Text>
                      <Text
                        style={{
                          color: palette().textMuted,
                          fontSize: textSize(10.5),
                          fontFamily: fontMono,
                          lineHeight: textLineHeight(10.5, 1.3),
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {`${conn().username || "user"}@${conn().host}:${conn().port || 22}`}
                      </Text>
                    </View>
                    <View style={{ flexShrink: 0 }}>
                      <Button
                        label={
                          connectionStatuses()[conn().id] === "connected"
                            ? tr("common.manage")
                            : tr("common.connect")
                        }
                        variant="ghost"
                        size="xs"
                        accessibilityLabel={`home-ssh-connect-${conn().id}`}
                        onPress={() => {
                          if (connectionStatuses()[conn().id] === "connected") {
                            void openSshConnectionModal(conn().id);
                          } else {
                            void quickConnectSavedConnection(conn(), {
                              browseAfterConnect: true,
                            });
                          }
                        }}
                      />
                    </View>
                  </View>
                )}
              </Each>
            </View>
          </If>
        </View>
      </View>
    </View>
  );
}

function SkillsAndRoutinesSection() {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title={tr("home.skillsRoutines")} />
      <SplitPairCard>
        <SplitStatHalf
          title={tr("nav.skills")}
          icon="zap"
          valueText={skillsCount() !== null ? formatCount(skillsCount()!) : tr("common.unavailable")}
          valueMuted={skillsCount() === null}
          subtitle={
            (skillsPulseNote() ? localizeHostError(skillsPulseNote()) : "") ||
            (skillsEnabledCount() !== null
              ? tr("home.skillsEnabled", { count: formatCount(skillsEnabledCount()!) })
              : tr("home.skillsFallback"))
          }
          targetScene="skills"
          accessibilityLabel="home-card-skills"
        />
        <SplitStatHalf
          title={tr("nav.routines")}
          icon="clock"
          valueText={
            routinesCount() !== null ? formatCount(routinesCount()!) : tr("common.unavailable")
          }
          valueMuted={routinesCount() === null}
          subtitle={
            (routinesPulseNote() ? localizeHostError(routinesPulseNote()) : "") ||
            (routinesEnabledCount() !== null
              ? tr("home.routinesActive", { count: formatCount(routinesEnabledCount()!) })
              : tr("home.routinesFallback"))
          }
          targetScene="routines"
          accessibilityLabel="home-card-routines"
        />
      </SplitPairCard>
    </View>
  );
}

function SpacesAndInsightsSection() {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={tr("home.spacesInsights")}
        right={
          <>
            <If when={!insightsGenerating()}>
              <Button
                label={tr("home.generateInsights")}
                variant="primary"
                size="sm"
                leadingIcon="sparkles"
                accessibilityLabel="home-generate-insights"
                onPress={() => void generateInsightsReport(30)}
              />
            </If>
            <If when={insightsGenerating()}>
              <Button
                label={tr("common.cancel")}
                variant="danger"
                size="sm"
                accessibilityLabel="home-cancel-insights"
                onPress={() => void cancelInsights()}
              />
            </If>
            <IconButton
              icon="refresh"
              size="sm"
              disabled={insightsLoading()}
              tooltip={tr("home.reloadInsights")}
              accessibilityLabel="home-reload-insights"
              onPress={() => void loadLatestInsights()}
            />
          </>
        }
      />

      <View
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <EcosystemCard
          title={tr("nav.spaces")}
          icon="layout-grid"
          valueText={spacesCount() !== null ? formatCount(spacesCount()!) : tr("common.unavailable")}
          valueMuted={spacesCount() === null}
          subtitle={
            (spacesPulseNote() ? localizeHostError(spacesPulseNote()) : "") ||
            (spacesCount() !== null
              ? tr("home.spacesRunning", { count: formatCount(spacesRunningCount()) })
              : tr("home.spacesFallback"))
          }
          targetScene="spaces"
          accessibilityLabel="home-card-spaces"
          extra={
            installedSpaces().length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
                <Each of={installedSpaces().slice(0, 4)} key={item => item.id}>
                  {item => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        maxWidth: 164,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().surfaceSubtle,
                      }}
                    >
                      <StatusDot
                        kind={item().running ? "success" : "muted"}
                        size={6}
                      />
                      <Text
                        style={{
                          flexShrink: 1,
                          minWidth: 0,
                          color: palette().text,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.3),
                          fontWeight: "500",
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item().name}
                      </Text>
                    </View>
                  )}
                </Each>
                <If when={installedSpaces().length > 4}>
                  <Badge
                    label={`+${formatCount(installedSpaces().length - 4)}`}
                    tone="neutral"
                  />
                </If>
              </View>
            ) : undefined
          }
        />

        <View
          style={{
            paddingHorizontal: 18,
            paddingVertical: 16,
            gap: 10,
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name="notes" size={14} color={palette().textMuted} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  fontWeight: "600",
                  lineHeight: textLineHeight(13, 1.32),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("home.insightsReports")}
              </Text>
            </View>
            <If when={activeInsightsReport()}>
              {report => (
                <View style={{ flexShrink: 0 }}>
                  <Button
                    label={tr("home.openReader")}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel="home-open-last-insight"
                    onPress={() => {
                      void report();
                      insightsModalOpen.set(true);
                    }}
                  />
                </View>
              )}
            </If>
          </View>

          <If when={insightsGenerating()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <StatusDot kind="accent" pulse={true} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().accent,
                  fontSize: textSize(11.5),
                  fontWeight: "500",
                  lineHeight: textLineHeight(11.5, 1.4),
                }}
              >
                {insightsProgress() || tr("home.generatingInsights")}
              </Text>
            </View>
          </If>
          <If when={insightsNotice()}>
            {notice => (
              <Text
                style={{
                  color: palette().success,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.4),
                  fontWeight: "500",
                }}
              >
                {notice()}
              </Text>
            )}
          </If>
          <If when={insightsError()}>
            {err => (
              <Text
                style={{
                  color: palette().danger,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.4),
                  fontWeight: "500",
                }}
              >
                {localizeHostError(err())}
              </Text>
            )}
          </If>

          <If
            when={insightsMetas().length > 0}
            else={
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.46),
                }}
              >
                {insightsLoading() ? tr("home.loadingInsights") : tr("home.noInsightsYet")}
              </Text>
            }
          >
            {/* Clean borderless hairline-divided rows inside panelRaised card */}
            <View>
              <Each of={insightsMetas().slice(0, 4)} key={item => item.path}>
                {(item, index) => (
                  <View
                    role="button"
                    accessibilityLabel={`home-insight-report-${index()}`}
                    onPress={() => void openInsightsReport(item().path, true)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 9,
                      marginHorizontal: -6,
                      paddingHorizontal: 8,
                      paddingVertical: 8,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderTopWidth: index() > 0 ? 1 : 0,
                      borderColor: palette().borderSubtle,
                      backgroundColor:
                        selectedInsightsPath() === item().path
                          ? palette().surfaceSubtle
                          : "transparent",
                      cursor: "pointer",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{
                      backgroundColor: palette().surfaceSubtle,
                    }}
                    activeStyle={{
                      backgroundColor: palette().panelHover,
                      opacity: 0.9,
                    }}
                    focusVisibleStyle={{
                      outlineWidth: 2,
                      outlineColor: palette().borderFocus,
                      outlineOffset: -2,
                    }}
                  >
                    <Icon name="file-text" size={14} color={palette().accent} />
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(12.5),
                          fontWeight: "600",
                          lineHeight: textLineHeight(12.5, 1.32),
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item().title}
                      </Text>
                      <Text
                        style={{
                          color: palette().textMuted,
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.3),
                          fontVariant: ["tabular-nums"],
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {[
                          item().dateRangeLabel,
                          item().totalSessions > 0
                            ? formatPlural(
                                item().totalSessions,
                                "format.sessionOne",
                                "format.sessionOther",
                              )
                            : "",
                          item().generatedAtText,
                        ]
                          .filter(Boolean)
                          .join(" · ") || item().path}
                      </Text>
                    </View>
                    <Text
                      style={{
                        flexShrink: 0,
                        color: palette().textSecondary,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.3),
                        fontWeight: "500",
                      }}
                    >
                      {tr("home.read")}
                    </Text>
                  </View>
                )}
              </Each>
            </View>
          </If>
        </View>
      </View>
    </View>
  );
}

function AttentionFeedSection() {
  return (
    <ConfigSection
      flush={true}
      bodyStyle={{ borderRadius: radii.xl }}
      title={tr("home.attentionActivity")}
      subtitle={tr("home.attentionSubtitle")}
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Button
            label={tr("nav.sessions")}
            variant="ghost"
            size="xs"
            accessibilityLabel="home-attention-sessions"
            onPress={() => navigateScene("sessions")}
          />
          <Button
            label={tr("nav.routines")}
            variant="ghost"
            size="xs"
            accessibilityLabel="home-attention-routines"
            onPress={() => navigateScene("routines")}
          />
        </View>
      }
    >
      <If
        when={
          pendingPermissionCount() === 0 &&
          activeTurnEntries().length === 0 &&
          dueSoonRoutines().length === 0
        }
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <Icon name="check-circle" size={14} color={palette().success} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.44),
            }}
          >
            {tr("home.attentionAllClear")}
          </Text>
        </View>
      </If>

      <Each of={pendingPermissions()} key={item => `perm-${item.requestId}`}>
        {(item, idx) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderTopWidth: idx() > 0 ? 1 : 0,
              borderColor: palette().borderSubtle,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          >
            <StatusDot kind="warning" pulse={true} />
            <Text
              style={{
                maxWidth: "36%",
                flexShrink: 0,
                color: palette().text,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.35),
                fontWeight: "600",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {item().action}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {item().resources.join(", ") || item().sessionId || tr("home.approvalRequired")}
            </Text>
            <View style={{ flexShrink: 0 }}>
              <Button
                label={tr("home.reviewInSessions")}
                variant="secondary"
                size="xs"
                accessibilityLabel={`home-review-approval-${item().requestId}`}
                onPress={() => jumpToSessions(item().sessionId)}
              />
            </View>
          </View>
        )}
      </Each>

      <Each of={activeTurnEntries()} key={item => `turn-${item.sessionId}`}>
        {(item, idx) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderTopWidth: pendingPermissionCount() > 0 || idx() > 0 ? 1 : 0,
              borderColor: palette().borderSubtle,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          >
            <StatusDot kind="accent" pulse={true} />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.35),
                fontWeight: "500",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {item().sessionName}
            </Text>
            <Badge label={tr("common.running")} tone="accent" />
            <View style={{ flexShrink: 0 }}>
              <Button
                label={tr("home.openSessions")}
                variant="ghost"
                size="xs"
                accessibilityLabel={`home-open-turn-${item().sessionId}`}
                onPress={() => jumpToSessions(item().sessionId)}
              />
            </View>
          </View>
        )}
      </Each>

      <Each of={dueSoonRoutines()} key={item => `routine-${item.id}`}>
        {(item, idx) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderTopWidth:
                pendingPermissionCount() > 0 || activeTurnEntries().length > 0 || idx() > 0 ? 1 : 0,
              borderColor: palette().borderSubtle,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          >
            <StatusDot kind="accent" />
            <Text
              style={{
                maxWidth: "38%",
                flexShrink: 0,
                color: palette().text,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.35),
                fontWeight: "600",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {item().name}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.35),
                fontVariant: ["tabular-nums"],
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("home.routineNextRun", {
                schedule: item().scheduleSummary,
                time: item().nextRunText,
              })}
            </Text>
            <View style={{ flexShrink: 0 }}>
              <Button
                label={tr("home.openRoutines")}
                variant="ghost"
                size="xs"
                accessibilityLabel={`home-open-routine-${item().id}`}
                onPress={() => navigateScene("routines")}
              />
            </View>
          </View>
        )}
      </Each>
    </ConfigSection>
  );
}

function SixMonthActivitySection() {
  const hoveredDay = (): HomeHeatmapDatum | null => {
    const idx = hoveredActivityIdx();
    if (idx === null) return null;
    return homeHeatmapPlotData().rows[idx] ?? null;
  };

  const weekdayColumnLabels = (): string[] => {
    const labels = weekdayShortLabels(true);
    return [labels[0] ?? "", "", labels[2] ?? "", "", labels[4] ?? "", "", ""];
  };

  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={tr("home.activityHeatmapTitle")}
        subtitle={
          usageActivityStatus() === "ready"
            ? tr("home.activityHeatmapSummary", {
                tokens: formatTokens(usageActivityGrid().totalTokens) || "0",
                weeks: formatPlural(
                  usageActivityGrid().weekCount,
                  "format.weekOne",
                  "format.weekOther",
                ),
              })
            : undefined
        }
        right={
          <If when={usageActivityStatus() === "ready"}>
            <Text
              style={{
                color: hoveredDay() ? palette().text : palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.3),
                fontWeight: hoveredDay() ? "600" : "400",
                fontVariant: ["tabular-nums"],
              }}
            >
              {hoveredDay()
                ? tr("home.activityDayTokens", {
                    date: hoveredDay()!.dateKey,
                    tokens: formatTokens(hoveredDay()!.tokens) || "0",
                  })
                : tr("home.activityHoverHint")}
            </Text>
          </If>
        }
      />

      <View
        style={{
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          padding: 18,
          gap: 12,
        }}
      >
        <If when={usageActivityStatus() === "loading"}>
          <View style={{ gap: 8 }}>
            <SkeletonBlock height={HEATMAP_HEIGHT} borderRadius={radii.md} />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.35),
              }}
            >
              {tr("home.activityHeatmapLoading")}
            </Text>
          </View>
        </If>

        <If when={usageActivityStatus() !== "loading" && usageActivityStatus() !== "ready"}>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.44),
            }}
          >
            {(usageActivityNote() ? localizeHostError(usageActivityNote()) : "") ||
              tr("home.activityUnavailable")}
          </Text>
        </If>

        <If when={usageActivityStatus() === "ready"}>
          <View style={{ gap: 10 }}>
            <Scroll
              horizontal={true}
              style={{ width: "100%", minWidth: 0 }}
              contentStyle={{ flexGrow: 1, justifyContent: "center" }}
            >
              <View style={{ gap: 6 }}>
                <View
                  style={{
                    width: homeHeatmapPlotData().plotWidth,
                    marginLeft: HEATMAP_WEEKDAY_COL_WIDTH + HEATMAP_WEEKDAY_GAP,
                    display: "grid",
                    gridTemplateColumns: `repeat(${homeHeatmapPlotData().weekCount}, minmax(0, 1fr))`,
                    alignItems: "center",
                  }}
                >
                  <Each of={usageActivityGrid().monthHeaders} key={m => `${m.weekIndex}-${m.label}`}>
                    {m => (
                      <View
                        style={{
                          gridColumn: `${m().weekIndex + 1} / span 3`,
                          gridRow: 1,
                        }}
                      >
                        <Text
                          style={{
                            color: palette().textMuted,
                            fontSize: textSize(10.5),
                            lineHeight: textLineHeight(10.5, 1.3),
                            fontWeight: "500",
                            numberOfLines: 1,
                          }}
                        >
                          {m().label}
                        </Text>
                      </View>
                    )}
                  </Each>
                </View>

                <View style={{ flexDirection: "row", alignItems: "stretch", gap: HEATMAP_WEEKDAY_GAP }}>
                  <View
                    style={{
                      width: HEATMAP_WEEKDAY_COL_WIDTH,
                      height: HEATMAP_HEIGHT,
                      justifyContent: "space-between",
                      flexShrink: 0,
                    }}
                  >
                    <Each of={weekdayColumnLabels()} key="index">
                      {label => (
                        <View style={{ flex: 1, justifyContent: "center" }}>
                          <Text
                            style={{
                              color: palette().textMuted,
                              fontSize: textSize(10.5),
                              lineHeight: textLineHeight(10.5, 1.2),
                              textAlign: "right",
                            }}
                          >
                            {label()}
                          </Text>
                        </View>
                      )}
                    </Each>
                  </View>

                  <Plot<HomeHeatmapDatum>
                    data={homeHeatmapPlotData().rows}
                    xScale={{
                      type: "band",
                      domain: homeHeatmapPlotData().weeks,
                      paddingInner: HEATMAP_PADDING_INNER,
                      paddingOuter: 0,
                    }}
                    yScale={{
                      type: "band",
                      domain: [...DAY_ROWS],
                      paddingInner: HEATMAP_PADDING_INNER,
                      paddingOuter: 0,
                    }}
                    colorScale={{
                      type: "ordinal",
                      domain: ["0", "1", "2", "3", "4"],
                      range: heatmapStepColors(),
                    }}
                    accessibilityLabel="home-activity-heatmap"
                    onHoverChange={event => hoveredActivityIdx.set(event.index)}
                    style={{
                      width: homeHeatmapPlotData().plotWidth,
                      height: HEATMAP_HEIGHT,
                      flexShrink: 0,
                    }}
                  >
                    <Cell
                      x="weekKey"
                      y="dow"
                      color="levelKey"
                      cornerRadii={3}
                      hoverCellStyle={{
                        borderWidth: 1.5,
                        borderColor: palette().text,
                        borderRadius: 4,
                      }}
                    />
                  </Plot>
                </View>
              </View>
            </Scroll>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                paddingTop: 2,
              }}
            >
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.3),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {tr("home.activityPeakSummary", {
                  peak: formatTokens(overviewUsageMetrics().peakTokens) || "0",
                  days: formatPlural(
                    homeHeatmapPlotData().activeDays,
                    "format.dayOne",
                    "format.dayOther",
                  ),
                })}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.3),
                  }}
                >
                  {tr("common.less")}
                </Text>
                <Each of={[0, 1, 2, 3, 4]} key={lvl => String(lvl)}>
                  {lvl => (
                    <View
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 3,
                        backgroundColor: heatmapStepColors()[lvl()],
                      }}
                    />
                  )}
                </Each>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.3),
                  }}
                >
                  {tr("common.more")}
                </Text>
              </View>
            </View>
          </View>
        </If>
      </View>
    </View>
  );
}

function HomeModals() {
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
                label={tr("home.regenerateInsights")}
                variant="secondary"
                size="sm"
                leadingIcon="sparkles"
                disabled={insightsGenerating()}
                onPress={() => void generateInsightsReport(30)}
              />
              <Button
                label={tr("common.close")}
                variant="primary"
                size="sm"
                onPress={closeInsightsModal}
              />
            </>
          }
        >
          <View style={{ width: "100%", maxWidth: 660, alignSelf: "center" }}>
            <TextView
              markdown={report().markdown}
              selectable={true}
              links="open"
              options={STATIC_MARKDOWN_OPTIONS}
              codeBlockActions={createMarkdownCodeActions()}
              styles={createMarkdownStyles({ baseFontSize: 13.5 })}
            />
          </View>
        </ModalDialog>
      )}
    </If>
  );
}

export function HomeScene() {
  let initialMount = true;
  effect(() => {
    const peerId = peerScope()?.deviceId ?? null;
    const workspaceId = activeWorkspaceId();
    const force = initialMount;
    initialMount = false;
    untracked(() => {
      syncHomeScope(peerId, workspaceId, force);
    });
  });

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}>
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 820,
            alignSelf: "center",
            paddingHorizontal: 28,
            paddingTop: 12,
            paddingBottom: 56,
            gap: 24,
          }}
        >
          <IdentityHeader />
          <QuickPromptLaunchpad />
          <MetricsBarSection />
          <AgentsAndAssistantsSection />
          <WorkspaceAndSshSection />
          <SkillsAndRoutinesSection />
          <SpacesAndInsightsSection />
          <AttentionFeedSection />
          <SixMonthActivitySection />
        </View>
      </Scroll>
      <HomeModals />
    </View>
  );
}

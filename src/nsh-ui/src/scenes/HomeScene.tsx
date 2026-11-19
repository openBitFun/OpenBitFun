import { computed, effect, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
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
  INSIGHTS_DAY_OPTIONS,
  insightsDays,
  insightsModel,
  revealInsightsHtml,
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
  isLightAppearance,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { accountAuthModalOpen, openAccountAuthModal } from "../ui/AccountAuthModal";
import { BotCharacter, type IconName } from "../ui/icons";
import {
  STATIC_MARKDOWN_OPTIONS,
  createMarkdownCodeActions,
  createMarkdownStyles,
} from "../ui/markdown";
import { MOTION_DURATION, paintTransition } from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  pushToast,
  type SelectDropdownOption,
} from "../ui/overlays";
import { openCreateBotBuilder } from "../agentsCatalogStore";
import { assistantsBusy, assistantsError, createAssistant } from "../assistantStore";
import {
  Button,
  IconButton,
  InlineBanner,
  SkeletonBlock,
  StatusDot,
} from "../ui/primitives";
import {
  InsetGroup,
  InsetRow,
  STUDIO_CONTENT_MAX,
  STUDIO_SECTION_GAP,
  STUDIO_TOUCH_MIN,
  StudioSection,
  studioCompact,
  studioGutter,
  studioTitleSize,
  trackStudioWidth,
} from "../ui/studio";

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

/** Creates an assistant workspace and opens it, as the desktop's overview does. */
async function createAssistantFromHome(): Promise<void> {
  await createAssistant("");
  const failure = assistantsError();
  if (failure) {
    pushToast(tr("home.createAssistantFailed", { error: localizeHostError(failure) }), "error");
    return;
  }
  navigateScene("assistants");
}


// --- Greeting: small avatar, large title, a quiet trailing account control ---

function HomeAccountControl() {
  const menuOpen = signal(false);
  const anchor = signal<ViewRef | null>(null);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <If
        when={isAccountSignedIn()}
        else={
          <Button
            label={authLoading() ? tr("home.starting") : tr("home.githubSignIn")}
            variant="secondary"
            size="sm"
            leadingIcon="log-in"
            disabled={authLoading()}
            accessibilityLabel="home-github-sign-in"
            onPress={() => openAccountAuthModal({ autoStart: true })}
          />
        }
      >
        <>
          <View ref={el => anchor.set(el)} style={{ flexShrink: 1, minWidth: 0 }}>
            <Button
              label={githubUser()?.login ? `@${githubUser()!.login}` : tr("home.signedIn")}
              variant="ghost"
              size="sm"
              trailingIcon="chevron-down"
              accessibilityLabel="home-account-menu"
              style={{ maxWidth: 220 }}
              onPress={() => menuOpen.update(open => !open)}
            />
          </View>
          <If when={menuOpen()}>
            <DropdownMenu
              open={true}
              anchor={anchor()}
              align="end"
              minWidth={200}
              onClose={() => menuOpen.set(false)}
              items={[
                {
                  id: "profile",
                  label: tr("home.polish.accountDetails"),
                  icon: "user",
                  accessibilityLabel: "home-account-profile",
                  onSelect: () => openAccountAuthModal(),
                },
                {
                  id: "sign-out",
                  label: authLoading() ? tr("home.signingOut") : tr("home.githubSignOut"),
                  icon: "log-out",
                  separator: true,
                  disabled: authLoading(),
                  accessibilityLabel: "home-github-sign-out",
                  onSelect: () => void signOutAccount(),
                },
              ]}
            />
          </If>
        </>
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
  );
}

function HomeGreeting() {
  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: studioCompact() ? "wrap" : "nowrap",
          gap: 14,
        }}
      >
        <BotCharacter variant="grok" size={studioCompact() ? 36 : 44} ringColor={palette().canvas} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            role="header"
            style={{
              color: palette().text,
              fontSize: textSize(studioTitleSize()),
              fontWeight: "600",
              letterSpacing: textTracking(studioTitleSize()),
              lineHeight: textLineHeight(studioTitleSize(), 1.2),
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
              color: palette().textSecondary,
              fontSize: textSize(14),
              lineHeight: textLineHeight(14, 1.45),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("home.title")}
          </Text>
        </View>
        <HomeAccountControl />
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

// --- Prompt launchpad: one quiet field, a starters menu, the page's one primary action ---

function QuickPromptLaunchpad() {
  return (
    <View
      style={{
        width: "100%",
        minHeight: 48,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().panelRaised,
        paddingLeft: 16,
        paddingRight: 8,
        paddingVertical: 8,
        flexDirection: "row",
        flexWrap: studioCompact() ? "wrap" : "nowrap",
        alignItems: "center",
        gap: 8,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      focusWithinStyle={{ borderColor: palette().fieldFocusBorder }}
    >
      <Input
        value={homeQuickPrompt()}
        placeholder={tr("home.askPlaceholder")}
        accessibilityLabel="home-quick-prompt"
        submitBehavior="submit"
        style={{
          flex: 1,
          flexBasis: studioCompact() ? "100%" : "auto",
          minWidth: 0,
          minHeight: studioCompact() ? STUDIO_TOUCH_MIN - 12 : undefined,
          color: palette().text,
          placeholderColor: palette().textMuted,
          caretColor: palette().accent,
          fontSize: textSize(14),
          lineHeight: textLineHeight(14, 1.45),
        }}
        onChange={event => homeQuickPrompt.set(event.value)}
        onSubmit={() => void submitHomeQuickPrompt()}
      />
      <If when={studioCompact()}>
        <View style={{ flex: 1 }} />
      </If>
      <View style={{ flexShrink: 0 }}>
        <SelectDropdown
          options={starterOptions()}
          value={selectedStarter()}
          placeholder={tr("home.starters")}
          variant="ghost"
          size="sm"
          align="end"
          accessibilityLabel="home-starter-select"
          onChange={value => {
            selectedStarter.set(value);
            const match = QUICK_STARTERS.find(item => item.id === value);
            if (match) homeQuickPrompt.set(tr(match.promptKey));
          }}
        />
      </View>
      <Button
        label={homeQuickBusy() ? tr("home.starting") : tr("home.askButton")}
        variant="primary"
        size="sm"
        leadingIcon="arrow-up"
        loading={homeQuickBusy()}
        disabled={homeQuickBusy() || !homeQuickPrompt().trim()}
        accessibilityLabel="home-quick-ask"
        onPress={() => void submitHomeQuickPrompt()}
      />
    </View>
  );
}

// --- Needs attention: only drawn when something waits on the user ---

const attentionCount = computed(
  () => pendingPermissionCount() + activeTurnEntries().length + dueSoonRoutines().length,
);

function NeedsAttentionSection() {
  return (
    <If when={attentionCount() > 0}>
      <StudioSection
        title={tr("home.polish.needsAttention")}
        accessibilityLabel="home-needs-attention"
        trailing={
          <Button
            label={tr("nav.sessions")}
            variant="ghost"
            size="xs"
            accessibilityLabel="home-attention-sessions"
            onPress={() => navigateScene("sessions")}
          />
        }
      >
        <InsetGroup>
          <Each of={pendingPermissions()} key={item => `perm-${item.requestId}`}>
            {(item, idx) => (
              <InsetRow
                first={idx() === 0}
                leading={<StatusDot kind="warning" pulse={true} />}
                label={item().action}
                detail={item().resources.join(", ") || item().sessionId || tr("home.approvalRequired")}
                trailing={
                  <Button
                    label={tr("home.reviewInSessions")}
                    variant="secondary"
                    size="xs"
                    accessibilityLabel={`home-review-approval-${item().requestId}`}
                    onPress={() => jumpToSessions(item().sessionId)}
                  />
                }
              />
            )}
          </Each>
          <Each of={activeTurnEntries()} key={item => `turn-${item.sessionId}`}>
            {(item, idx) => (
              <InsetRow
                first={pendingPermissionCount() === 0 && idx() === 0}
                leading={<StatusDot kind="accent" pulse={true} />}
                label={item().sessionName}
                detail={tr("common.running")}
                trailing={
                  <Button
                    label={tr("home.openSessions")}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel={`home-open-turn-${item().sessionId}`}
                    onPress={() => jumpToSessions(item().sessionId)}
                  />
                }
              />
            )}
          </Each>
          <Each of={dueSoonRoutines()} key={item => `routine-${item.id}`}>
            {(item, idx) => (
              <InsetRow
                first={pendingPermissionCount() === 0 && activeTurnEntries().length === 0 && idx() === 0}
                leading={<StatusDot kind="accent" />}
                label={item().name}
                detail={tr("home.routineNextRun", {
                  schedule: item().scheduleSummary,
                  time: item().nextRunText,
                })}
                trailing={
                  <Button
                    label={tr("home.openRoutines")}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel={`home-open-routine-${item().id}`}
                    onPress={() => navigateScene("routines")}
                  />
                }
              />
            )}
          </Each>
        </InsetGroup>
      </StudioSection>
    </If>
  );
}

// --- Activity: one quiet row of five numbers, then the six-month heatmap ---

function ActivityNumber(props: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text
        style={{
          color: props.muted ? palette().textMuted : palette().text,
          fontSize: textSize(props.muted ? 14 : 17),
          fontWeight: props.muted ? "400" : "600",
          letterSpacing: props.muted ? 0 : textTracking(17),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(17, 1.25),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.value}
      </Text>
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function ActivitySection() {
  const usageReady = () => usageSummary() !== null;
  const activityReady = () => usageSummary() !== null || usageActivityStatus() === "ready";
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
    <StudioSection
      title={tr("home.polish.activity")}
      accessibilityLabel="home-activity"
      trailing={
        <If when={usageSummary()}>
          <Button
            label={tr("home.usageSettings")}
            variant="ghost"
            size="xs"
            accessibilityLabel="home-open-usage-settings"
            onPress={() => navigateScene("settings")}
          />
        </If>
      }
    >
      <View style={{ gap: 20 }}>
        <View
          style={{
            display: "grid",
            gridTemplateColumns: studioCompact()
              ? "repeat(3, minmax(0, 1fr))"
              : "repeat(5, minmax(0, 1fr))",
            columnGap: 16,
            rowGap: 16,
            paddingHorizontal: 4,
          }}
        >
          <ActivityNumber
            label={tr("home.kpiTotalTokens")}
            muted={!usageReady()}
            value={usageReady() ? formatTokens(usageSummary()!.totalTokens) || "0" : tr("common.unavailable")}
          />
          <ActivityNumber
            label={tr("home.kpiPeakDaily")}
            muted={!activityReady()}
            value={
              activityReady() ? formatTokens(overviewUsageMetrics().peakTokens) || "0" : tr("common.unavailable")
            }
          />
          <ActivityNumber
            label={tr("home.kpiRequests30d")}
            muted={!usageReady()}
            value={usageReady() ? formatCount(usageSummary()!.totalRequests) || "0" : tr("common.unavailable")}
          />
          <ActivityNumber
            label={tr("home.kpiLongestStreak")}
            muted={!activityReady()}
            value={
              activityReady()
                ? tr("home.kpiStreakDays", { count: formatCount(overviewUsageMetrics().longestStreak) || "0" })
                : tr("common.unavailable")
            }
          />
          <ActivityNumber
            label={tr("home.kpiCurrentStreak")}
            muted={!activityReady()}
            value={
              activityReady()
                ? tr("home.kpiStreakDays", { count: formatCount(overviewUsageMetrics().currentStreak) || "0" })
                : tr("common.unavailable")
            }
          />
        </View>

        <If when={usageSummary()?.topModelName ?? ""}>
          {topModel => (
            <Text
              style={{
                marginTop: -8,
                paddingHorizontal: 4,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("home.topModel", { name: topModel() })}
            </Text>
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

        <View style={{ gap: 10, paddingHorizontal: 4 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.35),
              }}
            >
              {tr("home.activityHeatmapTitle")}
            </Text>
            <If when={usageActivityStatus() === "ready"}>
              <Text
                style={{
                  color: hoveredDay() ? palette().text : palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.3),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {hoveredDay()
                  ? tr("home.activityDayTokens", {
                      date: hoveredDay()!.dateKey,
                      tokens: formatTokens(hoveredDay()!.tokens) || "0",
                    })
                  : tr("home.activityHeatmapSummary", {
                      tokens: formatTokens(usageActivityGrid().totalTokens) || "0",
                      weeks: formatPlural(usageActivityGrid().weekCount, "format.weekOne", "format.weekOther"),
                    })}
              </Text>
            </If>
          </View>

          <If when={usageActivityStatus() === "loading"}>
            <View style={{ gap: 8 }}>
              <SkeletonBlock height={HEATMAP_HEIGHT} borderRadius={radii.md} />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.35),
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
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
              }}
            >
              {(usageActivityNote() ? localizeHostError(usageActivityNote()) : "") ||
                tr("home.activityUnavailable")}
            </Text>
          </If>

          <If when={usageActivityStatus() === "ready"}>
            <View style={{ gap: 10 }}>
              <Scroll horizontal={true} style={{ width: "100%", minWidth: 0 }} contentStyle={{ flexGrow: 1 }}>
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
                        <View style={{ gridColumn: `${m().weekIndex + 1} / span 3`, gridRow: 1 }}>
                          <Text
                            style={{
                              color: palette().textMuted,
                              fontSize: textSize(11),
                              lineHeight: textLineHeight(11, 1.3),
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
                                fontSize: textSize(11),
                                lineHeight: textLineHeight(11, 1.2),
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
                }}
              >
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.3),
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {tr("home.activityPeakSummary", {
                    peak: formatTokens(overviewUsageMetrics().peakTokens) || "0",
                    days: formatPlural(homeHeatmapPlotData().activeDays, "format.dayOne", "format.dayOther"),
                  })}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
                  <Text style={{ color: palette().textMuted, fontSize: textSize(11), lineHeight: textLineHeight(11, 1.3) }}>
                    {tr("common.less")}
                  </Text>
                  <Each of={[0, 1, 2, 3, 4]} key={lvl => String(lvl)}>
                    {lvl => (
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          backgroundColor: heatmapStepColors()[lvl()],
                        }}
                      />
                    )}
                  </Each>
                  <Text style={{ color: palette().textMuted, fontSize: textSize(11), lineHeight: textLineHeight(11, 1.3) }}>
                    {tr("common.more")}
                  </Text>
                </View>
              </View>
            </View>
          </If>
        </View>
      </View>
    </StudioSection>
  );
}

// --- Your studio: one inset grouped list; each row navigates, its actions trail ---

function pulseDetail(note: string, fallback: string): string {
  return (note ? localizeHostError(note) : "") || fallback;
}

function countText(value: number | null): string {
  return value !== null ? formatCount(value) : tr("common.unavailable");
}

function InsightsStatusLine() {
  return (
    <>
      <If when={insightsGenerating()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot kind="accent" pulse={true} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.4),
            }}
          >
            {insightsProgress() || tr("home.generatingInsights")}
          </Text>
        </View>
      </If>
      <If when={!insightsGenerating() && insightsNotice() ? insightsNotice() : ""}>
        {notice => (
          <Text style={{ color: palette().success, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
            {notice()}
          </Text>
        )}
      </If>
      <If when={insightsError()}>
        {err => (
          <Text style={{ color: palette().danger, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
            {localizeHostError(err())}
          </Text>
        )}
      </If>
      <If when={!insightsGenerating() && !insightsError() && !insightsNotice() && insightsMetas().length === 0}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
          {insightsLoading() ? tr("home.loadingInsights") : tr("home.noInsightsYet")}
        </Text>
      </If>
    </>
  );
}

function YourStudioSection() {
  return (
    <StudioSection title={tr("home.polish.yourStudio")} accessibilityLabel="home-your-studio">
      <InsetGroup>
        <InsetRow
          first={true}
          icon="bot"
          label={tr("home.agentTeam")}
          detail={pulseDetail(
            agentsPulseNote(),
            subagentsCount() > 0
              ? `${formatPlural(modesCount() ?? 0, "format.modeOne", "format.modeOther")} · ${formatPlural(subagentsCount(), "format.subagentOne", "format.subagentOther")}`
              : tr("home.agentTeamFallback"),
          )}
          value={countText(agentsCount())}
          chevron={true}
          accessibilityLabel="home-card-agents"
          onPress={() => navigateScene("agents")}
          trailing={
            <IconButton
              icon="plus"
              size="xs"
              tooltip={tr("home.createAgent")}
              accessibilityLabel="home-quick-create-agent"
              onPress={() => {
                // The desktop opens the create-agent form in place; here it is the Agents builder.
                navigateScene("agents");
                openCreateBotBuilder("mode");
              }}
            />
          }
        />
        <InsetRow
          icon="sparkles"
          label={tr("home.personalAssistants")}
          detail={pulseDetail(assistantsPulseNote(), tr("home.assistantsFallback"))}
          value={countText(assistantsCount())}
          chevron={true}
          accessibilityLabel="home-card-assistants"
          onPress={() => navigateScene("assistants")}
          trailing={
            <IconButton
              icon="plus"
              size="xs"
              disabled={assistantsBusy()}
              tooltip={tr("home.newAssistant")}
              accessibilityLabel="home-quick-new-assistant"
              onPress={() => void createAssistantFromHome()}
            />
          }
        />
        <InsetRow
          icon="zap"
          label={tr("nav.skills")}
          detail={pulseDetail(
            skillsPulseNote(),
            skillsEnabledCount() !== null
              ? tr("home.skillsEnabled", { count: formatCount(skillsEnabledCount()!) })
              : tr("home.skillsFallback"),
          )}
          value={countText(skillsCount())}
          chevron={true}
          accessibilityLabel="home-card-skills"
          onPress={() => navigateScene("skills")}
        />
        <InsetRow
          icon="clock"
          label={tr("nav.routines")}
          detail={pulseDetail(
            routinesPulseNote(),
            routinesEnabledCount() !== null
              ? tr("home.routinesActive", { count: formatCount(routinesEnabledCount()!) })
              : tr("home.routinesFallback"),
          )}
          value={countText(routinesCount())}
          chevron={true}
          accessibilityLabel="home-card-routines"
          onPress={() => navigateScene("routines")}
        />
        <InsetRow
          icon="layout-grid"
          label={tr("nav.spaces")}
          detail={pulseDetail(
            spacesPulseNote(),
            spacesCount() !== null
              ? tr("home.spacesRunning", { count: formatCount(spacesRunningCount()) })
              : tr("home.spacesFallback"),
          )}
          value={countText(spacesCount())}
          chevron={true}
          accessibilityLabel="home-card-spaces"
          onPress={() => navigateScene("spaces")}
          below={
            installedSpaces().length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 }}>
                <Each of={installedSpaces().slice(0, 4)} key={item => item.id}>
                  {item => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 180 }}>
                      <StatusDot kind={item().running ? "success" : "muted"} size={6} />
                      <Text
                        style={{
                          flexShrink: 1,
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.4),
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
                  <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
                    {`+${formatCount(installedSpaces().length - 4)}`}
                  </Text>
                </If>
              </View>
            ) : undefined
          }
        />

        <InsetRow
          icon="folder-open"
          label={activeWorkspace()?.name || tr("home.noWorkspaceActive")}
          tone={activeWorkspace() ? "default" : "muted"}
          detail={activeWorkspaceRoot() || tr("home.openWorkspaceHint")}
          value={
            activeRemoteWorkspaceForCurrent() ||
            (activeWorkspace()?.workspaceKind ?? "").toLowerCase() === "remote"
              ? tr("home.remoteSsh")
              : homeSshList().length > 0
                ? tr("home.polish.sshHostsCount", { count: formatCount(homeSshList().length) })
                : ""
          }
          accessibilityLabel="home-workspace-row"
          trailing={
            <>
              <IconButton
                icon="folder-plus"
                size="xs"
                tooltip={tr("home.newWorkspace")}
                accessibilityLabel="home-new-workspace"
                onPress={() => void openNewWorkspaceModal()}
              />
              <IconButton
                icon="server"
                size="xs"
                tooltip={homeSshList().length > 0 ? tr("home.connectSsh") : tr("home.sshEmptyHint")}
                accessibilityLabel="home-connect-ssh"
                onPress={() => void openSshConnectionModal()}
              />
            </>
          }
        />
        <Each of={homeSshList().slice(0, 3)} key={conn => conn.id}>
          {conn => (
            <InsetRow
              indent={true}
              leading={<StatusDot kind={connectionStatuses()[conn().id] === "connected" ? "success" : "muted"} />}
              label={conn().name || conn().host}
              detail={`${conn().username || "user"}@${conn().host}:${conn().port || 22}`}
              trailing={
                <Button
                  label={
                    connectionStatuses()[conn().id] === "connected" ? tr("common.manage") : tr("common.connect")
                  }
                  variant="ghost"
                  size="xs"
                  accessibilityLabel={`home-ssh-connect-${conn().id}`}
                  onPress={() => {
                    if (connectionStatuses()[conn().id] === "connected") {
                      void openSshConnectionModal(conn().id);
                    } else {
                      void quickConnectSavedConnection(conn(), { browseAfterConnect: true });
                    }
                  }}
                />
              }
            />
          )}
        </Each>

        <InsetRow
          icon="notes"
          label={tr("home.insightsReports")}
          accessibilityLabel="home-insights-row"
          below={<InsightsStatusLine />}
          trailing={
            <>
              <If when={activeInsightsReport()}>
                <Button
                  label={tr("home.openReader")}
                  variant="ghost"
                  size="xs"
                  accessibilityLabel="home-open-last-insight"
                  onPress={() => insightsModalOpen.set(true)}
                />
              </If>
              <IconButton
                icon="refresh"
                size="xs"
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
            position: "relative",
            minHeight: STUDIO_TOUCH_MIN,
            paddingLeft: 44,
            paddingRight: 12,
            paddingVertical: 6,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 44,
              right: 0,
              height: 1,
              backgroundColor: palette().borderSubtle,
              pointerEvents: "none",
            }}
          />
          <SelectDropdown
            size="sm"
            variant="ghost"
            options={INSIGHTS_DAY_OPTIONS.map(days => ({
              value: String(days),
              label: tr("home.insightsDays", { count: String(days) }),
              accessibilityLabel: `home-insights-days-${days}`,
            }))}
            value={String(insightsDays())}
            disabled={insightsGenerating()}
            accessibilityLabel="home-insights-days"
            onChange={value => insightsDays.set(Number(value))}
          />
          <SelectDropdown
            size="sm"
            variant="ghost"
            options={[
              { value: "primary", label: tr("home.insightsModelPrimary"), accessibilityLabel: "home-insights-model-primary" },
              { value: "fast", label: tr("home.insightsModelFast"), accessibilityLabel: "home-insights-model-fast" },
            ]}
            value={insightsModel()}
            disabled={insightsGenerating()}
            accessibilityLabel="home-insights-model"
            onChange={value => insightsModel.set(value === "fast" ? "fast" : "primary")}
          />
          <View style={{ flex: 1 }} />
          <If
            when={insightsGenerating()}
            else={
              <Button
                label={tr("home.polish.generate")}
                variant="secondary"
                size="sm"
                leadingIcon="sparkles"
                tooltip={tr("home.generateInsights")}
                accessibilityLabel="home-generate-insights"
                onPress={() => void generateInsightsReport()}
              />
            }
          >
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              accessibilityLabel="home-cancel-insights"
              onPress={() => void cancelInsights()}
            />
          </If>
        </View>
        <Each of={insightsMetas().slice(0, 4)} key={item => item.path}>
          {(item, index) => (
            <InsetRow
              indent={true}
              selected={selectedInsightsPath() === item().path}
              label={item().title}
              detail={
                [
                  item().dateRangeLabel,
                  item().totalSessions > 0
                    ? formatPlural(item().totalSessions, "format.sessionOne", "format.sessionOther")
                    : "",
                  item().generatedAtText,
                ]
                  .filter(Boolean)
                  .join(" · ") || item().path
              }
              value={tr("home.read")}
              chevron={true}
              accessibilityLabel={`home-insight-report-${index()}`}
              onPress={() => void openInsightsReport(item().path, true)}
            />
          )}
        </Each>
      </InsetGroup>
    </StudioSection>
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
                onPress={() => void generateInsightsReport()}
              />
              <If when={report().htmlPath}>
                <Button
                  label={tr("home.insightsShowHtml")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="external-link"
                  disabled={Boolean(peerScope())}
                  tooltip={peerScope() ? tr("home.insightsHtmlPeerUnsupported") : undefined}
                  accessibilityLabel="insights-show-html"
                  onPress={() => void revealInsightsHtml(report().htmlPath)}
                />
              </If>
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
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            width: "100%",
            maxWidth: STUDIO_CONTENT_MAX + studioGutter() * 2,
            alignSelf: "center",
            paddingHorizontal: studioGutter(),
            paddingTop: studioCompact() ? 20 : 28,
            paddingBottom: 56,
            gap: studioCompact() ? 28 : STUDIO_SECTION_GAP,
          }}
        >
          <View style={{ gap: 20 }}>
            <HomeGreeting />
            <QuickPromptLaunchpad />
          </View>
          <NeedsAttentionSection />
          <ActivitySection />
          <YourStudioSection />
        </View>
      </Scroll>
      <HomeModals />
    </View>
  );
}

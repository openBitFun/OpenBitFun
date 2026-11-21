import { cleanup, computed, effect, Scroll, signal, Text, View } from "nsh";
import {
  formatDuration,
  formatMonthYear,
  formatPlural,
  formatTimestamp,
  weekdayShortLabels,
} from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  activeRoutineCount,
  calendarCells,
  calendarMonth,
  calendarYear,
  cancelDeleteRoutine,
  closeRoutineEditor,
  confirmDeleteRoutine,
  confirmingDeleteRoutineId,
  dueNext24Hours,
  editorOpen,
  ensureCronHostReady,
  filteredRoutines,
  formatScheduleSummary,
  jumpCalendarToday,
  loadRoutines,
  openCreateRoutineDraft,
  openEditRoutineDraft,
  draftSchedulePreview,
  routineIssueText,
  routinePreviewUnavailable,
  requestDeleteRoutine,
  routineDraft,
  routineFilter,
  routineFormError,
  routines,
  routinesBusy,
  routinesError,
  routinesNotice,
  routineTargetLabel,
  saveRoutineDraft,
  selectCalendarDay,
  selectedCalendarDay,
  selectedDayOccurrences,
  stepCalendarMonth,
  subscribeRoutinesChanged,
  toggleRoutineEnabled,
  updateRoutineDraft,
  type CronJobRecord,
  type CronSchedule,
  type RoutineFilter,
  type RoutineReportPolicy,
  type RoutineScheduleKind,
} from "../routinesStore";
import { activeWorkspaceId, deviceContext, sessions, workspaces } from "../state";
import { palette, radii, space, textLineHeight, textSize, textStyle } from "../theme";
import { LibraryToolbar, libraryBodyStyle } from "./LibraryChrome";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import {
  InsetGroup,
  InsetRow,
  MoreMenu,
  STUDIO_TOUCH_MIN,
  StudioBody,
  StudioEmpty,
  StudioHeader,
  StudioSection,
  StudioToolbar,
  studioCompact,
  trackStudioWidth,
} from "../ui/studio";
import {
  ModalDialog,
  SelectDropdown,
  type DropdownMenuItem,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Button,
  ConfigRow,
  ConfigSection,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  PillChip,
  SearchInput,
  SegmentedTabs,
  StatusDot,
  ToggleSwitch,
  TooltipBubble,
  type SegmentedTabOption,
  type StatusDotKind,
} from "../ui/primitives";

function agentOptions(): ReadonlyArray<SelectDropdownOption<string>> {
  return [
    { value: "Standard", label: tr("agents.modeStandard"), description: tr("agents.modeStandardDesc") },
    { value: "Minimal", label: tr("agents.modeMinimal"), description: tr("agents.modeMinimalDesc") },
    { value: "Ultimate", label: tr("agents.modeUltimate"), description: tr("agents.modeUltimateDesc") },
    { value: "Creative", label: tr("agents.modeCreative"), description: tr("agents.modeCreativeDesc") },
  ];
}

function policyOptions(): ReadonlyArray<SelectDropdownOption<RoutineReportPolicy>> {
  return [
    { value: "inherit", label: tr("routines.deliveryInherit") },
    { value: "always", label: tr("routines.deliveryAlways") },
    { value: "conditional", label: tr("routines.deliveryConditional") },
  ];
}

function scheduleKindOptions(): ReadonlyArray<SelectDropdownOption<RoutineScheduleKind>> {
  return [
    { value: "every", label: tr("routines.kindInterval") },
    { value: "cron", label: tr("routines.cronExpression") },
    { value: "at", label: tr("routines.kindAt") },
  ];
}

const EVERY_PRESET_MINUTES: ReadonlyArray<number> = [15, 30, 60, 360, 1440];

function cronPresets(): ReadonlyArray<{ label: string; expr: string }> {
  return [
    { label: tr("routines.presetWeekdays9"), expr: "0 9 * * 1-5" },
    { label: tr("routines.presetDaily8"), expr: "0 8 * * *" },
    { label: tr("routines.presetHourly"), expr: "0 * * * *" },
    { label: tr("routines.presetMon9"), expr: "0 9 * * 1" },
  ];
}

const filterTabOptions = computed<ReadonlyArray<SegmentedTabOption<RoutineFilter>>>(() => [
  { value: "all", label: tr("common.all"), accessibilityLabel: "routines-filter-all" },
  { value: "active", label: tr("common.active"), accessibilityLabel: "routines-filter-active" },
  { value: "paused", label: tr("common.paused"), accessibilityLabel: "routines-filter-paused" },
]);

const workspaceSelectOptions = computed<ReadonlyArray<SelectDropdownOption<string>>>(() =>
  workspaces().map(ws => ({
    value: ws.id,
    label: ws.name || ws.rootPath,
    description: ws.rootPath,
    accessibilityLabel: `routine-workspace-option-${ws.id}`,
  })),
);

function runStatusKind(status: string | null | undefined): StatusDotKind {
  if (status === "error") return "danger";
  if (status === "running") return "accent";
  if (status === "queued") return "warning";
  if (!status || status === "ok") return "success";
  return "muted";
}

function runStatusLabel(status: string | null | undefined): string {
  if (status === "ok") return tr("routines.statusSucceeded");
  if (status === "error") return tr("common.failed");
  if (status === "running") return tr("common.running");
  if (status === "queued") return tr("routines.statusQueued");
  if (status === "cancelled") return tr("common.cancelled");
  return status || tr("routines.statusIdle");
}

/**
 * The editor's schedule line. Validity and run times come from the host's
 * scheduler (`preview_cron_occurrences`); only an empty field is told apart here.
 */
function schedulePreviewLine(kind: RoutineScheduleKind): { valid: boolean; text: string } {
  const draft = routineDraft();
  if (kind === "every" && !draft.everyMinutes.trim()) return { valid: false, text: tr("routines.everyEmptyHint") };
  if (kind === "cron" && !draft.cronExpr.trim()) return { valid: false, text: tr("routines.cronEmptyHint") };
  if (kind === "at" && !draft.atIso.trim()) return { valid: false, text: tr("routines.atEmptyHint") };
  const preview = draftSchedulePreview();
  if (preview.state === "unavailable") return { valid: false, text: tr("routines.previewNeedsHostUpdate") };
  if (preview.state === "idle" || preview.state === "loading") {
    return { valid: true, text: tr("routines.previewChecking") };
  }
  if (preview.state === "invalid") {
    return { valid: false, text: routineIssueText(preview.issueCode, localizeHostError(preview.issueMessage)) };
  }
  const runs = preview.occurrences;
  if (kind === "at") {
    return runs.length > 0
      ? { valid: true, text: tr("routines.runsOnceAt", { time: formatTimestamp(runs[0]) }) }
      : { valid: true, text: tr("routines.previewNoRuns") };
  }
  const head =
    kind === "every"
      ? tr("routines.schedulePreview", {
          summary: formatScheduleSummary({ kind: "every", everyMs: Math.round(Number(draft.everyMinutes.trim()) * 60_000) }),
        })
      : draft.cronTz.trim()
        ? tr("routines.cronValidWithTz", { expr: draft.cronExpr.trim(), tz: draft.cronTz.trim() })
        : tr("routines.cronValidHostTz", { expr: draft.cronExpr.trim() });
  if (runs.length === 0) return { valid: true, text: head };
  return {
    valid: true,
    text: `${head} ${tr("routines.previewNextRuns", { times: runs.map(ms => formatTimestamp(ms)).join(", ") })}`,
  };
}

// --- Presentation-only state (no business logic): a name filter over the host's list, and
// how many rows of a long projection are drawn. ---

/** Free-text filter over the routine names and prompts already loaded. */
const routineQuery = signal("");
/** The next-24-hours list draws this many runs until it is expanded. */
const DUE_ROW_CAP = 5;
const dueExpanded = signal(false);
/** The selected day's runs draw this many rows until expanded. */
const DAY_ROW_CAP = 8;
const dayExpanded = signal(false);
/** The scene's own laid-out width: the calendar sits beside the list only when both fit. */
const routinesWidth = signal(0);
const SIDE_CALENDAR_MIN_WIDTH = 1040;

const visibleRoutines = computed<CronJobRecord[]>(() => {
  const list = filteredRoutines();
  const query = routineQuery().trim().toLowerCase();
  if (!query) return list;
  return list.filter(
    job =>
      job.name.toLowerCase().includes(query) ||
      (job.payload.text ?? "").toLowerCase().includes(query),
  );
});

const visibleDue = computed(() => {
  const all = dueNext24Hours();
  return dueExpanded() ? all : all.slice(0, DUE_ROW_CAP);
});

const visibleDayOccurrences = computed(() => {
  const all = selectedDayOccurrences();
  return dayExpanded() ? all : all.slice(0, DAY_ROW_CAP);
});

function sideCalendar(): boolean {
  const width = routinesWidth();
  if (width > 0) return width >= SIDE_CALENDAR_MIN_WIDTH;
  return !studioCompact();
}

function routineDotKind(job: CronJobRecord): StatusDotKind {
  if (!job.enabled) return "muted";
  return runStatusKind(job.state.lastRunStatus);
}

/** One quiet meta line: next run, last outcome, last finish. */
function routineMetaLine(job: CronJobRecord): string {
  const parts: string[] = [];
  if (job.enabled && job.state.nextRunAtMs) {
    parts.push(tr("routines.nextRun", { time: formatTimestamp(job.state.nextRunAtMs ?? undefined) }));
  }
  if (job.state.lastRunStatus) parts.push(runStatusLabel(job.state.lastRunStatus));
  if (job.state.lastRunFinishedAtMs) {
    parts.push(
      tr("routines.lastFinished", { time: formatTimestamp(job.state.lastRunFinishedAtMs ?? undefined) }),
    );
  }
  return parts.join(" · ");
}

function routineMenuItems(job: CronJobRecord): DropdownMenuItem[] {
  return [
    {
      id: "edit",
      label: tr("routines.editRoutine"),
      icon: "edit",
      accessibilityLabel: `routine-edit-${job.id}`,
      onSelect: () => openEditRoutineDraft(job),
    },
    {
      id: "toggle",
      label: job.enabled ? tr("routines.pauseRoutine") : tr("routines.resumeRoutine"),
      icon: job.enabled ? "pause" : "play",
      accessibilityLabel: `routine-menu-toggle-${job.id}`,
      onSelect: () => void toggleRoutineEnabled(job),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "delete",
      label: tr("routines.deleteRoutine"),
      icon: "trash",
      danger: true,
      accessibilityLabel: `routine-delete-${job.id}`,
      onSelect: () => requestDeleteRoutine(job.id),
    },
  ];
}

/** A run time in a list row's leading column (13 px, tabular, secondary). */
function TimeLabel(props: { label: string }) {
  return (
    <Text
      style={{
        width: 44,
        color: palette().textSecondary,
        fontSize: textSize(13),
        fontVariant: ["tabular-nums"],
        lineHeight: textLineHeight(13, 1.35),
      }}
    >
      {props.label}
    </Text>
  );
}

/**
 * A schedule as words ("Every 30m", "Once: …"). A cron schedule has no words
 * from the host, so its expression is shown as it is, in mono, with no label.
 */
function scheduleText(schedule: CronSchedule): string {
  if (schedule.kind === "cron") return [schedule.expr, schedule.tz].filter(Boolean).join(" · ");
  return formatScheduleSummary(schedule);
}

function ScheduleText(props: { schedule: CronSchedule }) {
  return (
    <Text
      style={{
        ...(props.schedule.kind === "cron" ? textStyle("mono", { color: palette().textMuted }) : textStyle("caption", { tabular: true })),
        flexShrink: 0,
        maxWidth: "60%",
        numberOfLines: 1,
        textOverflow: "ellipsis",
      }}
    >
      {scheduleText(props.schedule)}
    </Text>
  );
}

/**
 * One routine in the inset grouped list. The text area opens the editor; the
 * switch and the "…" menu sit beside it (siblings, never nested presses).
 */
function RoutineRow(props: { job: () => CronJobRecord; first: boolean }) {
  return (
    <View
      style={{
        position: "relative",
        minWidth: 0,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
    >
      <If when={!props.first}>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 16,
            right: 0,
            height: 1,
            backgroundColor: palette().borderSubtle,
            pointerEvents: "none",
          }}
        />
      </If>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: STUDIO_TOUCH_MIN,
          paddingLeft: 16,
          paddingRight: 12,
          paddingVertical: 10,
          minWidth: 0,
        }}
      >
        <View style={{ alignSelf: "flex-start", paddingTop: 7 }}>
          <StatusDot
            kind={routineDotKind(props.job())}
            size={7}
            pulse={props.job().enabled && props.job().state.lastRunStatus === "running"}
          />
        </View>
        <View
          role="button"
          accessibilityLabel={`routine-open-${props.job().id}`}
          onPress={() => openEditRoutineDraft(props.job())}
          style={{ flex: 1, minWidth: 0, gap: 2, cursor: "pointer", borderRadius: radii.xs }}
          focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: 2 }}
        >
          <Text
            style={{
              color: props.job().enabled ? palette().text : palette().textSecondary,
              fontSize: textSize(14),
              fontWeight: "500",
              lineHeight: textLineHeight(14, 1.35),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.job().name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", minWidth: 0, gap: space.xs }}>
            <ScheduleText schedule={props.job().schedule} />
            <Text style={{ ...textStyle("caption", { tabular: true }), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
              {`· ${routineTargetLabel(props.job())}`}
            </Text>
          </View>
          <If when={props.job().payload.text ?? ""}>
            {text => (
              <Text
                style={{
                  marginTop: 2,
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.45),
                  numberOfLines: 2,
                  textOverflow: "ellipsis",
                }}
              >
                {text()}
              </Text>
            )}
          </If>
          <If when={routineMetaLine(props.job())}>
            {meta => (
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  fontVariant: ["tabular-nums"],
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {meta()}
              </Text>
            )}
          </If>
          <If when={props.job().state.lastError ?? ""}>
            {err => (
              <Text
                style={{
                  color: palette().danger,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {localizeHostError(err())}
              </Text>
            )}
          </If>
        </View>
        <ToggleSwitch
          value={props.job().enabled}
          accessibilityLabel={`routine-toggle-${props.job().id}`}
          onChange={() => void toggleRoutineEnabled(props.job())}
        />
        <MoreMenu
          accessibilityLabel={`routine-more-${props.job().id}`}
          tooltip={tr("routines.routineActions")}
          minWidth={184}
          items={routineMenuItems(props.job())}
        />
      </View>
      <If when={confirmingDeleteRoutineId() === props.job().id}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <InlineConfirmBar
            danger
            message={tr("routines.deleteConfirm", { name: props.job().name })}
            confirmLabel={tr("routines.deleteRoutine")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void confirmDeleteRoutine(props.job().id)}
            onCancel={() => cancelDeleteRoutine()}
          />
        </View>
      </If>
    </View>
  );
}

/** Quiet "Show all N" / "Show less" link under a capped list. */
function ExpandLink(props: { total: number; cap: number; expanded: boolean; onToggle: () => void; accessibilityLabel: string }) {
  return (
    <If when={props.total > props.cap}>
      <View
        role="button"
        accessibilityLabel={props.accessibilityLabel}
        onPress={props.onToggle}
        style={{
          alignSelf: "flex-start",
          marginTop: 8,
          paddingHorizontal: 4,
          minHeight: 28,
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Text style={{ color: palette().accent, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.35) }}>
          {props.expanded ? tr("common.showLess") : `${tr("common.showAll")} (${props.total})`}
        </Text>
      </View>
    </If>
  );
}

function DueSection() {
  return (
    <StudioSection
      title={tr("routines.polish.dueSection")}
      accessibilityLabel="routines-due-section"
    >
      <If when={routinePreviewUnavailable()}>
        <Text
          accessibilityLabel="routines-preview-unavailable"
          style={{
            paddingHorizontal: 4,
            paddingBottom: 6,
            color: palette().warning,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.4),
          }}
        >
          {tr("routines.previewNeedsHostUpdate")}
        </Text>
      </If>
      <If
        when={dueNext24Hours().length > 0}
        else={
          <Text
            style={{
              paddingHorizontal: 4,
              color: palette().textMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.45),
            }}
          >
            {tr("routines.noneDueNext24h")}
          </Text>
        }
      >
        <InsetGroup>
          <Each of={visibleDue()} key={item => `due:${item.job.id}:${item.atMs}`}>
            {(item, index) => (
              <InsetRow
                first={index() === 0}
                leading={<TimeLabel label={item().timeLabel} />}
                label={item().job.name}
                detail={`${scheduleText(item().job.schedule)} · ${routineTargetLabel(item().job)}`}
                chevron
                accessibilityLabel={`routine-due-${item().job.id}-${item().atMs}`}
                onPress={() => openEditRoutineDraft(item().job)}
              />
            )}
          </Each>
        </InsetGroup>
        <ExpandLink
          total={dueNext24Hours().length}
          cap={DUE_ROW_CAP}
          expanded={dueExpanded()}
          accessibilityLabel="routines-due-expand"
          onToggle={() => dueExpanded.update(open => !open)}
        />
      </If>
    </StudioSection>
  );
}

function RoutineListSection() {
  return (
    <StudioSection
      title={tr("routines.polish.listSection")}
      trailing={
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(13, 1.35),
          }}
        >
          {tr("routines.activeCount", { count: activeRoutineCount() })}
        </Text>
      }
    >
      <If
        when={visibleRoutines().length > 0}
        else={
          <StudioEmpty
            icon="calendar"
            message={routines().length === 0 ? tr("routines.emptyTitle") : tr("routines.emptyFilteredTitle")}
            detail={routines().length === 0 ? tr("routines.emptySubtitle") : tr("routines.emptyFilteredSubtitle")}
            action={
              <Button
                label={routines().length === 0 ? tr("routines.newRoutine") : tr("routines.showAllRoutines")}
                variant="secondary"
                size="md"
                accessibilityLabel="routines-empty-action"
                onPress={() => {
                  if (routines().length === 0) openCreateRoutineDraft();
                  else {
                    routineFilter.set("all");
                    routineQuery.set("");
                  }
                }}
              />
            }
          />
        }
      >
        <InsetGroup accessibilityLabel="routines-list">
          <Each of={visibleRoutines()} key={job => job.id}>
            {(job, index) => <RoutineRow job={job} first={index() === 0} />}
          </Each>
        </InsetGroup>
      </If>
    </StudioSection>
  );
}

function CalendarGrid() {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
        <Each of={weekdayShortLabels(true)} key="index">
          {(day, idx) => (
            <View style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text
                style={{
                  color: idx() >= 5 ? palette().textMuted : palette().textSecondary,
                  fontSize: textSize(11),
                  fontWeight: "500",
                  lineHeight: textLineHeight(11, 1.3),
                }}
              >
                {day()}
              </Text>
            </View>
          )}
        </Each>
      </View>
      <View style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
        <Each of={calendarCells()} key={cell => cell.dayKey}>
          {cell => (
            <View
              role="button"
              accessibilityLabel={`routines-day-${cell().dayKey}`}
              accessibilityState={{ selected: cell().isSelected }}
              tooltip={
                cell().occurrenceCount > 0 ? (
                  <TooltipBubble
                    text={`${cell().dayKey} · ${formatPlural(
                      cell().occurrenceCount,
                      "format.occurrenceOne",
                      "format.occurrenceOther",
                    )}`}
                  />
                ) : undefined
              }
              onPress={() => {
                dayExpanded.set(false);
                selectCalendarDay(cell().dayKey);
              }}
              style={{
                minWidth: 0,
                height: studioCompact() ? STUDIO_TOUCH_MIN : 38,
                borderRadius: radii.sm,
                borderCurve: "continuous",
                backgroundColor: cell().isSelected ? palette().accentSoft : "transparent",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                cursor: "pointer",
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{
                backgroundColor: cell().isSelected ? palette().accentSoft : palette().panelHover,
              }}
              focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -1 }}
            >
              <Text
                style={{
                  color: cell().isSelected || cell().isToday
                    ? palette().accent
                    : cell().inCurrentMonth
                      ? palette().text
                      : palette().textMuted,
                  fontSize: textSize(13),
                  fontWeight: cell().isToday || cell().isSelected ? "600" : "400",
                  fontVariant: ["tabular-nums"],
                  lineHeight: textLineHeight(13, 1.2),
                }}
              >
                {String(cell().dayNumber)}
              </Text>
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: radii.pill,
                  backgroundColor:
                    cell().occurrenceCount > 0
                      ? cell().isSelected
                        ? palette().accent
                        : palette().textMuted
                      : "transparent",
                }}
              />
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}

/** Month grid plus the selected day's projected runs; no surrounding card. */
function CalendarBlock() {
  return (
    <View style={{ gap: 20, minWidth: 0 }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, paddingHorizontal: 4 }}>
          <Text
            role="header"
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(15),
              fontWeight: "600",
              lineHeight: textLineHeight(15, 1.3),
              numberOfLines: 1,
            }}
          >
            {formatMonthYear(calendarYear(), calendarMonth())}
          </Text>
          <IconButton
            icon="chevron-left"
            size="sm"
            accessibilityLabel="routines-cal-prev"
            tooltip={tr("routines.prevMonth")}
            onPress={() => stepCalendarMonth(-1)}
          />
          <Button
            label={tr("common.today")}
            size="sm"
            variant="ghost"
            accessibilityLabel="routines-cal-today"
            onPress={() => jumpCalendarToday()}
          />
          <IconButton
            icon="chevron-right"
            size="sm"
            accessibilityLabel="routines-cal-next"
            tooltip={tr("routines.nextMonth")}
            onPress={() => stepCalendarMonth(1)}
          />
        </View>
        <CalendarGrid />
        <Text
          style={{
            paddingHorizontal: 4,
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.4),
          }}
        >
          {tr("routines.tapDateHint")}
        </Text>
      </View>

      <View style={{ gap: 8, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4 }}>
          <Text
            role="header"
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(13, 1.35),
            }}
          >
            {tr("routines.scheduledFor", { date: selectedCalendarDay() })}
          </Text>
          <Text
            style={{
              flexShrink: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {formatPlural(selectedDayOccurrences().length, "format.occurrenceOne", "format.occurrenceOther")}
          </Text>
        </View>
        <If
          when={selectedDayOccurrences().length > 0}
          else={
            <Text
              style={{
                paddingHorizontal: 4,
                color: palette().textMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
              }}
            >
              {tr("routines.noRunsOnDate")}
            </Text>
          }
        >
          <InsetGroup>
            <Each of={visibleDayOccurrences()} key={occ => `${occ.job.id}:${occ.atMs}`}>
              {(occ, index) => (
                <InsetRow
                  first={index() === 0}
                  leading={<TimeLabel label={occ().timeLabel} />}
                  label={occ().job.name}
                  detail={routineTargetLabel(occ().job)}
                  chevron
                  onPress={() => openEditRoutineDraft(occ().job)}
                />
              )}
            </Each>
          </InsetGroup>
          <ExpandLink
            total={selectedDayOccurrences().length}
            cap={DAY_ROW_CAP}
            expanded={dayExpanded()}
            accessibilityLabel="routines-day-expand"
            onToggle={() => dayExpanded.update(open => !open)}
          />
        </If>
      </View>
    </View>
  );
}

function RoutineEditorModal() {
  const everyCheck = () => schedulePreviewLine("every");
  const cronCheck = () => schedulePreviewLine("cron");
  const atCheck = () => schedulePreviewLine("at");

  return (
    <ModalDialog
      open={editorOpen()}
      title={routineDraft().editingJobId ? tr("routines.editModalTitle") : tr("routines.newRoutine")}
      subtitle={tr("routines.modalSubtitle")}
      size="md"
      onClose={() => closeRoutineEditor()}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            onPress={() => closeRoutineEditor()}
          />
          <Button
            label={tr("routines.saveRoutine")}
            variant="primary"
            size="md"
            leadingIcon="calendar"
            loading={routinesBusy()}
            disabled={routinesBusy()}
            accessibilityLabel="routine-save"
            onPress={() => void saveRoutineDraft()}
          />
        </View>
      }
    >
      <View style={{ gap: 18 }}>
        <If when={routineFormError()}>
          {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
        </If>

        <ConfigSection title={tr("routines.routinePrompt")}>
          <View style={{ gap: 12 }}>
            <InputBox
              label={tr("routines.routineName")}
              size="md"
              value={routineDraft().name}
              placeholder={tr("routines.routineNamePlaceholder")}
              accessibilityLabel="routine-name-input"
              onChange={name => updateRoutineDraft({ name })}
            />
            <InputBox
              label={tr("routines.promptInstruction")}
              multiline
              minHeight={84}
              value={routineDraft().prompt}
              placeholder={tr("routines.promptPlaceholder")}
              accessibilityLabel="routine-prompt-input"
              onChange={prompt => updateRoutineDraft({ prompt })}
            />
          </View>
        </ConfigSection>

        <ConfigSection title={tr("routines.schedule")}>
          <View style={{ gap: 12 }}>
            <View style={{ gap: 5 }}>
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(12),
                  fontWeight: "500",
                  lineHeight: textLineHeight(12, 1.35),
                }}
              >
                {tr("routines.scheduleKind")}
              </Text>
              <SelectDropdown
                size="md"
                options={scheduleKindOptions()}
                value={routineDraft().scheduleKind}
                accessibilityLabel="routine-schedule-kind"
                style={{ width: "100%" }}
                onChange={kind => updateRoutineDraft({ scheduleKind: kind })}
              />
            </View>

            <If when={routineDraft().scheduleKind === "every"}>
              <View style={{ gap: 8 }}>
                <InputBox
                  label={tr("routines.intervalMinutes")}
                  size="md"
                  monospace
                  value={routineDraft().everyMinutes}
                  placeholder="30"
                  accessibilityLabel="routine-every-minutes"
                  onChange={everyMinutes => updateRoutineDraft({ everyMinutes })}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Each of={EVERY_PRESET_MINUTES} key={mins => String(mins)}>
                    {mins => (
                      <PillChip
                        label={formatDuration(mins() * 60_000)}
                        active={routineDraft().everyMinutes.trim() === String(mins())}
                        onPress={() => updateRoutineDraft({ everyMinutes: String(mins()) })}
                      />
                    )}
                  </Each>
                </View>
                <Text
                  style={{
                    color: everyCheck().valid ? palette().textMuted : palette().danger,
                    fontSize: textSize(12),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(12, 1.4),
                  }}
                >
                  {everyCheck().text}
                </Text>
              </View>
            </If>

            <If when={routineDraft().scheduleKind === "cron"}>
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <InputBox
                    label={tr("routines.cronExpression")}
                    size="md"
                    monospace
                    value={routineDraft().cronExpr}
                    placeholder="0 9 * * 1-5"
                    accessibilityLabel="routine-cron-expr"
                    style={{ flex: 2, minWidth: 180 }}
                    onChange={cronExpr => updateRoutineDraft({ cronExpr })}
                  />
                  <InputBox
                    label={tr("routines.timezoneOptional")}
                    size="md"
                    monospace
                    value={routineDraft().cronTz}
                    placeholder="UTC"
                    accessibilityLabel="routine-cron-tz"
                    style={{ flex: 1, minWidth: 110 }}
                    onChange={cronTz => updateRoutineDraft({ cronTz })}
                  />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Each of={cronPresets()} key={p => p.expr}>
                    {preset => (
                      <PillChip
                        label={preset().label}
                        active={routineDraft().cronExpr.trim() === preset().expr}
                        onPress={() => updateRoutineDraft({ cronExpr: preset().expr })}
                      />
                    )}
                  </Each>
                </View>
                <Text
                  style={{
                    color: cronCheck().valid ? palette().textMuted : palette().warning,
                    fontSize: textSize(12),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(12, 1.4),
                  }}
                >
                  {cronCheck().text}
                </Text>
              </View>
            </If>

            <If when={routineDraft().scheduleKind === "at"}>
              <View style={{ gap: 6 }}>
                <InputBox
                  label={tr("routines.runOnceAt")}
                  size="md"
                  monospace
                  value={routineDraft().atIso}
                  placeholder="2026-11-20T09:00:00Z"
                  accessibilityLabel="routine-at-iso"
                  onChange={atIso => updateRoutineDraft({ atIso })}
                />
                <Text
                  style={{
                    color: atCheck().valid ? palette().textMuted : palette().warning,
                    fontSize: textSize(12),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(12, 1.4),
                  }}
                >
                  {atCheck().text}
                </Text>
              </View>
            </If>
          </View>
        </ConfigSection>

        <ConfigSection title={tr("routines.targetDelivery")} flush controlWidth={220}>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 14,
              gap: 12,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <If
              when={Boolean(routineDraft().preservedTarget)}
              else={
                <View style={{ gap: 10 }}>
                <SegmentedTabs
                  size="sm"
                  value={routineDraft().targetKind ?? "workspace"}
                  options={[
                    { value: "workspace", label: tr("routines.targetNewSession"), accessibilityLabel: "routine-target-workspace" },
                    { value: "session", label: tr("routines.targetExistingSession"), accessibilityLabel: "routine-target-session" },
                  ]}
                  onChange={kind => updateRoutineDraft({ targetKind: kind })}
                />
                <View style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 160, gap: 5 }}>
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(12),
                        fontWeight: "500",
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      {tr("routines.targetWorkspace")}
                    </Text>
                    <SelectDropdown
                      size="md"
                      options={workspaceSelectOptions()}
                      value={routineDraft().workspaceId}
                      placeholder={tr("routines.selectWorkspace")}
                      accessibilityLabel="routine-workspace-select"
                      style={{ width: "100%" }}
                      onChange={wsId => updateRoutineDraft({ workspaceId: wsId })}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 160, gap: 5 }}>
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(12),
                        fontWeight: "500",
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      {(routineDraft().targetKind ?? "workspace") === "session"
                        ? tr("routines.targetSessionLabel")
                        : tr("routines.agentMode")}
                    </Text>
                    <If
                      when={(routineDraft().targetKind ?? "workspace") === "session"}
                      else={
                        <SelectDropdown
                          size="md"
                          options={agentOptions()}
                          value={routineDraft().agentType}
                          accessibilityLabel="routine-agent-select"
                          style={{ width: "100%" }}
                          onChange={agentType => updateRoutineDraft({ agentType })}
                        />
                      }
                    >
                      <SelectDropdown
                        size="md"
                        searchable
                        options={routineSessionOptions()}
                        value={routineDraft().sessionId || null}
                        placeholder={tr("routines.selectSession")}
                        emptyLabel={tr("routines.sessionsOtherWorkspace")}
                        accessibilityLabel="routine-session-select"
                        style={{ width: "100%" }}
                        onChange={sessionId => updateRoutineDraft({ sessionId })}
                      />
                    </If>
                  </View>
                </View>
                </View>
              }
            >
              <InlineBanner
                tone="neutral"
                icon="pin"
                title={tr("routines.pinnedSessionPreserved")}
                message={tr("routines.pinnedSessionHint")}
              />
            </If>

            <View style={{ gap: 8 }}>
              <View style={{ gap: 5 }}>
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    fontWeight: "500",
                    lineHeight: textLineHeight(12, 1.35),
                  }}
                >
                  {tr("routines.deliveryTitle")}
                </Text>
                <SelectDropdown
                  size="md"
                  options={policyOptions()}
                  value={routineDraft().reportPolicy}
                  accessibilityLabel="routine-policy-select"
                  style={{ width: "100%" }}
                  onChange={reportPolicy => updateRoutineDraft({ reportPolicy })}
                />
              </View>
            </View>
          </View>

          <ConfigRow
            label={tr("routines.enabledOnSchedule")}
            description={tr("routines.enabledOnScheduleHint")}
            divider={false}
          >
            <ToggleSwitch
              value={routineDraft().enabled}
              onChange={enabled => updateRoutineDraft({ enabled })}
              accessibilityLabel="routine-draft-enabled"
            />
          </ConfigRow>
        </ConfigSection>
      </View>
    </ModalDialog>
  );
}

/**
 * Sessions a routine can run in. The session list belongs to the active
 * workspace, so another workspace's sessions are offered only after switching.
 */
function routineSessionOptions(): SelectDropdownOption<string>[] {
  if (routineDraft().workspaceId !== activeWorkspaceId()) return [];
  return sessions().map(session => ({
    value: session.sessionId,
    label: session.sessionName || session.sessionId,
    accessibilityLabel: `routine-session-option-${session.sessionId}`,
  }));
}

function RoutinesBody(props: { embedded?: boolean }) {
  return (
    <StudioBody style={props.embedded ? libraryBodyStyle() : undefined}>
      <If when={routinesError()}>
        {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
      </If>
      <If when={routinesNotice() && !routinesError()}>
        <InlineBanner
          tone="success"
          message={routinesNotice() ?? ""}
          onDismiss={() => routinesNotice.set("")}
        />
      </If>

      <If when={routines().length > 0}>
        <DueSection />
      </If>

      <RoutineListSection />

      <If when={!sideCalendar()}>
        <StudioSection title={tr("routines.polish.calendarSection")}>
          <CalendarBlock />
        </StudioSection>
      </If>
    </StudioBody>
  );
}

export function RoutinesScene(props: { embedded?: boolean }) {
  const refreshControls = () => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <If when={routinesBusy()}>
        <Spinner size={14} />
      </If>
      <IconButton
        icon="refresh"
        size="md"
        accessibilityLabel="routines-refresh"
        tooltip={tr("routines.refreshTooltip")}
        disabled={routinesBusy()}
        onPress={() => void loadRoutines()}
      />
    </View>
  );
  const newButton = () => (
    <Button
      label={tr("routines.newRoutine")}
      variant="primary"
      size="md"
      leadingIcon="plus"
      accessibilityLabel="routines-new"
      onPress={() => openCreateRoutineDraft()}
    />
  );
  const filterTabs = () => (
    <SegmentedTabs size="sm" options={filterTabOptions()} value={routineFilter()} onChange={next => routineFilter.set(next)} />
  );
  const searchField = () => (
    <SearchInput
      size="md"
      value={routineQuery()}
      placeholder={tr("routines.polish.searchPlaceholder")}
      accessibilityLabel="routines-search-input"
      style={{ flex: 1, minWidth: 160, maxWidth: studioCompact() ? undefined : 240 }}
      onChange={value => routineQuery.set(value)}
    />
  );
  effect(() => {
    // The device the Library looks at (fleet) or the driven peer (older backends).
    const scopeKey = `local:${deviceContext()}`;
    void scopeKey;
    ensureCronHostReady();
    void loadRoutines();
  });

  cleanup(subscribeRoutinesChanged());

  return (
    <View
      onLayout={event => {
        trackStudioWidth(event);
        const width = Math.round(event.bounds.size.width);
        if (width > 0) routinesWidth.set(width);
      }}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row", backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <If
          when={props.embedded}
          else={
            <StudioHeader
              title={tr("routines.title")}
              subtitle={tr("routines.subtitle")}
              actions={
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  {refreshControls()}
                  {newButton()}
                </View>
              }
              extra={<StudioToolbar leading={filterTabs()} trailing={searchField()} />}
            />
          }
        >
          <LibraryToolbar
            accessibilityLabel="routines-toolbar"
            leading={
              <>
                {filterTabs()}
                {searchField()}
                {refreshControls()}
              </>
            }
            primary={newButton()}
          />
        </If>
        <RoutinesBody embedded={props.embedded} />
      </Scroll>

      <If when={sideCalendar()}>
        <Scroll
          accessibilityLabel="routines-calendar-panel"
          style={{
            width: 340,
            flexShrink: 0,
            minHeight: 0,
            borderLeftWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
          contentStyle={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 }}
        >
          <CalendarBlock />
        </Scroll>
      </If>

      <RoutineEditorModal />
    </View>
  );
}

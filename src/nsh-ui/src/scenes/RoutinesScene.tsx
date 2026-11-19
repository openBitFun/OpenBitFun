import { cleanup, computed, effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import {
  formatCount,
  formatDuration,
  formatMonthYear,
  formatPlural,
  formatTimestamp,
  weekdayShortLabels,
} from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope } from "../peerState";
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
  parseCronExpression,
  requestDeleteRoutine,
  routineDraft,
  routineFilter,
  routineFormError,
  routinePeerDeliveryNotice,
  routineReportPolicySupported,
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
  type RoutineFilter,
  type RoutineReportPolicy,
  type RoutineScheduleKind,
} from "../routinesStore";
import { workspaces } from "../state";
import { fontMono, palette, radii, textLineHeight, textSize, textTracking } from "../theme";
import { Icon } from "../ui/icons";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  type DropdownMenuItem,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Badge,
  Button,
  ConfigRow,
  ConfigSection,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  PillChip,
  SectionCard,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
  TooltipBubble,
  type SegmentedTabOption,
  type StatusPillKind,
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
  { value: "all", label: tr("common.all"), badge: routines().length },
  { value: "active", label: tr("common.active"), badge: activeRoutineCount() },
  {
    value: "paused",
    label: tr("common.paused"),
    badge: Math.max(0, routines().length - activeRoutineCount()),
  },
]);

const workspaceSelectOptions = computed<ReadonlyArray<SelectDropdownOption<string>>>(() =>
  workspaces().map(ws => ({
    value: ws.id,
    label: ws.name || ws.rootPath,
    description: ws.rootPath,
    accessibilityLabel: `routine-workspace-option-${ws.id}`,
  })),
);

function runStatusKind(status: string | null | undefined): StatusPillKind {
  if (status === "ok") return "success";
  if (status === "error") return "danger";
  if (status === "running") return "accent";
  if (status === "queued") return "warning";
  return "neutral";
}

function runStatusLabel(status: string | null | undefined): string {
  if (status === "ok") return tr("routines.statusSucceeded");
  if (status === "error") return tr("common.failed");
  if (status === "running") return tr("common.running");
  if (status === "queued") return tr("routines.statusQueued");
  if (status === "cancelled") return tr("common.cancelled");
  return status || tr("routines.statusIdle");
}

function inlineEveryPreview(minutesRaw: string): { valid: boolean; text: string } {
  const trimmed = minutesRaw.trim();
  if (!trimmed) return { valid: false, text: tr("routines.everyEmptyHint") };
  const mins = Number(trimmed);
  if (!Number.isFinite(mins) || mins <= 0) {
    return { valid: false, text: tr("routines.everyInvalidHint") };
  }
  const summary = formatScheduleSummary({ kind: "every", everyMs: Math.round(mins * 60_000) });
  return { valid: true, text: tr("routines.schedulePreview", { summary }) };
}

function inlineCronPreview(exprRaw: string, tzRaw: string): { valid: boolean; text: string } {
  const expr = exprRaw.trim();
  if (!expr) return { valid: false, text: tr("routines.cronEmptyHint") };
  const parsed = parseCronExpression(expr);
  if (!parsed) {
    return { valid: false, text: tr("routines.cronInvalidHint") };
  }
  const tz = tzRaw.trim();
  return {
    valid: true,
    text: tz
      ? tr("routines.cronValidWithTz", { expr, tz })
      : tr("routines.cronValidHostTz", { expr }),
  };
}

function inlineAtPreview(isoRaw: string): { valid: boolean; text: string } {
  const trimmed = isoRaw.trim();
  if (!trimmed) return { valid: false, text: tr("routines.atEmptyHint") };
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { valid: false, text: tr("routines.atInvalidHint") };
  }
  return { valid: true, text: tr("routines.runsOnceAt", { time: formatTimestamp(ms) }) };
}

function ScheduleMonoBadge(props: { label: string; active?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        maxWidth: "100%",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2.5,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceSubtle,
      }}
    >
      <Icon
        name="clock"
        size={11}
        color={props.active ? palette().accent : palette().textMuted}
      />
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: props.active ? palette().textSecondary : palette().textMuted,
          fontFamily: fontMono,
          fontSize: textSize(10.5),
          fontWeight: "500",
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(10.5, 1.32),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function Due24hCard(props: {
  item: () => { job: CronJobRecord; atMs: number; timeLabel: string };
}) {
  return (
    <View
      role="button"
      onPress={() => openEditRoutineDraft(props.item().job)}
      style={{
        minWidth: 0,
        paddingHorizontal: 13,
        paddingVertical: 11,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceTertiary,
        boxShadow: palette().innerHighlight,
        gap: 4,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: palette().borderStrong,
      }}
      activeStyle={tactileActiveStyle(0.98)}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().borderFocus,
        outlineOffset: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
        <StatusDot kind="accent" size={5.5} />
        <Text
          style={{
            flexShrink: 0,
            color: palette().accent,
            fontFamily: fontMono,
            fontSize: textSize(11.5),
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(11.5, 1.3),
          }}
        >
          {props.item().timeLabel}
        </Text>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().text,
            fontSize: textSize(12.5),
            fontWeight: "600",
            lineHeight: textLineHeight(12.5, 1.32),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.item().job.name}
        </Text>
      </View>
      <Text
        style={{
          minWidth: 0,
          color: palette().textMuted,
          fontSize: textSize(11.5),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(11.5, 1.38),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {`${formatScheduleSummary(props.item().job.schedule)} · ${routineTargetLabel(props.item().job)}`}
      </Text>
    </View>
  );
}

function RoutineCard(props: { job: () => CronJobRecord }) {
  const menuOpen = signal(false);
  const anchorRef = signal<ViewRef | null>(null);

  const menuItems = (): DropdownMenuItem[] => [
    {
      id: "edit",
      label: tr("routines.editRoutine"),
      icon: "edit",
      accessibilityLabel: `routine-edit-${props.job().id}`,
      onSelect: () => openEditRoutineDraft(props.job()),
    },
    {
      id: "toggle",
      label: props.job().enabled ? tr("routines.pauseRoutine") : tr("routines.resumeRoutine"),
      icon: props.job().enabled ? "pause" : "play",
      accessibilityLabel: `routine-menu-toggle-${props.job().id}`,
      onSelect: () => void toggleRoutineEnabled(props.job()),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "delete",
      label: tr("routines.deleteRoutine"),
      icon: "trash",
      danger: true,
      accessibilityLabel: `routine-delete-${props.job().id}`,
      onSelect: () => requestDeleteRoutine(props.job().id),
    },
  ];

  return (
    <View
      style={{
        minWidth: 0,
        minHeight: 76,
        padding: 18,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.job().enabled ? palette().border : palette().borderSubtle,
        backgroundColor: props.job().enabled ? palette().panelRaised : palette().surfaceTertiary,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        gap: 11,
        opacity: props.job().enabled ? 1 : 0.72,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        borderColor: palette().borderStrong,
        backgroundColor: palette().panelHover,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
            <If when={props.job().enabled && !props.job().state.lastRunStatus}>
              <StatusDot kind="success" size={6} />
            </If>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(14),
                fontWeight: "600",
                letterSpacing: textTracking(14),
                lineHeight: textLineHeight(14, 1.3),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.job().name}
            </Text>
            <If when={Boolean(props.job().state.lastRunStatus)}>
              <StatusPill
                label={runStatusLabel(props.job().state.lastRunStatus)}
                kind={runStatusKind(props.job().state.lastRunStatus)}
                pulse={props.job().state.lastRunStatus === "running"}
              />
            </If>
            <If when={!props.job().enabled}>
              <Badge label={tr("common.paused")} tone="neutral" />
            </If>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
            <ScheduleMonoBadge
              label={formatScheduleSummary(props.job().schedule)}
              active={props.job().enabled}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1, minWidth: 96 }}>
              <Icon
                name={props.job().target.kind === "session" ? "pin" : "folder"}
                size={11.5}
                color={palette().textMuted}
              />
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
                {routineTargetLabel(props.job())}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ToggleSwitch
            value={props.job().enabled}
            accessibilityLabel={`routine-toggle-${props.job().id}`}
            onChange={() => void toggleRoutineEnabled(props.job())}
          />
          <View ref={el => anchorRef.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={menuOpen()}
              accessibilityLabel={`routine-more-${props.job().id}`}
              tooltip={tr("routines.routineActions")}
              onPress={() => menuOpen.update(open => !open)}
            />
          </View>
        </View>
      </View>

      <Text
        style={{
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(12.5),
          lineHeight: textLineHeight(12.5, 1.5),
          numberOfLines: 2,
          textOverflow: "ellipsis",
        }}
      >
        {props.job().payload.text}
      </Text>

      <If
        when={Boolean(
          (props.job().state.nextRunAtMs && props.job().enabled) ||
            props.job().state.lastRunFinishedAtMs,
        )}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            paddingTop: 10,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <If when={Boolean(props.job().state.nextRunAtMs && props.job().enabled)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
              <Icon name="calendar" size={11.5} color={palette().textMuted} />
              <Text
                style={{
                  minWidth: 0,
                  color: palette().textMuted,
                  fontSize: textSize(11.5),
                  fontVariant: ["tabular-nums"],
                  lineHeight: textLineHeight(11.5, 1.35),
                }}
              >
                {tr("routines.nextRun", {
                  time: formatTimestamp(props.job().state.nextRunAtMs ?? undefined),
                })}
              </Text>
            </View>
          </If>
          <If when={Boolean(props.job().state.lastRunFinishedAtMs)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
              <Icon name="history" size={11.5} color={palette().textMuted} />
              <Text
                style={{
                  minWidth: 0,
                  color: palette().textMuted,
                  fontSize: textSize(11.5),
                  fontVariant: ["tabular-nums"],
                  lineHeight: textLineHeight(11.5, 1.35),
                }}
              >
                {tr("routines.lastFinished", {
                  time: formatTimestamp(props.job().state.lastRunFinishedAtMs ?? undefined),
                })}
              </Text>
            </View>
          </If>
        </View>
      </If>

      <If when={props.job().state.lastError ?? ""}>
        {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
      </If>

      <If when={confirmingDeleteRoutineId() === props.job().id}>
        <InlineConfirmBar
          danger
          message={tr("routines.deleteConfirm", { name: props.job().name })}
          confirmLabel={tr("routines.deleteRoutine")}
          cancelLabel={tr("common.cancel")}
          onConfirm={() => void confirmDeleteRoutine(props.job().id)}
          onCancel={() => cancelDeleteRoutine()}
        />
      </If>

      <DropdownMenu
        open={menuOpen()}
        anchor={anchorRef()}
        align="end"
        minWidth={184}
        items={menuItems()}
        onClose={() => menuOpen.set(false)}
      />
    </View>
  );
}

function RoutineEditorModal() {
  const everyCheck = () => inlineEveryPreview(routineDraft().everyMinutes);
  const cronCheck = () => inlineCronPreview(routineDraft().cronExpr, routineDraft().cronTz);
  const atCheck = () => inlineAtPreview(routineDraft().atIso);

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
                    fontSize: textSize(11.5),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11.5, 1.4),
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
                    fontSize: textSize(11.5),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11.5, 1.4),
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
                    fontSize: textSize(11.5),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11.5, 1.4),
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
                      {tr("routines.agentMode")}
                    </Text>
                    <SelectDropdown
                      size="md"
                      options={agentOptions()}
                      value={routineDraft().agentType}
                      accessibilityLabel="routine-agent-select"
                      style={{ width: "100%" }}
                      onChange={agentType => updateRoutineDraft({ agentType })}
                    />
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
                  disabled={!routineReportPolicySupported()}
                  accessibilityLabel="routine-policy-select"
                  style={{ width: "100%" }}
                  onChange={reportPolicy => updateRoutineDraft({ reportPolicy })}
                />
              </View>
              <If when={routinePeerDeliveryNotice()}>
                {notice => <InlineBanner tone="warning" message={notice()} />}
              </If>
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

function CalendarPanel() {
  return (
    <View
      style={{
        width: 344,
        flexShrink: 0,
        minHeight: 0,
        padding: 16,
        gap: 14,
        flexDirection: "column",
        borderLeftWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      {/* Fixed Month Calendar Card — Apple/Linear calm dot indicators, zero blue count spam */}
      <SectionCard
        title={formatMonthYear(calendarYear(), calendarMonth())}
        subtitle={tr("routines.tapDateHint")}
        style={{ flexShrink: 0, padding: 14, gap: 10 }}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <IconButton
              icon="chevron-left"
              size="xs"
              accessibilityLabel="routines-cal-prev"
              tooltip={tr("routines.prevMonth")}
              onPress={() => stepCalendarMonth(-1)}
            />
            <Button
              label={tr("common.today")}
              size="xs"
              variant="ghost"
              accessibilityLabel="routines-cal-today"
              onPress={() => jumpCalendarToday()}
            />
            <IconButton
              icon="chevron-right"
              size="xs"
              accessibilityLabel="routines-cal-next"
              tooltip={tr("routines.nextMonth")}
              onPress={() => stepCalendarMonth(1)}
            />
          </View>
        }
      >
        {/* 7-column localized Mon–Sun Weekday Header */}
        <View
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 4,
          }}
        >
          <Each of={weekdayShortLabels(true)} key="index">
            {(day, idx) => (
              <View style={{ alignItems: "center", paddingVertical: 2 }}>
                <Text
                  style={{
                    color: idx() >= 5 ? palette().textMuted : palette().textSecondary,
                    fontSize: textSize(10.5),
                    fontWeight: "600",
                    letterSpacing: textTracking(10.5, true),
                    lineHeight: textLineHeight(10.5, 1.3),
                  }}
                >
                  {day()}
                </Text>
              </View>
            )}
          </Each>
        </View>

        {/* 7-column Month Grid */}
        <View
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 4,
          }}
        >
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
                onPress={() => selectCalendarDay(cell().dayKey)}
                style={{
                  minWidth: 0,
                  height: 36,
                  paddingVertical: 3,
                  paddingHorizontal: 2,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: cell().isSelected ? 1.5 : 1,
                  borderColor: cell().isSelected ? palette().borderFocus : "transparent",
                  backgroundColor: cell().isSelected ? palette().accentSoft : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2.5,
                  overflow: "hidden",
                  cursor: "pointer",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor: cell().isSelected
                    ? palette().accentSoft
                    : palette().panelHover,
                  borderColor: cell().isSelected
                    ? palette().borderFocus
                    : palette().border,
                }}
                activeStyle={tactileActiveStyle(0.95)}
                focusVisibleStyle={{
                  outlineWidth: 2,
                  outlineColor: palette().borderFocus,
                  outlineOffset: -1,
                }}
              >
                {/* Crisp circular Today indicator + clean day number */}
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: radii.pill,
                    borderWidth: cell().isToday && !cell().isSelected ? 1 : 0,
                    borderColor: palette().accentBorder,
                    backgroundColor:
                      cell().isToday && cell().isSelected
                        ? palette().actionSolid
                        : cell().isToday
                          ? palette().accentSoft
                          : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color:
                        cell().isToday && cell().isSelected
                          ? palette().actionSolidFg
                          : cell().isToday || cell().isSelected
                            ? palette().accent
                            : cell().inCurrentMonth
                              ? palette().text
                              : palette().textMuted,
                      fontSize: textSize(11.5),
                      fontWeight: cell().isToday || cell().isSelected ? "600" : "500",
                      fontVariant: ["tabular-nums"],
                      lineHeight: textLineHeight(11.5, 1.2),
                      opacity: cell().inCurrentMonth || cell().isSelected || cell().isToday ? 1 : 0.55,
                    }}
                  >
                    {String(cell().dayNumber)}
                  </Text>
                </View>

                {/* Subtle 4px scheduled-day dot (replaces noisy blue count pills) */}
                <View style={{ height: 4, alignItems: "center", justifyContent: "center" }}>
                  <If when={cell().occurrenceCount > 0}>
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: radii.pill,
                        backgroundColor: cell().inCurrentMonth
                          ? palette().accent
                          : palette().textMuted,
                        opacity: cell().inCurrentMonth
                          ? cell().isSelected
                            ? 1
                            : 0.72
                          : 0.35,
                      }}
                    />
                  </If>
                </View>
              </View>
            )}
          </Each>
        </View>
      </SectionCard>

      {/* Flex-bounded Scrollable Selected-Day Occurrences Card */}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          padding: 14,
          gap: 10,
          overflow: "hidden",
        }}
      >
        <View style={{ flexShrink: 0, gap: 2 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13.5),
              fontWeight: "600",
              letterSpacing: textTracking(13.5),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(13.5, 1.32),
            }}
          >
            {tr("routines.scheduledFor", { date: selectedCalendarDay() })}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(11.5),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(11.5, 1.4),
            }}
          >
            {formatPlural(
              selectedDayOccurrences().length,
              "format.occurrenceOne",
              "format.occurrenceOther",
            )}
          </Text>
        </View>

        <If when={selectedDayOccurrences().length === 0}>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
            }}
          >
            {tr("routines.noRunsOnDate")}
          </Text>
        </If>

        <If when={selectedDayOccurrences().length > 0}>
          <Scroll
            style={{ flex: 1, minHeight: 0 }}
            contentStyle={{ gap: 6, paddingBottom: 4 }}
            scrollbar={true}
          >
            <Each of={selectedDayOccurrences()} key={occ => `${occ.job.id}:${occ.atMs}`}>
              {occ => (
                <View
                  role="button"
                  onPress={() => openEditRoutineDraft(occ().job)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 9,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().surfaceTertiary,
                    cursor: "pointer",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{
                    backgroundColor: palette().panelHover,
                    borderColor: palette().borderStrong,
                  }}
                  activeStyle={tactileActiveStyle(0.98)}
                  focusVisibleStyle={{
                    outlineWidth: 2,
                    outlineColor: palette().borderFocus,
                    outlineOffset: -1,
                  }}
                >
                  <View
                    style={{
                      flexShrink: 0,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: radii.xs,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceSubtle,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().accent,
                        fontFamily: fontMono,
                        fontSize: textSize(10.5),
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                        lineHeight: textLineHeight(10.5, 1.3),
                      }}
                    >
                      {occ().timeLabel}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text
                      style={{
                        minWidth: 0,
                        color: palette().text,
                        fontSize: textSize(12),
                        fontWeight: "600",
                        lineHeight: textLineHeight(12, 1.35),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {occ().job.name}
                    </Text>
                    <Text
                      style={{
                        minWidth: 0,
                        color: palette().textMuted,
                        fontSize: textSize(10.5),
                        lineHeight: textLineHeight(10.5, 1.35),
                        numberOfLines: 1,
                        textOverflow: "ellipsis-middle",
                      }}
                    >
                      {routineTargetLabel(occ().job)}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={12} color={palette().textMuted} />
                </View>
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </View>
  );
}

export function RoutinesScene() {
  effect(() => {
    const scopeKey = peerScope()?.deviceId ?? "local";
    void scopeKey;
    ensureCronHostReady();
    void loadRoutines();
  });

  cleanup(subscribeRoutinesChanged());

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}>
      {/* Unified Studio Scene Header grounded on palette().canvas */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvas,
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
            backgroundColor: palette().panelRaised,
            boxShadow: palette().shadowButton,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="calendar" size={17} color={palette().accent} />
        </View>

        <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(22),
                fontWeight: "600",
                letterSpacing: textTracking(22),
                lineHeight: textLineHeight(22, 1.22),
              }}
            >
              {tr("routines.title")}
            </Text>
            <Badge
              label={tr("routines.activeCount", { count: formatCount(activeRoutineCount()) })}
              tone={activeRoutineCount() > 0 ? "success" : "neutral"}
            />
          </View>
          <Text
            style={{
              maxWidth: 620,
              color: palette().textMuted,
              fontSize: textSize(12.5),
              lineHeight: textLineHeight(12.5, 1.44),
            }}
          >
            {tr("routines.subtitle")}
          </Text>
        </View>

        <SegmentedTabs
          size="md"
          options={filterTabOptions()}
          value={routineFilter()}
          onChange={next => routineFilter.set(next)}
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
          <Button
            label={tr("routines.newRoutine")}
            variant="primary"
            size="md"
            leadingIcon="plus"
            accessibilityLabel="routines-new"
            onPress={() => openCreateRoutineDraft()}
          />
        </View>
      </View>

      <If when={routinesError()}>
        {err => (
          <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
            <InlineBanner tone="danger" message={localizeHostError(err())} />
          </View>
        )}
      </If>

      <If when={routinesNotice() && !routinesError()}>
        <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
          <InlineBanner
            tone="success"
            message={routinesNotice() ?? ""}
            onDismiss={() => routinesNotice.set("")}
          />
        </View>
      </If>

      <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" }}>
        <Scroll
          style={{ flex: 1, minWidth: 0, minHeight: 0 }}
          contentStyle={{ padding: 24, gap: 20 }}
        >
          <If when={routinePeerDeliveryNotice()}>
            {notice => <InlineBanner tone="warning" message={notice()} />}
          </If>

          <If when={routines().length > 0}>
            <SectionCard
              title={tr("routines.dueNext24h")}
              subtitle={
                dueNext24Hours().length > 0
                  ? formatPlural(dueNext24Hours().length, "format.runOne", "format.runOther")
                  : tr("routines.noneDueNext24h")
              }
            >
              <If when={dueNext24Hours().length > 0}>
                <View
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 10,
                  }}
                >
                  <Each of={dueNext24Hours()} key={item => `due:${item.job.id}:${item.atMs}`}>
                    {item => <Due24hCard item={item} />}
                  </Each>
                </View>
              </If>
            </SectionCard>
          </If>

          <View style={{ gap: 12 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(15),
                fontWeight: "600",
                letterSpacing: textTracking(15),
                fontVariant: ["tabular-nums"],
                lineHeight: textLineHeight(15, 1.3),
              }}
            >
              {tr("routines.allRoutinesCount", { count: formatCount(filteredRoutines().length) })}
            </Text>

            <If when={filteredRoutines().length === 0}>
              <EmptyStateCard
                icon="calendar"
                title={
                  routines().length === 0
                    ? tr("routines.emptyTitle")
                    : tr("routines.emptyFilteredTitle")
                }
                subtitle={
                  routines().length === 0
                    ? tr("routines.emptySubtitle")
                    : tr("routines.emptyFilteredSubtitle")
                }
                actionLabel={
                  routines().length === 0
                    ? tr("routines.createRoutine")
                    : tr("routines.showAllRoutines")
                }
                onAction={() => {
                  if (routines().length === 0) openCreateRoutineDraft();
                  else routineFilter.set("all");
                }}
              />
            </If>

            <If when={filteredRoutines().length > 0}>
              <View style={{ gap: 12 }}>
                <Each of={filteredRoutines()} key={job => job.id}>
                  {job => <RoutineCard job={job} />}
                </Each>
              </View>
            </If>
          </View>
        </Scroll>

        <CalendarPanel />
      </View>

      <RoutineEditorModal />
    </View>
  );
}

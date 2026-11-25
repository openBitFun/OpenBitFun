// Conversation and job components of the OpenBitFun scene (visual spec §3,
// ux-redesign §3.1 and §3.2): the composer, the live job card and its stack,
// the citation chip, the history rows and the "Working now" list.
//
// Display only: every card field, state, reason and allowed action is the
// cloud node's (`superagentStore.ts`). The one mapping here is `jobMarkState`,
// which names the backend's job enum in the mark vocabulary of `ui/fleet.tsx`
// (the only place a state takes a color). Nothing is sorted, merged or counted
// beyond folding a long stack behind "+{n} more jobs".

import { Scroll, Text, View, cleanup, reduceMotion, safeArea, signal, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { Dialog, Input } from "nsh/base";
import { fleetDeviceById, fleetPromptList, fleetSessionRow, refreshFleetNavigator } from "../fleetStore";
import { tr, type MessageKey } from "../i18n";
import { activeScene, navigateScene, showDevice, selectSession } from "../state";
import {
  conversationGroups,
  conversationsCursor,
  conversationsError,
  deleteConversation,
  loadMoreConversations,
  activeConversationId,
  cardPrompt,
  clearSteerOutcome,
  jobCards,
  openConversation,
  refreshConversations,
  renameConversation,
  startSuperagentStore,
  steerJob,
  steerOutcomes,
  stopJob,
  superagentPhase,
  type ConversationSummary,
  type JobCard as JobCardData,
} from "../superagentStore";
import {
  compactLayout,
  controlHeight,
  elevationShadow,
  isLightAppearance,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
  touchSlop,
} from "../theme";
import { answerPrompt } from "../attentionStore";
import { ATTENTION_INDENT, PromptAttention, formatAge } from "./attention";
import { DeviceBadge, MatrixMark, StateLabel, StateMark, deviceException as fleetDeviceException, markState, type DeviceException, type MarkState } from "./fleet";
import { Icon } from "./icons";
import { MOTION_DURATION, MOTION_EASE_STANDARD, drawerEnterMotion, enterMotion, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import { DropdownMenu, ModalDialog, pushToast, registerEscapeDismiss } from "./overlays";
import { Button, IconButton, TextField, focusRingStyle } from "./primitives";

/** How long a cited card keeps its `accentSoft` highlight while it fades out. */
export const CITATION_FADE_MS = 600;

/** A stack shows this many cards before folding the rest behind "+{n} more jobs". */
export const JOB_STACK_FOLD = 4;

/** Re-renders ages about twice a minute while something shows one. */
const ageTick = signal(0);
let ageTimer: ReturnType<typeof setInterval> | null = null;
let ageUsers = 0;

function useAgeTick(): void {
  ageUsers += 1;
  if (!ageTimer) ageTimer = setInterval(() => ageTick.update(value => value + 1), 30_000);
  cleanup(() => {
    ageUsers -= 1;
    if (ageUsers <= 0 && ageTimer) {
      clearInterval(ageTimer);
      ageTimer = null;
      ageUsers = 0;
    }
  });
}

/** The card's age ("2 min"), from the backend's `updatedMs`. */
function cardAge(card: JobCardData): string {
  ageTick();
  return typeof card.updatedMs === "number" ? formatAge(Date.now() - card.updatedMs) : "";
}

// ── Citation chip ────────────────────────────────────────────────────────────

export interface CitationChipProps {
  /** What is cited (a job or session title). */
  label: string;
  /** The device it ran on, after " · ". */
  device?: string;
  /** Scrolls to the cited card and highlights it. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * An inline reference to a job card: 20 high, radius 6, `chip`, padding 0 6,
 * "{label} · {device}" 12/500 `textSecondary`.
 */
export function CitationChip(props: CitationChipProps) {
  const hovered = signal(false);
  const text = () => (props.device ? `${props.label} · ${props.device}` : props.label);
  const compactButton = () => Boolean(props.onPress) && compactLayout();
  return (
    <View
      testID={props.testID}
      role={props.onPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel ?? text()}
      hitSlop={props.onPress && !compactLayout() ? touchSlop(space.xl) : undefined}
      onMouseEnter={props.onPress ? () => hovered.set(true) : undefined}
      onMouseLeave={props.onPress ? () => hovered.set(false) : undefined}
      onPress={props.onPress ? () => props.onPress?.() : undefined}
      style={{
        alignSelf: "flex-start",
        justifyContent: "center",
        minHeight: compactButton() ? layout.touchTarget : space.xl,
        minWidth: compactButton() ? layout.touchTarget : undefined,
        maxWidth: 280,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        cursor: props.onPress ? "pointer" : undefined,
        userSelect: props.onPress ? "none" : undefined,
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={props.onPress ? tactileActiveStyle(0.98) : undefined}
      focusVisibleStyle={props.onPress ? focusRingStyle() : undefined}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: space.xl,
          maxWidth: 280,
          paddingHorizontal: space.chip,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          backgroundColor: props.onPress && hovered() ? palette().panelHover : palette().chip,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <Text
          style={{
            ...textStyle("caption", { color: palette().textSecondary }),
            fontWeight: "500",
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {text()}
        </Text>
      </View>
    </View>
  );
}

/**
 * The cited card's highlight: `accentSoft` while `active`, fading out over
 * 600 ms when it clears (instant under reduced motion). Spread it into the
 * card's style.
 */
export function citedHighlightStyle(active: boolean): ViewStyle {
  return {
    backgroundColor: active ? palette().accentSoft : "transparent",
    transitionProperty: "background-color",
    transitionDuration: active || reduceMotion() ? 0 : CITATION_FADE_MS,
    transitionTimingFunction: MOTION_EASE_STANDARD,
  };
}

// ── The Bit Matrix ───────────────────────────────────────────────────────────

/** OpenBitFun's static mark: the 3×3 Bit Matrix (spec §1), drawn in one color. */
export function BitMatrixGlyph(props: { size?: number; color?: string }) {
  return <MatrixMark size={props.size ?? 12} color={props.color ?? palette().textMuted} />;
}

// ── Job cards ────────────────────────────────────────────────────────────────

/** The backend's job state in the mark vocabulary (`blocked` is "needs you"). */
export function jobMarkState(card: Pick<JobCardData, "state" | "stateReason">): MarkState {
  switch (card.state) {
    case "blocked":
      return "needs_you";
    case "cancelled":
      return "stopped";
    case "queued":
      return card.stateReason === "waiting_for_device" ? "waiting" : "queued";
    default:
      return markState(card.state);
  }
}

const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  device_offline: "job.reason.offline",
  job_terminal: "job.reason.finished",
  submitting: "job.reason.starting",
  expired: "job.reason.expired",
  job_cancelled: "job.reason.stopped",
};

/** A gate or state reason in words: a known code, a sentence as is, or "" for a code this build does not know. */
export function jobReasonText(reason: string | undefined, device: string): string {
  if (!reason) return "";
  const key = REASON_KEYS[reason];
  if (key) return tr(key, { device });
  if (reason === "waiting_for_device") return tr("state.waitingFor", { device });
  return /^[a-z0-9_]+$/.test(reason) ? "" : reason;
}

function gateReason(card: JobCardData, reason: string | undefined): string {
  return jobReasonText(reason, card.deviceName) || tr("job.reason.unavailable");
}

function deviceException(deviceId: string): DeviceException | null {
  return fleetDeviceException(fleetDeviceById(deviceId)?.state);
}

function diffStatText(card: JobCardData): string {
  const stat = card.diffStat;
  if (!stat || (typeof stat.insertions !== "number" && typeof stat.deletions !== "number")) return "";
  return `+${stat.insertions ?? 0} −${stat.deletions ?? 0}`;
}

/** The third row: the live line, or a state reason worth words. */
function cardDetail(card: JobCardData): string {
  if (card.summaryLine) return card.summaryLine;
  if (card.stateReason === "waiting_for_device") return "";
  return jobReasonText(card.stateReason, card.deviceName);
}

/**
 * Opens the job's session on its device, in the workspace that holds it (a
 * job runs in its own worktree workspace, which `selectSession` reads from the
 * index); a card without one opens the device page.
 */
export async function openJob(card: JobCardData): Promise<void> {
  const sessionId = card.sessionId;
  if (!sessionId) {
    showDevice(card.deviceId);
    return;
  }
  // A job that just started may not be in the index yet: read it once more.
  if (!fleetSessionRow(card.deviceId, sessionId)) await refreshFleetNavigator().catch(() => undefined);
  selectSession(sessionId, card.deviceId);
  navigateScene("sessions");
}

async function stopCard(card: JobCardData): Promise<void> {
  if (await stopJob(card.jobId)) pushToast(tr("job.stoppedToast", { device: card.deviceName }));
}

function answeredByText(card: JobCardData): string {
  const note = card.lastAnswer;
  if (!note || note.answeredBy !== "superagent") return "";
  if (note.decision === "reject") return tr("answered.byAgentDenied");
  if (note.decision === "answered" && note.answer) return tr("answered.byAgentAnswer", { answer: note.answer });
  return tr("answered.byAgentAllowed");
}

/** A ghost text action on a card (24 high, 12/500 `textSecondary`). */
function CardTextAction(props: {
  label: string;
  danger?: boolean;
  allowed: boolean;
  reason?: string;
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
  testID?: string;
}) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label}
      tooltip={props.allowed ? undefined : props.reason}
      onPress={props.allowed ? () => props.onPress() : undefined}
      onFocus={() => props.onFocusChange?.(true)}
      onBlur={() => props.onFocusChange?.(false)}
      hitSlop={compactLayout() ? undefined : touchSlop(controlHeight.xs)}
      style={{
        height: compactLayout() ? layout.touchTarget : controlHeight.xs,
        minWidth: compactLayout() ? layout.touchTarget : undefined,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: space.sm,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        opacity: props.allowed ? 1 : 0.4,
        cursor: props.allowed ? "pointer" : "default",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={props.allowed ? { backgroundColor: palette().buttonSecondaryHover } : undefined}
      activeStyle={props.allowed ? tactileActiveStyle(0.97) : undefined}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{ ...textStyle("caption", { color: palette().textSecondary }), fontWeight: "500" }}
        hoverStyle={props.allowed && props.danger ? { color: palette().danger } : undefined}
      >
        {props.label}
      </Text>
    </View>
  );
}

export interface JobCardProps {
  card: JobCardData;
  /** Highlighted after a citation chip pointed at it. */
  cited?: boolean;
  /** Draws a hairline above it (every card but the first in a stack). */
  divided?: boolean;
  testID?: string;
}

/**
 * One dispatched job, live (spec §3 JobCard): mark, title, state word and age;
 * device badge, branch and diffstat; the live line or the steer field; the
 * pending prompt, answered in place; the "OpenBitFun allowed it" line.
 */
export function JobCard(props: JobCardProps) {
  useAgeTick();
  const hovered = signal(false);
  const focused = signal(false);
  const actionFocused = signal(false);
  const steering = signal(false);
  const steerText = signal("");
  const sheetOpen = signal(false);
  const detailsOpen = signal(false);
  const card = () => props.card;
  const mark = () => jobMarkState(card());
  const actions = () => card().actions ?? {};
  const prompt = () => cardPrompt(card(), fleetPromptList());
  const phone = () => compactLayout();
  const showHoverActions = () =>
    !phone() && (hovered() || focused() || actionFocused() || steering()) && Boolean(actions().message || actions().cancel);
  const motion = enterMotion("fadeIn", MOTION_DURATION.popover);
  const pressCard = () => {
    if (phone()) sheetOpen.set(true);
    else if (actions().openTranscript?.allowed !== false) void openJob(card());
  };
  const sendSteer = async () => {
    const text = steerText();
    if (!text.trim()) return;
    if (await steerJob(card().jobId, text)) steerText.set("");
  };
  const steerOutcome = () => steerOutcomes()[card().jobId] ?? null;
  return (
    <View
      testID={props.testID ?? `job-${card().jobId}`}
      accessibilityLabel={card().title}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={[
        {
          borderTopWidth: props.divided ? 1 : 0,
          borderTopColor: palette().borderSubtle,
          ...citedHighlightStyle(Boolean(props.cited)),
        },
        motion.style,
      ]}
    >
      <View
        role="button"
        accessibilityLabel={`${card().title} · ${card().deviceName}`}
        onPress={pressCard}
        onFocus={() => focused.set(true)}
        onBlur={() => focused.set(false)}
        style={{
          gap: space.xs,
          paddingVertical: space.md,
          paddingHorizontal: phone() ? space.md : space.lg,
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.99)}
        focusVisibleStyle={focusRingStyle()}
      >
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: space.xl, gap: space.md }}>
          <StateMark state={mark()} seen={Boolean(card().seen)} device={card().deviceName} />
          <Text
            style={{
              ...textStyle("body"),
              fontWeight: "500",
              flex: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {card().title}
          </Text>
          <If when={!phone()}>
            <View style={{ flexShrink: 0 }}>
              <StateLabel
                state={mark()}
                seen={Boolean(card().seen)}
                device={card().deviceName}
                detail={mark() === "waiting" || showHoverActions() ? undefined : cardAge(card())}
              />
            </View>
          </If>
          <If when={showHoverActions()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
              <If when={actions().message}>
                {gate => (
                  <CardTextAction
                    testID={`job-steer-${card().jobId}`}
                    label={tr("job.steer")}
                    allowed={gate().allowed}
                    reason={gateReason(card(), gate().reason)}
                    onFocusChange={value => actionFocused.set(value)}
                    onPress={() => {
                      clearSteerOutcome(card().jobId);
                      steering.set(!steering());
                    }}
                  />
                )}
              </If>
              <If when={actions().cancel}>
                {gate => (
                  <CardTextAction
                    testID={`job-stop-${card().jobId}`}
                    label={tr("job.stop")}
                    danger
                    allowed={gate().allowed}
                    reason={gateReason(card(), gate().reason)}
                    onFocusChange={value => actionFocused.set(value)}
                    onPress={() => void stopCard(card())}
                  />
                )}
              </If>
            </View>
          </If>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingLeft: ATTENTION_INDENT,
            minHeight: space.lg,
            minWidth: 0,
          }}
        >
          <DeviceBadge
            name={card().deviceName}
            kind={card().hostKind}
            exception={deviceException(card().deviceId)}
            onPress={phone() ? undefined : () => showDevice(card().deviceId)}
          />
          <If when={phone()}>
            <Text style={textStyle("caption")}>·</Text>
            <StateLabel
              state={mark()}
              seen={Boolean(card().seen)}
              device={card().deviceName}
              detail={mark() === "waiting" ? undefined : cardAge(card())}
            />
          </If>
          <If when={!phone() && Boolean(card().branch)}>
            <Text style={textStyle("caption")}>·</Text>
            <Text style={{ ...textStyle("mono", { color: palette().textMuted }), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
              {card().branch ?? ""}
            </Text>
          </If>
          <If when={!phone() && diffStatText(card())}>
            {stat => (
              <>
                <Text style={textStyle("caption")}>·</Text>
                <Text style={{ ...textStyle("mono", { color: palette().textMuted }), flexShrink: 0 }}>{stat()}</Text>
              </>
            )}
          </If>
        </View>
        <If
          when={steering() && !phone()}
          else={
            <If when={cardDetail(card())}>
              {detail => (
                <Text
                  style={{
                    ...textStyle("label", { color: palette().textSecondary }),
                    fontWeight: "400",
                    paddingLeft: ATTENTION_INDENT,
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {detail()}
                </Text>
              )}
            </If>
          }
        >
          <SteerField
            jobId={card().jobId}
            value={steerText()}
            onChange={value => steerText.set(value)}
            onSubmit={() => void sendSteer()}
            onClose={() => steering.set(false)}
          />
        </If>
        <If when={steerOutcome()}>
          {outcome => (
            <Text
              style={{
                ...textStyle("caption", { color: outcome().kind === "error" ? palette().danger : palette().textMuted }),
                paddingLeft: ATTENTION_INDENT,
              }}
            >
              {outcome().kind === "sent"
                ? tr("job.steerSent")
                : outcome().kind === "queued"
                  ? tr("job.steerQueued")
                  : outcome().text ?? ""}
            </Text>
          )}
        </If>
      </View>
      <If when={prompt()}>
        {pending => (
          <View>
            <View
              style={{
                height: 1,
                marginLeft: (phone() ? space.md : space.lg) + ATTENTION_INDENT,
                marginRight: phone() ? space.md : space.lg,
                backgroundColor: palette().borderSubtle,
              }}
            />
            <PromptAttention
              testID={`job-prompt-${card().jobId}`}
              prompt={pending()}
              placement="card"
              device={null}
              onOpen={actions().openTranscript?.allowed === false ? undefined : () => void openJob(card())}
            />
          </View>
        )}
      </If>
      <If when={answeredByText(card())}>
        {text => (
          <View testID={`job-answered-${card().jobId}`}>
            <View
              style={{
                height: 1,
                marginLeft: (phone() ? space.md : space.lg) + ATTENTION_INDENT,
                marginRight: phone() ? space.md : space.lg,
                backgroundColor: palette().borderSubtle,
              }}
            />
            <View
              style={{
                paddingVertical: space.sm,
                paddingLeft: (phone() ? space.md : space.lg) + ATTENTION_INDENT,
                paddingRight: phone() ? space.md : space.lg,
                gap: space.sm,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: space.xl }}>
                <BitMatrixGlyph size={12} />
                <Text style={{ ...textStyle("caption", { tabular: true }), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
                  {typeof card().lastAnswer?.atMs === "number"
                    ? `${text()} · ${tr("time.ago", { time: (ageTick(), formatAge(Date.now() - (card().lastAnswer?.atMs ?? 0))) })}`
                    : text()}
                </Text>
                <If when={card().lastAnswer?.detail ?? ""}>
                  <View
                    role="button"
                    accessibilityLabel={tr("common.details")}
                    onPress={() => detailsOpen.set(!detailsOpen())}
                    style={{
                      minHeight: phone() ? layout.touchTarget : controlHeight.xs,
                      minWidth: phone() ? layout.touchTarget : undefined,
                      paddingHorizontal: space.xs,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      cursor: "pointer",
                      userSelect: "none",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().buttonSecondaryHover }}
                    activeStyle={tactileActiveStyle(0.97)}
                    focusVisibleStyle={focusRingStyle()}
                  >
                    <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), fontWeight: "500" }}>
                      {tr("common.details")}
                    </Text>
                  </View>
                </If>
              </View>
              <If when={detailsOpen() ? card().lastAnswer?.detail ?? "" : ""}>
                {detail => (
                  <View
                    style={{
                      paddingVertical: space.chip,
                      paddingHorizontal: space.sm,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <Text style={textStyle("mono")}>{detail()}</Text>
                  </View>
                )}
              </If>
            </View>
          </View>
        )}
      </If>
      <JobActionsSheet
        open={sheetOpen()}
        card={card()}
        onClose={() => sheetOpen.set(false)}
        onSteer={() => {
          sheetOpen.set(false);
          clearSteerOutcome(card().jobId);
          steering.set(true);
        }}
      />
      <If when={steering() && phone()}>
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
          <SteerField
            jobId={card().jobId}
            value={steerText()}
            onChange={value => steerText.set(value)}
            onSubmit={() => void sendSteer()}
            onClose={() => steering.set(false)}
          />
        </View>
      </If>
    </View>
  );
}

/** The one-line steer field that replaces row 3 (32 high, radius 8; Return sends). */
function SteerField(props: {
  jobId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <View style={{ paddingLeft: compactLayout() ? 0 : ATTENTION_INDENT }}>
      <TextField
        value={props.value}
        size="md"
        autoFocus
        placeholder={tr("job.steerPlaceholder")}
        accessibilityLabel={`job-steer-field-${props.jobId}`}
        onChange={value => props.onChange(value)}
        onSubmit={() => props.onSubmit()}
        onKeyPress={event => {
          if (event.key === "Escape") props.onClose();
        }}
      />
    </View>
  );
}

/** The phone's card sheet: Open · Steer · Stop rows of 52, for the verbs the card offers. */
function JobActionsSheetPanel(props: { card: JobCardData; onClose: () => void; onSteer: () => void }) {
  cleanup(registerEscapeDismiss(() => props.onClose()));
  const actions = () => props.card.actions ?? {};
  const motion = drawerEnterMotion("bottom");
  const row = (label: string, gate: { allowed: boolean; reason?: string } | undefined, run: () => void, danger = false) => (
    <If when={gate}>
      {g => (
        <View
          role="button"
          accessibilityLabel={label}
          onPress={g().allowed ? () => {
            props.onClose();
            run();
          } : undefined}
          style={{
            minHeight: space.x5l + space.xs,
            justifyContent: "center",
            paddingHorizontal: space.lg,
            opacity: g().allowed ? 1 : 0.4,
            borderTopWidth: 1,
            borderTopColor: palette().borderSubtle,
            cursor: g().allowed ? "pointer" : "default",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={g().allowed ? { backgroundColor: palette().panelHover } : undefined}
          activeStyle={g().allowed ? tactileActiveStyle(0.985) : undefined}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text style={{ ...textStyle("body", { color: danger ? palette().danger : palette().text }) }}>{label}</Text>
          <If when={g().allowed ? "" : gateReason(props.card, g().reason)}>
            {reason => <Text style={textStyle("caption")}>{reason()}</Text>}
          </If>
        </View>
      )}
    </If>
  );
  return (
    <Dialog
      open
      animation="none"
      accessibilityLabel={props.card.title}
      closeOnBackdropPress
      closeOnEscape
      onOpenChange={event => {
        if (!event.open) props.onClose();
      }}
      onCancel={props.onClose}
      backdropStyle={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: palette().scrimBg }}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, justifyContent: "flex-end", pointerEvents: "box-none" }}
    >
      <View
        style={[
          {
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            borderCurve: "continuous",
            backgroundColor: palette().surfaceElevated,
            boxShadow: elevationShadow(3),
            paddingBottom: space.xxl + safeArea().bottom,
            maxHeight: "90%",
          },
          motion.style,
        ]}
      >
        <View style={{ alignItems: "center", paddingVertical: space.sm }}>
          <View style={{ width: space.x3l + space.xs, height: space.xs, borderRadius: radii.pill, backgroundColor: palette().border }} />
        </View>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs }}>
          <Text style={{ ...textStyle("body"), fontWeight: "500", numberOfLines: 2 }}>{props.card.title}</Text>
          <DeviceBadge name={props.card.deviceName} kind={props.card.hostKind} />
        </View>
        {row(tr("job.open"), actions().openTranscript, () => void openJob(props.card))}
        {row(tr("job.steer"), actions().message, () => props.onSteer())}
        {row(tr("job.stop"), actions().cancel, () => void stopCard(props.card), true)}
      </View>
    </Dialog>
  );
}

function JobActionsSheet(props: { open: boolean; card: JobCardData; onClose: () => void; onSteer: () => void }) {
  return (
    <If when={props.open}>
      <JobActionsSheetPanel card={props.card} onClose={props.onClose} onSteer={props.onSteer} />
    </If>
  );
}

export interface JobStackProps {
  jobIds: string[];
  /** The card a citation chip asked to show. */
  citedJobId?: string | null;
  /** Reports where the stack sits in its parent, so a citation can scroll to it. */
  onLayout?: (y: number) => void;
  testID?: string;
}

/**
 * Consecutive cards in one container (radius 12, hairline, `panelRaised` in
 * dark, `canvas` + hairline in light), split by hairlines. Past 4 cards the
 * rest fold behind "+{n} more jobs".
 */
export function JobStack(props: JobStackProps) {
  const expanded = signal(false);
  const cards = () => props.jobIds.map(id => jobCards()[id]).filter((card): card is JobCardData => Boolean(card));
  const folded = () => !expanded() && cards().length > JOB_STACK_FOLD;
  const visible = () => (folded() ? cards().slice(0, JOB_STACK_FOLD) : cards());
  return (
    <If when={cards().length > 0}>
      <View
        testID={props.testID}
        onLayout={event => props.onLayout?.(event.bounds.origin.y)}
        style={{
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: isLightAppearance() ? palette().canvas : palette().panelRaised,
          overflow: "hidden",
        }}
      >
        <Each of={visible()} key={card => card.jobId}>
          {(card, index) => <JobCard card={card()} divided={index() > 0} cited={props.citedJobId === card().jobId} />}
        </Each>
        <If when={cards().length > JOB_STACK_FOLD}>
          <View
            role="button"
            accessibilityLabel={folded() ? tr("job.more", { count: cards().length - JOB_STACK_FOLD }) : tr("job.fewer")}
            onPress={() => expanded.set(!expanded())}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              minHeight: compactLayout() ? layout.touchTarget : space.x3l + space.xs,
              paddingHorizontal: space.lg,
              borderTopWidth: 1,
              borderTopColor: palette().borderSubtle,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            activeStyle={tactileActiveStyle(0.985)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {folded() ? tr("job.more", { count: cards().length - JOB_STACK_FOLD }) : tr("job.fewer")}
            </Text>
            <Icon name={folded() ? "chevron-down" : "chevron-up"} size={12} color={palette().textMuted} />
          </View>
        </If>
      </View>
    </If>
  );
}

// ── Working now ──────────────────────────────────────────────────────────────

/** One 40 row: mark, title, " · " device; right: state word + age and a chevron. */
function WorkingNowRow(props: { card: JobCardData; divided: boolean }) {
  useAgeTick();
  const card = () => props.card;
  const mark = () => jobMarkState(card());
  const prompt = () => cardPrompt(card(), fleetPromptList());
  const phone = () => compactLayout();
  const canAllow = () =>
    Boolean(prompt()) && prompt()?.kind === "permission" && card().actions?.answer?.allowed !== false;
  return (
    <>
    <If when={props.divided}>
      <View style={{ height: 1, marginLeft: ATTENTION_INDENT, backgroundColor: palette().borderSubtle }} />
    </If>
    <View
      testID={`working-${card().jobId}`}
      role="button"
      accessibilityLabel={card().title}
      onPress={() => void openJob(card())}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: phone() ? layout.touchTarget : controlHeight.lg,
        paddingHorizontal: space.xs,
        paddingVertical: phone() ? space.sm : 0,
        borderRadius: radii.md,
        borderCurve: "continuous",
        gap: space.md,
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      {/* On the phone the mark sits on the title line, not between title and device line. */}
      <View
        style={{
          flexShrink: 0,
          justifyContent: "center",
          alignSelf: phone() ? "flex-start" : "center",
          height: phone() ? (textStyle("body").lineHeight as number) : undefined,
        }}
      >
        <StateMark state={mark()} seen={Boolean(card().seen)} device={card().deviceName} />
      </View>
      <If
        when={phone()}
        else={
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text style={{ ...textStyle("body"), fontWeight: "500", flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
              {card().title}
            </Text>
            <Text style={textStyle("caption")}>·</Text>
            <DeviceBadge
              name={card().deviceName}
              kind={card().hostKind}
              exception={deviceException(card().deviceId)}
              onPress={() => showDevice(card().deviceId)}
            />
          </View>
        }
      >
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <Text style={{ ...textStyle("body"), fontWeight: "500", minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
            {card().title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
            <DeviceBadge
              name={card().deviceName}
              kind={card().hostKind}
              exception={deviceException(card().deviceId)}
            />
            <Text style={textStyle("caption")}>·</Text>
            <StateLabel
              state={mark()}
              seen={Boolean(card().seen)}
              device={card().deviceName}
              detail={mark() === "waiting" ? undefined : cardAge(card())}
            />
          </View>
        </View>
      </If>
      <If when={canAllow()}>
        <AllowOnceButton card={card()} />
      </If>
      <If when={!phone()}>
        <StateLabel
          state={mark()}
          seen={Boolean(card().seen)}
          device={card().deviceName}
          detail={mark() === "waiting" ? undefined : cardAge(card())}
        />
      </If>
      <Icon name="chevron-right" size={12} color={palette().textMuted} />
    </View>
    </>
  );
}

function AllowOnceButton(props: { card: JobCardData }) {
  return (
    <Button
      label={tr("common.allow")}
      variant="secondary"
      size="sm"
      accessibilityLabel={`working-allow-${props.card.jobId}`}
      style={compactLayout() ? { minHeight: layout.touchTarget, minWidth: layout.touchTarget } : undefined}
      onPress={() => {
        const prompt = cardPrompt(props.card, fleetPromptList());
        if (!prompt) return;
        void answerPrompt(prompt, { kind: "permission", reply: "once" });
      }}
    />
  );
}

function WorkingNowSection(props: { title: string; cards: JobCardData[]; testID: string }) {
  return (
    <If when={props.cards.length > 0}>
      <View testID={props.testID} style={{ gap: space.sm }}>
        <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "600" }}>{props.title}</Text>
        <View style={{ paddingLeft: 0 }}>
          <Each of={props.cards} key={card => card.jobId}>
            {(card, index) => <WorkingNowRow card={jobCards()[card().jobId] ?? card()} divided={index() > 0} />}
          </Each>
        </View>
      </View>
    </If>
  );
}

/**
 * "Needs you" and "Working now" (≤3 rows each, the backend's lists across
 * every conversation) on the new-conversation screen. Empty sections are not
 * drawn.
 */
export function WorkingNowList(props: { needsYou: JobCardData[]; working: JobCardData[] }) {
  return (
    <View style={{ gap: space.x3l }}>
      <WorkingNowSection testID="working-now-needs-you" title={tr("sa.needsYou")} cards={props.needsYou} />
      <WorkingNowSection testID="working-now-working" title={tr("sa.workingNow")} cards={props.working} />
    </View>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

export interface ComposerBlocked {
  /** The reason line (13 `textSecondary`). */
  reason: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface SuperComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** A turn runs: send becomes Stop. */
  running?: boolean;
  onStop?: () => void;
  /** Signed out, off or unavailable: the bottom row becomes the reason and one button; the field is disabled. */
  blocked?: ComposerBlocked | null;
  /** The field's maximum height (40 % of the viewport), past which it scrolls. */
  maxFieldHeight?: number;
  /** An attached session ("{device} · {session}"), drawn as a chip above the text. */
  context?: { label: string; onClear: () => void } | null;
  /** A control drawn in the bottom row before the send circle (the model picker). */
  accessory?: JSX.Element;
  testID?: string;
}

/**
 * The one input box (spec §3 SuperComposer): radius 16, `inputBg`, hairline,
 * `shadowComposer` (focus `fieldFocusBorder` + `shadowComposerFocus`); field
 * 15/24; attach and mic on the left, the send circle on the right, an optional
 * accessory (the model picker) before it. No device picker, no mode chip, no
 * hint line.
 */
export function SuperComposer(props: SuperComposerProps) {
  const focused = signal(false);
  const empty = () => props.value.trim().length === 0;
  const blocked = () => props.blocked ?? null;
  return (
    <View
      testID={props.testID ?? "super-composer"}
      style={{
        width: "100%",
        borderRadius: radii.xl,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: focused() ? palette().fieldFocusBorder : palette().border,
        backgroundColor: palette().inputBg,
        boxShadow: elevationShadow(1, { focused: focused() }),
        ...paintTransition(120),
      }}
    >
      <If when={props.context}>
        {context => (
          <View style={{ paddingTop: space.md, paddingHorizontal: space.lg }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: space.xs,
                height: controlHeight.xs,
                paddingHorizontal: space.chip,
                borderRadius: radii.sm,
                borderCurve: "continuous",
                backgroundColor: palette().chip,
                maxWidth: "100%",
              }}
            >
              <Icon name="layers" size={12} color={palette().textMuted} />
              <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
                {context().label}
              </Text>
              <View
                role="button"
                accessibilityLabel={tr("common.remove")}
                hitSlop={compactLayout() ? undefined : touchSlop(space.lg)}
                onPress={() => context().onClear()}
                style={{
                  minWidth: compactLayout() ? layout.touchTarget : space.lg,
                  minHeight: compactLayout() ? layout.touchTarget : space.lg,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radii.xs,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().panelHover }}
                activeStyle={tactileActiveStyle(0.97)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Icon name="close" size={12} color={palette().textMuted} />
              </View>
            </View>
          </View>
        )}
      </If>
      <View style={{ paddingTop: space.lg, paddingHorizontal: space.lg, paddingBottom: space.sm, minHeight: space.x5l + space.sm }}>
        <Input
          value={props.value}
          placeholder={props.placeholder}
          accessibilityLabel="super-composer-field"
          multiline
          readonly={Boolean(blocked())}
          submitBehavior="submit"
          style={{
            minHeight: compactLayout() ? layout.touchTarget : textLineHeight(15, 24 / 15),
            maxHeight: props.maxFieldHeight,
            ...textStyle("prose"),
            fontSize: compactLayout() ? Math.max(16, textSize(15)) : textSize(15),
            lineHeight: compactLayout() ? textLineHeight(16, 1.5) : textLineHeight(15, 24 / 15),
            color: palette().text,
            placeholderColor: palette().textMuted,
            caretColor: palette().accent,
          }}
          onFocus={() => focused.set(true)}
          onBlur={() => focused.set(false)}
          onChange={event => props.onChange(event.value)}
          onSubmit={() => {
            if (!blocked() && !props.running) props.onSubmit();
          }}
        />
      </View>
      <If
        when={blocked()}
        else={
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: compactLayout() ? layout.touchTarget + space.xs : controlHeight.lg,
              paddingHorizontal: space.sm,
              paddingBottom: space.sm,
              gap: space.sm,
            }}
          >
            <IconButton
              icon="paperclip"
              size="sm"
              iconSize={16}
              disabled
              accessibilityLabel="super-composer-attach"
              tooltip={tr("sa.attachUnavailable")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => undefined}
            />
            <View style={{ flex: 1 }} />
            {props.accessory}
            <SendCircle
              running={Boolean(props.running)}
              empty={empty()}
              onSend={() => props.onSubmit()}
              onStop={() => props.onStop?.()}
            />
          </View>
        }
      >
        {state => (
          <View
            testID="super-composer-blocked"
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              minHeight: compactLayout() ? layout.touchTarget + space.xs : controlHeight.lg,
              paddingHorizontal: space.lg,
              paddingBottom: space.sm,
              gap: space.md,
            }}
          >
            <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400", flex: 1, minWidth: 0 }}>
              {state().reason}
            </Text>
            <If when={state().actionLabel ?? ""}>
              {label => (
                <Button
                  label={label()}
                  variant="secondary"
                  size="sm"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => state().onAction?.()}
                />
              )}
            </If>
          </View>
        )}
      </If>
    </View>
  );
}

/** The send circle: 32, `actionPrimaryBg` with `arrow-up` 16; muted when empty; `pause` 14 stops a running turn. */
function SendCircle(props: { running: boolean; empty: boolean; onSend: () => void; onStop: () => void }) {
  const hovered = signal(false);
  const live = () => props.running || !props.empty;
  return (
    <View
      role="button"
      accessibilityLabel={props.running ? tr("common.stop") : tr("common.send")}
      tooltip={compactLayout() ? undefined : props.running ? tr("common.stop") : tr("sa.sendTooltip")}
      hitSlop={compactLayout() ? undefined : touchSlop(controlHeight.md)}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onPress={() => {
        if (props.running) props.onStop();
        else if (!props.empty) props.onSend();
      }}
      style={{
        width: compactLayout() ? layout.touchTarget : controlHeight.md,
        height: compactLayout() ? layout.touchTarget : controlHeight.md,
        borderRadius: radii.pill,
        alignItems: "center",
        justifyContent: "center",
        cursor: live() ? "pointer" : "default",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={live() ? tactileActiveStyle(0.97) : undefined}
      focusVisibleStyle={focusRingStyle()}
    >
      <View
        style={{
          width: controlHeight.md,
          height: controlHeight.md,
          borderRadius: radii.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: live()
            ? hovered()
              ? palette().actionPrimaryHover
              : palette().actionPrimaryBg
            : palette().buttonSecondaryBg,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <Icon
          name={props.running ? "pause" : "arrow-up"}
          size={props.running ? 14 : 16}
          color={live() ? palette().actionPrimaryFg : palette().textMuted}
        />
      </View>
    </View>
  );
}

/** Suggestion chips from the backend (≤3): pressing one fills the composer without sending. */
export function SuggestionChips(props: { suggestions: string[]; onPick: (text: string) => void }) {
  const chips = () => <SuggestionChipList suggestions={props.suggestions} onPick={props.onPick} />;
  return (
    <If when={props.suggestions.length > 0}>
      <If when={compactLayout()} else={<View testID="sa-suggestions" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{chips()}</View>}>
        <Scroll smoothWheel horizontal testID="sa-suggestions" contentStyle={{ flexDirection: "row", gap: space.sm }}>
          {chips()}
        </Scroll>
      </If>
    </If>
  );
}

function SuggestionChipList(props: { suggestions: string[]; onPick: (text: string) => void }) {
  return (
    <Each of={props.suggestions} key={(text, index) => `${index}:${text}`}>
      {text => <SuggestionChipItem text={text()} onPick={props.onPick} />}
    </Each>
  );
}

function SuggestionChipItem(props: { text: string; onPick: (text: string) => void }) {
  const hovered = signal(false);
  return (
    <View
      role="button"
      accessibilityLabel={props.text}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onPress={() => props.onPick(props.text)}
      hitSlop={compactLayout() ? undefined : touchSlop(controlHeight.sm)}
      style={{
        height: compactLayout() ? layout.touchTarget : controlHeight.sm,
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: radii.md,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={tactileActiveStyle(0.98)}
      focusVisibleStyle={focusRingStyle()}
    >
      <View
        style={{
          height: compactLayout() ? controlHeight.md : controlHeight.sm,
          justifyContent: "center",
          paddingHorizontal: space.md,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: hovered() ? palette().panelHover : "transparent",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400", numberOfLines: 1 }}>{props.text}</Text>
      </View>
    </View>
  );
}

// ── Conversation history (the sidebar slot) ──────────────────────────────────

/** The row's mark: the backend's roll-up, or its turn status from a cloud node without one. */
export function conversationMark(row: ConversationSummary): MarkState | null {
  const rollup = row.rollup ?? (row.status === "running" || row.status === "parked" ? "working" : row.status === "failed" ? "failed" : "none");
  switch (rollup) {
    case "needs_you":
      return "needs_you";
    case "working":
      return "working";
    case "unread":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

const renameTarget = signal<{ id: string; title: string } | null>(null);
const renameDraft = signal("");
const conversationDialogBusy = signal(false);
const conversationDialogError = signal("");

/** Opens the rename dialog for a conversation. */
export function requestRenameConversation(id: string, title: string): void {
  renameDraft.set(title);
  conversationDialogError.set("");
  renameTarget.set({ id, title });
}

/** The ⋯ menu items of a conversation (header and history row). */
export function conversationMenuItems(id: string, title: string) {
  return [
    { id: "rename", label: tr("sa.menuRename"), icon: "edit" as const, onSelect: () => requestRenameConversation(id, title) },
    {
      id: "delete",
      label: tr("sa.menuDelete"),
      icon: "trash" as const,
      danger: true,
      confirmDelete: true,
      confirmAccessibilityLabel: `sa-delete-confirm-${id}`,
      onSelect: () => {
        void deleteConversation(id).catch(error => {
          pushToast(error instanceof Error ? error.message : String(error), "error");
        });
      },
    },
  ];
}

let dialogHostSeq = 0;
const dialogHosts = signal<number[]>([]);

/**
 * The rename dialog. Mount it wherever the menus appear; only the
 * first mounted instance draws, so the dialog never shows twice.
 */
export function ConversationDialogs() {
  const id = ++dialogHostSeq;
  dialogHosts.update(hosts => [...hosts, id]);
  cleanup(() => dialogHosts.update(hosts => hosts.filter(host => host !== id)));
  const active = () => dialogHosts()[0] === id;
  const run = async (task: () => Promise<void>, close: () => void) => {
    conversationDialogBusy.set(true);
    conversationDialogError.set("");
    try {
      await task();
      close();
    } catch (error) {
      conversationDialogError.set(error instanceof Error ? error.message : String(error));
    } finally {
      conversationDialogBusy.set(false);
    }
  };
  return (
    <If when={active()}>
      <ModalDialog
        open={Boolean(renameTarget())}
        size="sm"
        title={tr("sa.renameTitle")}
        onClose={() => renameTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => renameTarget.set(null)} />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="md"
              loading={conversationDialogBusy()}
              disabled={!renameDraft().trim()}
              onPress={() => {
                const target = renameTarget();
                if (target) void run(() => renameConversation(target.id, renameDraft().trim()), () => renameTarget.set(null));
              }}
            />
          </View>
        }
      >
        <View style={{ gap: space.sm }}>
          <TextField
            value={renameDraft()}
            autoFocus
            accessibilityLabel="conversation-rename-field"
            onChange={value => renameDraft.set(value)}
            onSubmit={() => {
              const target = renameTarget();
              if (target && renameDraft().trim()) {
                void run(() => renameConversation(target.id, renameDraft().trim()), () => renameTarget.set(null));
              }
            }}
          />
          <If when={conversationDialogError()}>
            {error => <Text style={textStyle("caption", { color: palette().danger })}>{error()}</Text>}
          </If>
        </View>
      </ModalDialog>
    </If>
  );
}

export interface ConversationRowProps {
  row: ConversationSummary;
  active: boolean;
  onPress: () => void;
}

/**
 * One history row (spec §3): 32 high, padding 0 8, radius 8; a 16 mark slot
 * (empty when the roll-up is none), gap 8; title 13/400 `chromeText`, 600 when
 * unread; no age. Hover `chromeHover` and a 20 ⋯ (Rename, Delete).
 */
export function ConversationRow(props: ConversationRowProps) {
  const hovered = signal(false);
  const focused = signal(false);
  const menuFocused = signal(false);
  const menuOpen = signal(false);
  let anchor: ViewRef | undefined;
  const mark = () => conversationMark(props.row);
  return (
    <View
      testID={`conversation-${props.row.id}`}
      role="button"
      accessibilityLabel={props.row.title}
      onPress={() => props.onPress()}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onFocus={() => focused.set(true)}
      onBlur={() => focused.set(false)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: compactLayout() ? layout.touchTarget : controlHeight.md,
        paddingHorizontal: space.sm,
        gap: space.sm,
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: props.active ? palette().chromeActive : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={props.active ? undefined : { backgroundColor: palette().chromeHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <View style={{ width: space.lg, height: space.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <If when={mark()}>{state => <StateMark state={state()} />}</If>
      </View>
      <Text
        style={{
          ...textStyle("label", { color: palette().chromeText }),
          fontWeight: props.row.unread ? "600" : "400",
          flex: 1,
          minWidth: 0,
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.row.title}
      </Text>
      <If when={(hovered() || focused() || menuFocused() || menuOpen()) && !compactLayout()}>
        <View
          ref={node => {
            anchor = node;
          }}
          role="button"
          accessibilityLabel={`conversation-menu-${props.row.id}`}
          onFocus={() => menuFocused.set(true)}
          onBlur={() => menuFocused.set(false)}
          onPress={() => menuOpen.set(true)}
          style={{
            width: space.xl,
            height: space.xl,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radii.xs,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().chromeHover }}
          activeStyle={tactileActiveStyle(0.97)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Icon name="more" size={14} color={palette().chromeTextMuted} />
        </View>
      </If>
      <DropdownMenu
        open={menuOpen()}
        anchor={anchor}
        align="end"
        items={conversationMenuItems(props.row.id, props.row.title)}
        onClose={() => menuOpen.set(false)}
      />
    </View>
  );
}

const HISTORY_GROUP_KEYS: Readonly<Record<string, MessageKey>> = {
  today: "history.today",
  yesterday: "history.yesterday",
  week: "history.week",
  older: "history.older",
};

function groupLabel(id: string, label?: string): string {
  const key = HISTORY_GROUP_KEYS[id];
  return key ? tr(key) : (label ?? "");
}

/**
 * The sidebar's history slot: the backend's groups ("Today", "Yesterday" ...)
 * of ConversationRows, and "Show more" when the backend has another page. The
 * same component goes in the phone history drawer.
 */
export function ConversationHistory(props: { onOpen?: () => void } = {}) {
  startSuperagentStore();
  return (
    <View testID="conversation-history" style={{ flex: 1, minHeight: 0, gap: space.hair, paddingTop: space.lg }}>
      <Each of={conversationGroups()} key={(group, index) => `${index}:${group.id}`}>
        {(group, index) => (
          <View style={{ gap: space.hair, paddingTop: index() > 0 ? space.md : 0 }}>
            <If when={groupLabel(group().id, group().label)}>
              {label => (
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().chromeTextMuted }),
                    fontWeight: "500",
                    paddingHorizontal: space.sm,
                    paddingBottom: space.xs,
                  }}
                >
                  {label()}
                </Text>
              )}
            </If>
            <Each of={group().rows} key={row => row.id}>
              {row => (
                <ConversationRow
                  row={row()}
                  active={activeScene() === "openbitfun" && activeConversationId() === row().id}
                  onPress={() => {
                    openConversation(row().id);
                    navigateScene("openbitfun");
                    props.onOpen?.();
                  }}
                />
              )}
            </Each>
          </View>
        )}
      </Each>
      <If when={conversationsCursor() !== null && conversationsCursor() !== ""}>
        <View
          role="button"
          accessibilityLabel={tr("history.showMore")}
          onPress={() => void loadMoreConversations()}
          style={{
            height: compactLayout() ? layout.touchTarget : controlHeight.md,
            justifyContent: "center",
            paddingHorizontal: space.sm,
            paddingLeft: space.sm + space.lg + space.sm,
            borderRadius: radii.md,
            borderCurve: "continuous",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().chromeHover }}
          activeStyle={tactileActiveStyle(0.98)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text style={textStyle("label", { color: palette().chromeTextMuted })}>{tr("history.showMore")}</Text>
        </View>
      </If>
      <If when={superagentPhase() === "ready" && conversationsError() && conversationGroups().length === 0 ? conversationsError() : ""}>
        <View style={{ paddingHorizontal: space.sm, gap: space.xs }}>
          <Text style={textStyle("caption", { color: palette().chromeTextMuted })}>{tr("history.loadFailed")}</Text>
          <View
            role="button"
            accessibilityLabel={tr("common.tryAgain")}
            onPress={() => void refreshConversations()}
            style={{
              alignSelf: "flex-start",
              minHeight: compactLayout() ? layout.touchTarget : controlHeight.xs,
              justifyContent: "center",
              paddingHorizontal: space.xs,
              borderRadius: radii.sm,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().chromeHover }}
            activeStyle={tactileActiveStyle(0.98)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Text style={{ ...textStyle("caption", { color: palette().chromeText }), fontWeight: "500" }}>
              {tr("common.tryAgain")}
            </Text>
          </View>
        </View>
      </If>
      <ConversationDialogs />
    </View>
  );
}

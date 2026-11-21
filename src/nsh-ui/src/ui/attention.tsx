// Attention components (visual spec §3 AttentionItem, §4.4 Inbox; ux-redesign §6).
//
// - `AttentionItem`: the item's shell, which the Inbox, a job card's pending
//   prompt and the session composer's prompt box all draw. It owns the layout,
//   the answered fade and the unanswerable state; its slots take the controls.
// - `PromptAttention`: an `AttentionItem` for one `FleetPrompt`, with the
//   permission buttons or the question options, answered on the device that
//   asked (`attentionStore.answerPrompt`). Job cards, the Inbox and the session
//   view all draw a prompt through it, so a prompt looks and answers the same
//   everywhere.
// - `AttentionLine`: a Done or Failed item, one line of 40.
// - `AttentionTray`: the Inbox groups (the page and the ⌘I sheet).
// - `ReviewNotesBar`: the review-note count and "Send to agent".
//
// Display only: groups, order, titles, reasons and answerability come from the
// backend; the only enum mapping here is a permission action to its verb.

import { Text, View, reduceMotion, signal, type JSX } from "nsh";
import {
  ANSWERED_HOLD_MS,
  answerPrompt,
  attentionGroups,
  promptStatus,
  resetPromptStatus,
  type AttentionEntry,
  type AttentionGroup,
  type PermissionReply,
  type PromptAnswer,
} from "../attentionStore";
import { fleetDeviceById } from "../fleetStore";
import type { FleetPrompt } from "../fleetTypes";
import { tr } from "../i18n";
import { compactLayout, controlHeight, fontMono, palette, radii, space, textLineHeight, textSize, textStyle, touchSlop } from "../theme";
import { DeviceBadge, StateMark, markState, type DeviceException, type MarkState } from "./fleet";
import { Icon } from "./icons";
import { MOTION_DURATION, MOTION_EASE_STANDARD, animateLayout, paintTransition, tactileActiveStyle } from "./motion";
import { Button, EmptyStateCard, TextField } from "./primitives";

export { ANSWERED_HOLD_MS };

/** Where the item sits: its padding, frame and header follow (spec §3). */
export type AttentionPlacement = "inbox" | "card" | "composer";

export interface AttentionDevice {
  name: string;
  /** The form factor (`hostKind`); picks the glyph only. */
  kind?: string;
  exception?: DeviceException | null;
  exceptionDetail?: string;
  /** Opens the device page. */
  onPress?: () => void;
}

export interface AttentionItemProps {
  /** The mark on row 1; a prompt is `needs_you`. */
  state?: MarkState;
  device?: AttentionDevice | null;
  /** The session or job the request comes from (13/500). Row 1 only. */
  source?: string;
  /** Preformatted age on the right of row 1 ("2 min"). */
  age?: string;
  /**
   * Draws row 1 (mark, device, source, age). Defaults to `true`, except on a
   * card, whose own first rows already name the job and its device.
   */
  header?: boolean;
  /** The request, 14/400. Past 3 lines it collapses behind "Show all". */
  request?: string;
  /** A command or path, drawn in a mono 13 well under the request. */
  command?: string;
  /** Custom body after `request` / `command`. */
  children?: JSX.Element;
  /** Row 3: the answer controls (buttons, option rows, answer field). */
  actions?: JSX.Element;
  /** Draws "Open ›" at the end of row 3. */
  onOpen?: () => void;
  /** On a phone, "Show all" asks the screen for a sheet instead of expanding in place. */
  onShowAll?: () => void;
  /** Set once answered (here or elsewhere): the words shown instead of the actions ("Answered on {device}"). */
  answered?: string;
  /** Set when this client cannot answer: the reason replaces the actions, and only "Open" stays. */
  unanswerableReason?: string;
  /** One 12 line under row 3 ("Couldn't confirm. Try again."); `danger` unless `noticeTone` says otherwise. */
  notice?: string;
  noticeTone?: "danger" | "muted";
  placement?: AttentionPlacement;
  accessibilityLabel?: string;
  testID?: string;
}

const COLLAPSE_LINES = 3;
const COLLAPSE_CHARS = 280;

function needsCollapse(text: string): boolean {
  return text.split("\n").length > COLLAPSE_LINES || text.length > COLLAPSE_CHARS;
}

/** The indent of rows 2 and 3: the 16 mark box plus its 12 gap. */
export const ATTENTION_INDENT = 28;

/** Row 3's height: 28, 44 on a phone. */
export function attentionControlHeight(): number {
  return compactLayout() ? 44 : controlHeight.sm;
}

function MonoWell(props: { text: string; muted?: boolean }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        paddingVertical: space.hair,
        paddingHorizontal: space.chip,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: palette().surfaceTertiary,
      }}
    >
      <Text
        style={{
          color: props.muted ? palette().textMuted : palette().text,
          fontFamily: fontMono,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 20 / 13),
          fontVariant: ["tabular-nums"],
          userSelect: "text",
          transitionProperty: "color",
          transitionDuration: reduceMotion() ? 0 : MOTION_DURATION.popover,
          transitionTimingFunction: MOTION_EASE_STANDARD,
        }}
      >
        {props.text}
      </Text>
    </View>
  );
}

function OpenLink(props: { onOpen: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={tr("common.open")}
      hitSlop={touchSlop(controlHeight.sm)}
      onPress={() => props.onOpen()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.hair,
        height: controlHeight.sm,
        paddingHorizontal: space.sm,
        borderRadius: radii.md,
        borderCurve: "continuous",
        cursor: "pointer",
        ...paintTransition(120),
      }}
      hoverStyle={{ backgroundColor: palette().buttonSecondaryHover }}
      activeStyle={tactileActiveStyle(0.98)}
    >
      <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("common.open")}</Text>
      <Icon name="chevron-right" size={12} color={palette().textMuted} />
    </View>
  );
}

export function AttentionItem(props: AttentionItemProps) {
  const expanded = signal(false);
  const placement = () => props.placement ?? "inbox";
  const header = () => props.header ?? placement() !== "card";
  const answered = () => Boolean(props.answered);
  const showAllVisible = () => !expanded() && needsCollapse(props.request ?? "");
  return (
    <View
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel ?? props.source ?? props.request}
      style={{
        gap: space.sm,
        paddingVertical: placement() === "inbox" ? space.lg : space.md,
        paddingHorizontal: placement() === "inbox" ? 0 : space.lg,
        borderRadius: placement() === "composer" ? radii.lg : 0,
        borderCurve: "continuous",
        borderWidth: placement() === "composer" ? 1 : 0,
        borderColor: palette().borderSubtle,
        backgroundColor: placement() === "composer" ? palette().canvas : undefined,
      }}
    >
      <If when={header()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 20,
            gap: space.md,
            ...paintTransition(MOTION_DURATION.popover),
          }}
        >
          <StateMark state={answered() ? "done" : (props.state ?? "needs_you")} seen={answered()} />
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <If when={props.device}>
              {device => (
                <>
                  <DeviceBadge
                    name={device().name}
                    kind={device().kind}
                    exception={device().exception}
                    exceptionDetail={device().exceptionDetail}
                    onPress={device().onPress}
                  />
                  <If when={props.source ?? ""}>
                    <Text style={textStyle("caption")}>·</Text>
                  </If>
                </>
              )}
            </If>
            <If when={props.source ?? ""}>
              {source => (
                <Text
                  style={{
                    ...textStyle("label", { color: answered() ? palette().textMuted : palette().text }),
                    flexShrink: 1,
                    minWidth: 0,
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                    ...paintTransition(MOTION_DURATION.popover),
                  }}
                >
                  {source()}
                </Text>
              )}
            </If>
          </View>
          <If when={props.age ?? ""}>
            {age => <Text style={{ ...textStyle("caption", { tabular: true }), flexShrink: 0 }}>{age()}</Text>}
          </If>
        </View>
      </If>
      <View style={{ paddingLeft: header() || placement() === "card" ? ATTENTION_INDENT : 0, gap: space.sm }}>
        <If when={props.request ?? ""}>
          {request => (
            <Text
              style={{
                ...textStyle("body", { color: answered() ? palette().textMuted : palette().text }),
                numberOfLines: showAllVisible() ? COLLAPSE_LINES : undefined,
                textOverflow: "ellipsis",
                userSelect: "text",
                transitionProperty: "color",
                transitionDuration: reduceMotion() ? 0 : MOTION_DURATION.popover,
                transitionTimingFunction: MOTION_EASE_STANDARD,
              }}
            >
              {request()}
            </Text>
          )}
        </If>
        <If when={showAllVisible()}>
          <Text
            role="button"
            accessibilityLabel={tr("inbox.showAll")}
            onPress={() => {
              if (compactLayout() && props.onShowAll) props.onShowAll();
              else expanded.set(true);
            }}
            style={{ ...textStyle("label", { color: palette().textSecondary }), cursor: "pointer" }}
          >
            {tr("inbox.showAll")}
          </Text>
        </If>
        <If when={props.command ?? ""}>{command => <MonoWell text={command()} muted={answered()} />}</If>
        {props.children}
        <If
          when={answered()}
          else={
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                minHeight: attentionControlHeight(),
                gap: space.sm,
              }}
            >
              <If when={props.unanswerableReason ?? ""} else={<>{props.actions}</>}>
                {reason => (
                  <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400", flexShrink: 1 }}>
                    {reason()}
                  </Text>
                )}
              </If>
              <If when={Boolean(props.onOpen)}>
                {/* Right-aligned on its line, also when row 3 wraps on a phone. */}
                <View style={{ marginLeft: "auto" }}>
                  <OpenLink onOpen={() => props.onOpen?.()} />
                </View>
              </If>
            </View>
          }
        >
          <View style={{ minHeight: attentionControlHeight(), justifyContent: "center" }}>
            <Text style={{ ...textStyle("caption"), ...paintTransition(MOTION_DURATION.popover) }}>{props.answered}</Text>
          </View>
        </If>
        <If when={!answered() && props.notice ? props.notice : ""}>
          {notice => (
            <Text
              style={textStyle("caption", {
                color: props.noticeTone === "muted" ? palette().textMuted : palette().danger,
              })}
            >
              {notice()}
            </Text>
          )}
        </If>
      </View>
    </View>
  );
}

// ── Prompts ──────────────────────────────────────────────────────────────────

interface PermissionPayload {
  action: string;
  resources: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readPermission(prompt: FleetPrompt): PermissionPayload {
  const payload = asRecord(prompt.payload);
  return {
    action: typeof payload.action === "string" ? payload.action : "",
    resources: Array.isArray(payload.resources) ? payload.resources.map(String) : [],
  };
}

const RUN_ACTIONS = new Set(["bash", "execute", "run_command", "shell"]);
const EDIT_ACTIONS = new Set(["edit", "write", "write_file", "edit_file", "write_notebook"]);

/** The request line of a permission prompt (spec §4.3 `prompt.*`). */
export function permissionRequestText(prompt: FleetPrompt): { request: string; command: string } {
  const { action, resources } = readPermission(prompt);
  const command = resources.join("\n");
  if (RUN_ACTIONS.has(action)) return { request: tr("prompt.wantsRun"), command };
  if (EDIT_ACTIONS.has(action)) {
    return {
      request: resources.length > 1 ? tr("prompt.wantsEdit", { count: resources.length }) : tr("prompt.wantsEditOne"),
      command,
    };
  }
  const tool = prompt.toolName || action || prompt.title;
  return { request: tool ? tr("prompt.wantsAccess", { tool }) : prompt.title, command };
}

interface QuestionOption {
  label: string;
  description: string;
}

interface QuestionItem {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

/** The questions a question prompt carries (`{questions: [...]}`, the Runtime's own shape). */
export function readQuestionPayload(payload: unknown): QuestionItem[] {
  const record = asRecord(payload);
  const list = Array.isArray(record.questions) ? record.questions : Array.isArray(payload) ? (payload as unknown[]) : [];
  return list.flatMap((candidate): QuestionItem[] => {
    const item = asRecord(candidate);
    if (typeof item.question !== "string" && typeof item.header !== "string") return [];
    const options = Array.isArray(item.options) ? item.options : [];
    return [
      {
        question: typeof item.question === "string" ? item.question : "",
        header: typeof item.header === "string" ? item.header : "",
        multiSelect: item.multiSelect === true,
        options: options.flatMap((option): QuestionOption[] => {
          const entry = asRecord(option);
          return typeof entry.label === "string"
            ? [{ label: entry.label, description: typeof entry.description === "string" ? entry.description : "" }]
            : [];
        }),
      },
    ];
  });
}

/** A 32 option row: radius 8, 1 px `border`, 13 (spec §3 AttentionItem). */
function OptionChip(props: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected, disabled: Boolean(props.disabled) }}
      disabled={Boolean(props.disabled)}
      hitSlop={touchSlop(controlHeight.md)}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        height: compactLayout() ? 44 : controlHeight.md,
        paddingHorizontal: space.md,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.selected ? palette().accentBorder : palette().border,
        backgroundColor: props.selected ? palette().accentSoft : "transparent",
        cursor: props.disabled ? "not-allowed" : "pointer",
        ...paintTransition(120),
      }}
      hoverStyle={{ backgroundColor: props.selected ? palette().accentSoft : palette().panelHover }}
      activeStyle={tactileActiveStyle(0.98)}
      disabledStyle={{ opacity: 0.4 }}
    >
      <Text style={{ ...textStyle("label", { color: palette().text }), fontWeight: props.selected ? "500" : "400", numberOfLines: 1 }}>
        {props.label}
      </Text>
      <If when={props.selected}>
        <Icon name="check" size={12} color={palette().accent} />
      </If>
    </View>
  );
}

export interface PromptAttentionProps {
  prompt: FleetPrompt;
  placement?: AttentionPlacement;
  /** Row 1's source title; defaults to the prompt's backend title. */
  source?: string;
  /** Row 1's device; defaults to the navigator's row for `prompt.deviceId`. `null` draws none. */
  device?: AttentionDevice | null;
  age?: string;
  /** Draws "Open ›" (open the session or job). */
  onOpen?: () => void;
  /** Called once the device took the answer (raise the toast here). */
  onAnswered?: (answer: PromptAnswer) => void;
  /** Called after the answered hold (`ANSWERED_HOLD_MS`), when the item should leave. */
  onSettled?: () => void;
  onShowAll?: () => void;
  /**
   * Sends the answer instead of the default route (a store that keeps its own
   * copy of the prompt, such as the session view's `permissionStore`). It
   * rejects to report a failure.
   */
  send?: (prompt: FleetPrompt, answer: PromptAnswer) => Promise<void>;
  /** More controls after Deny (the session's "Reject with reason", "Allow all"). */
  extraActions?: JSX.Element;
  /** Drawn under the request (a reason field). */
  children?: JSX.Element;
  testID?: string;
}

function defaultDevice(prompt: FleetPrompt): AttentionDevice | null {
  const device = fleetDeviceById(prompt.deviceId);
  if (!device) return null;
  return {
    name: device.name,
    kind: device.hostKind,
    exception: device.state === "offline" ? "offline" : device.state === "update_required" ? "update_required" : null,
  };
}

/**
 * One prompt, answerable in place. Permission: [Allow once] primary, Always
 * allow secondary, Deny ghost, spacer, "Open ›". Question: one option row per
 * option (a single-choice single question answers on tap), then "Type an
 * answer" with Send. The answer goes to the device that asked.
 */
export function PromptAttention(props: PromptAttentionProps) {
  const draft = signal<Record<string, string | string[]>>({});
  const typed = signal("");
  const status = () => promptStatus(props.prompt);
  const phase = () => status()?.phase ?? null;
  const busy = () => phase() === "answering";
  const device = () => (props.device === undefined ? defaultDevice(props.prompt) : props.device);
  const isQuestion = () => props.prompt.kind === "question";
  const questions = () => (isQuestion() ? readQuestionPayload(props.prompt.payload) : []);
  const permission = () => permissionRequestText(props.prompt);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = (answer: PromptAnswer, ok: boolean) => {
    if (!ok) return;
    props.onAnswered?.(answer);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      animateLayout(undefined, "spring");
      props.onSettled?.();
    }, ANSWERED_HOLD_MS);
  };

  const reply = (value: PermissionReply) => {
    const answer: PromptAnswer = { kind: "permission", reply: value };
    void answerPrompt(props.prompt, answer, props.send).then(ok => finish(answer, ok));
  };

  const sendAnswers = (answers: Record<string, string | string[]>) => {
    const answer: PromptAnswer = { kind: "question", answers };
    void answerPrompt(props.prompt, answer, props.send).then(ok => finish(answer, ok));
  };

  const single = () => questions().length === 1 && !questions()[0]!.multiSelect;

  const pick = (index: number, label: string) => {
    if (busy()) return;
    const item = questions()[index];
    if (!item) return;
    if (single()) {
      sendAnswers({ "0": label });
      return;
    }
    const key = String(index);
    draft.update(current => {
      if (!item.multiSelect) return { ...current, [key]: label };
      const held = Array.isArray(current[key]) ? (current[key] as string[]) : [];
      return { ...current, [key]: held.includes(label) ? held.filter(value => value !== label) : [...held, label] };
    });
  };

  const isPicked = (index: number, label: string) => {
    const value = draft()[String(index)];
    return Array.isArray(value) ? value.includes(label) : value === label;
  };

  const submitTyped = () => {
    const text = typed().trim();
    const answers: Record<string, string | string[]> = { ...draft() };
    if (text) answers[String(Math.max(0, questions().length - 1))] = text;
    if (Object.keys(answers).length === 0) return;
    sendAnswers(answers);
  };

  const notice = () => {
    switch (phase()) {
      case "unconfirmed":
        return tr("job.unconfirmed");
      case "changed":
        return tr("inbox.changed");
      case "held":
        return tr("inbox.heldOffline");
      case "error":
        return status()?.error ?? "";
      default:
        return "";
    }
  };

  const requestText = () => {
    if (!isQuestion()) return permission().request;
    const first = questions()[0];
    return first ? first.question || first.header : props.prompt.title;
  };

  const unanswerable = () =>
    props.prompt.answerable === false
      ? tr("inbox.cantAnswer", { reason: props.prompt.unanswerableReason || tr("error.unsupported") })
      : "";

  return (
    <AttentionItem
      testID={props.testID ?? `prompt-${props.prompt.promptId}`}
      placement={props.placement}
      state="needs_you"
      device={device()}
      source={props.source ?? props.prompt.title}
      age={props.age}
      request={requestText()}
      command={isQuestion() ? undefined : permission().command || undefined}
      answered={phase() === "answered" ? (status()?.answeredLabel ?? tr("answered.here")) : undefined}
      unanswerableReason={unanswerable() || undefined}
      notice={notice() || undefined}
      noticeTone={phase() === "held" ? "muted" : "danger"}
      onOpen={props.onOpen}
      onShowAll={props.onShowAll}
      accessibilityLabel={props.source ?? props.prompt.title}
      children={props.children}
      actions={
        <If
          when={isQuestion()}
          else={
            <>
              <Button
                label={tr("prompt.allowOnce")}
                variant="primary"
                size="sm"
                accessibilityLabel={`allow-once-${props.prompt.promptId}`}
                loading={busy() && status()?.reply === "once"}
                disabled={busy() || phase() === "held"}
                style={compactLayout() ? { height: 44 } : undefined}
                onPress={() => reply("once")}
              />
              <Button
                label={tr("prompt.always")}
                variant="secondary"
                size="sm"
                accessibilityLabel={`allow-always-${props.prompt.promptId}`}
                loading={busy() && status()?.reply === "always"}
                disabled={busy() || phase() === "held"}
                style={compactLayout() ? { height: 44 } : undefined}
                onPress={() => reply("always")}
              />
              <Button
                label={tr("prompt.deny")}
                variant="ghost"
                size="sm"
                accessibilityLabel={`deny-${props.prompt.promptId}`}
                loading={busy() && status()?.reply === "reject"}
                disabled={busy() || phase() === "held"}
                style={compactLayout() ? { height: 44 } : undefined}
                onPress={() => reply("reject")}
              />
              {props.extraActions}
              <If when={phase() === "changed" || phase() === "unconfirmed" || phase() === "error"}>
                <Button
                  label={tr("common.tryAgain")}
                  variant="ghost"
                  size="sm"
                  onPress={() => resetPromptStatus(props.prompt)}
                />
              </If>
            </>
          }
        >
          <>
            {/* Row 3 flows inline: the options, then "Type an answer" with Send; it wraps on a narrow column. */}
            <Each of={questions()} key={(_item, index) => String(index)}>
              {(item, index) => (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: space.sm,
                    flexBasis: questions().length > 1 ? "100%" : undefined,
                  }}
                >
                  <If when={questions().length > 1 ? item().question || item().header : ""}>
                    {text => <Text style={{ ...textStyle("body"), flexBasis: "100%" }}>{text()}</Text>}
                  </If>
                  <Each of={item().options} key={option => option.label}>
                    {option => (
                      <OptionChip
                        label={option().label}
                        selected={isPicked(index(), option().label)}
                        disabled={busy()}
                        testID={`prompt-option-${props.prompt.promptId}-${index()}-${option().label}`}
                        onPress={() => pick(index(), option().label)}
                      />
                    )}
                  </Each>
                </View>
              )}
            </Each>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexGrow: 1, flexBasis: 240, maxWidth: 420, minWidth: 0 }}>
              <TextField
                value={typed()}
                placeholder={tr("inbox.typeAnswer")}
                size="md"
                disabled={busy()}
                accessibilityLabel={`prompt-answer-${props.prompt.promptId}`}
                style={{ flex: 1, minWidth: 0 }}
                onChange={value => typed.set(value)}
                onSubmit={() => submitTyped()}
              />
              <Button
                label={tr("common.send")}
                variant="secondary"
                size="md"
                accessibilityLabel={`prompt-send-${props.prompt.promptId}`}
                loading={busy()}
                disabled={busy() || (!typed().trim() && Object.keys(draft()).length === 0)}
                style={compactLayout() ? { height: 44 } : undefined}
                onPress={() => submitTyped()}
              />
            </View>
          </>
        </If>
      }
    />
  );
}

// ── Done and Failed lines ────────────────────────────────────────────────────

export interface AttentionLineProps {
  state: MarkState;
  /** A done item the user has seen loses its color. */
  seen?: boolean;
  device?: AttentionDevice | null;
  title: string;
  /** After " — " in `textSecondary` ("3 tests failed"). */
  detail?: string;
  age?: string;
  /** Opens the conversation or session (and marks it read). */
  onOpen?: () => void;
  testID?: string;
}

/** A Done or Failed item: one line of 40, mark · device · title — detail, age, chevron. */
export function AttentionLine(props: AttentionLineProps) {
  return (
    <View
      testID={props.testID}
      role={props.onOpen ? "button" : undefined}
      accessibilityLabel={props.title}
      onPress={props.onOpen ? () => props.onOpen?.() : undefined}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: compactLayout() ? 44 : 40,
        borderRadius: radii.md,
        borderCurve: "continuous",
        cursor: props.onOpen ? "pointer" : undefined,
        ...paintTransition(120),
      }}
      hoverStyle={props.onOpen ? { backgroundColor: palette().panelHover } : undefined}
    >
      <StateMark state={props.state} seen={props.seen} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <If when={props.device}>
          {device => (
            <>
              <DeviceBadge name={device().name} kind={device().kind} exception={device().exception} onPress={device().onPress} />
              <Text style={textStyle("caption")}>·</Text>
            </>
          )}
        </If>
        <Text
          style={{
            ...textStyle("body", { color: palette().text }),
            fontWeight: props.seen ? "400" : "500",
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.detail ? `${props.title} — ` : props.title}
          <If when={props.detail ?? ""}>
            {detail => <Text style={{ color: palette().textSecondary, fontWeight: "400" }}>{detail()}</Text>}
          </If>
        </Text>
      </View>
      <If when={props.age ?? ""}>
        {age => <Text style={{ ...textStyle("caption", { tabular: true }), flexShrink: 0 }}>{age()}</Text>}
      </If>
      <If when={Boolean(props.onOpen)}>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </If>
    </View>
  );
}

// ── The tray ─────────────────────────────────────────────────────────────────

function groupTitle(id: string): string {
  if (id === "needs_you") return tr("inbox.needsYou");
  if (id === "done") return tr("inbox.done");
  if (id === "failed") return tr("inbox.failed");
  return "";
}

/** A preformatted short age ("2 min", "1 h") from the backend's `ageMs`. */
export function formatAge(ageMs: number | undefined): string {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs) || ageMs < 0) return "";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return tr("time.now");
  if (minutes < 60) return tr("time.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tr("time.hours", { count: hours });
  return tr("time.days", { count: Math.floor(hours / 24) });
}

function entryDevice(entry: AttentionEntry, onDevice?: (deviceId: string) => void): AttentionDevice | null {
  const fleet = fleetDeviceById(entry.source.deviceId);
  const name = entry.deviceName ?? fleet?.name ?? "";
  if (!name) return null;
  return {
    name,
    kind: entry.source.deviceId === "cloud" ? "cloud" : (entry.hostKind ?? fleet?.hostKind),
    exception: fleet?.state === "offline" ? "offline" : fleet?.state === "update_required" ? "update_required" : null,
    onPress: onDevice && entry.source.deviceId !== "cloud" ? () => onDevice(entry.source.deviceId) : undefined,
  };
}

function lineState(entry: AttentionEntry, group: AttentionGroup): MarkState {
  if (entry.kind === "failure" || group.id === "failed") return "failed";
  if (entry.kind === "done" || group.id === "done") return "done";
  return markState(entry.kind);
}

export interface AttentionTrayProps {
  /** Opens the session or conversation an item belongs to. */
  onOpen?: (entry: AttentionEntry) => void;
  /** Opens a device page from a device badge. */
  onDevice?: (deviceId: string) => void;
  /** Raised once a device took an answer ("Answered · {device}"). */
  onAnswered?: (entry: AttentionEntry) => void;
  /** The groups to draw; defaults to the store's. */
  groups?: AttentionGroup[];
  /** Sends a prompt's answer instead of the default route (a backend without the fleet layer). */
  sendPrompt?: (prompt: FleetPrompt, answer: PromptAnswer) => Promise<void>;
}

/**
 * The Inbox list: the backend's groups in its order, "Needs you" never folded,
 * items split by hairlines inset 28. A prompt that left the backend's list
 * while drawn stays until its answered hold ends.
 */
export function AttentionTray(props: AttentionTrayProps) {
  const settled = signal<Record<string, true>>({});
  const visible = (group: AttentionGroup) => group.items.filter(item => !settled()[item.itemId]);
  const groups = () => (props.groups ?? attentionGroups()).filter(group => visible(group).length > 0);
  return (
    <If
      when={groups().length > 0}
      else={<EmptyStateCard icon="inbox" title={tr("inbox.emptyTitle")} subtitle={tr("inbox.emptyBody")} />}
    >
      <View style={{ gap: space.x3l }}>
        <Each of={groups()} key={group => group.id}>
          {group => (
            <View testID={`inbox-group-${group().id}`}>
              <If when={groupTitle(group().id)}>
                {title => (
                  <Text
                    style={{
                      ...textStyle("label", { color: palette().textSecondary }),
                      fontWeight: "600",
                      marginBottom: space.sm,
                    }}
                  >
                    {title()}
                  </Text>
                )}
              </If>
              <Each of={visible(group())} key={item => item.itemId}>
                {(item, index) => (
                  <View>
                    <If when={index() > 0}>
                      <View style={{ height: 1, marginLeft: ATTENTION_INDENT, backgroundColor: palette().borderSubtle }} />
                    </If>
                    <If
                      when={item().prompt}
                      else={
                        <AttentionLine
                          testID={`inbox-item-${item().itemId}`}
                          state={lineState(item(), group())}
                          seen={item().unread === false}
                          device={entryDevice(item(), props.onDevice)}
                          title={item().title}
                          detail={item().detail}
                          age={formatAge(item().ageMs)}
                          onOpen={props.onOpen ? () => props.onOpen?.(item()) : undefined}
                        />
                      }
                    >
                      {prompt => (
                        <PromptAttention
                          testID={`inbox-item-${item().itemId}`}
                          prompt={prompt()}
                          placement="inbox"
                          source={item().title}
                          device={entryDevice(item(), props.onDevice)}
                          age={formatAge(item().ageMs)}
                          onOpen={props.onOpen ? () => props.onOpen?.(item()) : undefined}
                          onAnswered={() => props.onAnswered?.(item())}
                          send={props.sendPrompt}
                          onSettled={() => settled.update(current => ({ ...current, [item().itemId]: true }))}
                        />
                      )}
                    </If>
                  </View>
                )}
              </Each>
            </View>
          )}
        </Each>
      </View>
    </If>
  );
}

// ── Review notes ─────────────────────────────────────────────────────────────

export interface ReviewNotesBarProps {
  count: number;
  onSend: () => void;
  sending?: boolean;
  testID?: string;
}

/** "{count} notes" + "Send to agent" in a radius-12 hairline box (spec §4.5). */
export function ReviewNotesBar(props: ReviewNotesBarProps) {
  return (
    <If when={props.count > 0}>
      <View
        testID={props.testID ?? "review-notes-bar"}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: 44,
          paddingHorizontal: space.md,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvas,
        }}
      >
        <Text style={{ ...textStyle("label", { color: palette().text, tabular: true }), flex: 1, minWidth: 0 }}>
          {props.count === 1 ? tr("reviewNotes.countOne") : tr("reviewNotes.count", { count: props.count })}
        </Text>
        <Button
          label={tr("reviewNotes.send")}
          variant="primary"
          size="sm"
          loading={props.sending}
          accessibilityLabel="review-notes-send"
          onPress={() => props.onSend()}
        />
      </View>
    </If>
  );
}

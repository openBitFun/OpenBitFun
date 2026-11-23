// Session parity extras (wave 22 P5): the session goal strip, side questions,
// background commands, MCP prompts in the `/` list and MCP App panels. Each
// piece draws one backend owner's answer (see its store) for the open session
// on the device that runs it; SessionsScene mounts them in anchored slots.

import {
  cleanup,
  Clipboard,
  computed,
  effect,
  Scroll,
  signal,
  Text,
  untracked,
  View,
  WebView,
  type JSX,
  type ScrollRef,
  type ViewRef,
  type WebViewRef,
} from "nsh";
import { Input, TextView } from "nsh/base";
import {
  backgroundCommands,
  backgroundInputDraft,
  backgroundOutputNotice,
  backgroundOutputOpen,
  backgroundOutputText,
  closeBackgroundOutput,
  controlBackgroundCommand,
  loadBackgroundCommands,
  openBackgroundOutput,
  runningBackgroundCommands,
  sendBackgroundInput,
  type BackgroundCommand,
} from "../backgroundCommandsStore";
import { listenEvent } from "../bridge";
import {
  askSideQuestion,
  cancelSideQuestion,
  closeSideQuestion,
  openSideQuestion,
  resetSideQuestionThread,
  sideQuestion,
  sideQuestionDraft,
  sideQuestionHistory,
  sideQuestionOpen,
  sideQuestionUnsupported,
  subscribeSideQuestionEvents,
  type SideQuestion,
} from "../btwStore";
import type { ToolCallView } from "../format";
import {
  clearSessionGoal,
  goalBusy,
  goalIsUnsupported,
  goalOf,
  loadSessionGoal,
  setSessionGoal,
  setSessionGoalStatus,
  subscribeGoalEvents,
  updateSessionGoalObjective,
  type GoalTarget,
  type SessionGoal,
} from "../goalStore";
import { localizeHostError, tr, type MessageKey } from "../i18n";
import {
  closeMcpApp,
  deliverScript,
  handleMcpAppMessage,
  MCP_APP_BRIDGE_SHIM,
  mcpAppDocument,
  mcpAppError,
  mcpAppFor,
  mcpAppLoading,
  mcpAppOpen,
  openMcpApp,
  type McpAppDescriptor,
} from "../mcpAppStore";
import {
  closeMcpPromptForm,
  fetchMcpPromptText,
  loadMcpPrompts,
  mcpPromptBusy,
  mcpPromptError,
  mcpPromptForm,
  mcpPromptsFor,
  mcpPromptValues,
  openMcpPromptForm,
  type McpPromptEntry,
} from "../mcpPromptsStore";
import {
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceId,
  activeWorkspaceRoot,
  composerText,
  sessionSplitRatio,
} from "../state";
import { compactLayout, controlHeight, fontMono, layout, palette, radii, space, textLineHeight, textSize, textStyle } from "../theme";
import { createMarkdownStyles, STATIC_MARKDOWN_OPTIONS, STREAMING_MARKDOWN_OPTIONS } from "./markdown";
import { BrandSpinner, MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import { DropdownMenu, ModalDialog, pushToast, type DropdownMenuItem } from "./overlays";
import { Button, IconButton, IconCircleButton, TextField, focusRingStyle } from "./primitives";
import { Icon } from "./icons";

function errorText(error: unknown): string {
  return localizeHostError(error instanceof Error ? error.message : String(error ?? ""));
}

function goalTarget(): GoalTarget | null {
  const sessionId = activeSessionId();
  if (!sessionId) return null;
  return { sessionId, deviceId: activeSessionDevice(), workspaceId: activeWorkspaceId() };
}

let extrasMountCount = 0;
let extrasTimer: ReturnType<typeof setTimeout> | null = null;
let extrasUnsubTool: (() => void) | null = null;
let extrasUnsubTurn: (() => void) | null = null;

/** Starts the per-session reads; mounted once with the session scene. */
export function useSessionExtras(): void {
  subscribeGoalEvents();
  subscribeSideQuestionEvents();
  effect(() => {
    const target = goalTarget();
    if (!target) return;
    void loadSessionGoal(target);
    void loadBackgroundCommands({ sessionId: target.sessionId, deviceId: target.deviceId });
  });
  effect(() => {
    if (!activeSessionId()) return;
    void loadMcpPrompts(activeSessionDevice());
  });
  extrasMountCount += 1;
  if (extrasMountCount === 1) {
    // Background commands start and end with the agent's tool calls.
    const refresh = (payload: unknown) => {
      const sessionId = payload && typeof payload === "object" ? (payload as Record<string, unknown>).sessionId : null;
      const target = goalTarget();
      if (!target || sessionId !== target.sessionId) return;
      if (extrasTimer) clearTimeout(extrasTimer);
      extrasTimer = setTimeout(() => {
        extrasTimer = null;
        void loadBackgroundCommands({ sessionId: target.sessionId, deviceId: target.deviceId });
      }, 600);
    };
    extrasUnsubTool = listenEvent("agentic://tool-event", refresh);
    extrasUnsubTurn = listenEvent("agentic://dialog-turn-completed", refresh);
  }
  cleanup(() => {
    extrasMountCount -= 1;
    if (extrasMountCount <= 0) {
      extrasMountCount = 0;
      if (extrasTimer) {
        clearTimeout(extrasTimer);
        extrasTimer = null;
      }
      extrasUnsubTool?.();
      extrasUnsubTool = null;
      extrasUnsubTurn?.();
      extrasUnsubTurn = null;
    }
  });
}

// ── Goal ──────────────────────────────────────────────────────────────────────

const goalDialog = signal<"set" | "edit" | null>(null);
const goalDraft = signal("");
const goalError = signal("");
const goalMenuOpen = signal(false);
const goalMenuAnchor = signal<ViewRef | null>(null);

const GOAL_STATUS_KEYS: Record<string, MessageKey> = {
  active: "goal.status.active",
  paused: "goal.status.paused",
  blocked: "goal.status.blocked",
  usageLimited: "goal.status.usageLimited",
  budgetLimited: "goal.status.budgetLimited",
  complete: "goal.status.complete",
};

function goalStatusWord(goal: SessionGoal): string {
  const key = GOAL_STATUS_KEYS[goal.status];
  return key ? tr(key) : goal.status;
}

export function openGoalDialog(): void {
  const target = goalTarget();
  const goal = target ? goalOf(target) : null;
  goalDraft.set(goal?.objective ?? "");
  goalError.set("");
  goalDialog.set(goal ? "edit" : "set");
}

async function submitGoal(): Promise<void> {
  const target = goalTarget();
  const text = goalDraft().trim();
  if (!target || !text) return;
  try {
    if (goalDialog() === "edit") await updateSessionGoalObjective(target, text);
    else await setSessionGoal(target, text);
    goalDialog.set(null);
  } catch (error) {
    goalError.set(errorText(error));
  }
}

async function runGoalAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

function goalMenuItems(goal: SessionGoal, target: GoalTarget): DropdownMenuItem[] {
  const paused = goal.status === "paused";
  const done = goal.status === "complete";
  const items: DropdownMenuItem[] = [
    {
      id: "goal-edit",
      label: tr("goal.edit"),
      icon: "edit",
      accessibilityLabel: "goal-menu-edit",
      onSelect: () => openGoalDialog(),
    },
  ];
  if (!done) {
    items.push(
      {
        id: "goal-pause",
        label: paused ? tr("goal.resume") : tr("goal.pause"),
        icon: paused ? "play" : "pause",
        accessibilityLabel: paused ? "goal-menu-resume" : "goal-menu-pause",
        onSelect: () => void runGoalAction(() => setSessionGoalStatus(target, paused ? "active" : "paused")),
      },
      {
        id: "goal-complete",
        label: tr("goal.markComplete"),
        icon: "check",
        accessibilityLabel: "goal-menu-complete",
        onSelect: () => void runGoalAction(() => setSessionGoalStatus(target, "complete")),
      },
    );
  }
  items.push({
    id: "goal-clear",
    label: tr("goal.clear"),
    icon: "trash",
    danger: true,
    separator: true,
    accessibilityLabel: "goal-menu-clear",
    onSelect: () => void runGoalAction(() => clearSessionGoal(target)),
  });
  return items;
}

/** One quiet line under the session header while the session has a goal. */
export function GoalStrip(): JSX.Element {
  const current = computed(() => {
    const target = goalTarget();
    if (!target) return null;
    const goal = goalOf(target);
    return goal ? { goal, target } : null;
  });
  return (
    <If when={current()}>
      {entry => (
        <View
          accessibilityLabel="session-goal-strip"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: space.x3l,
            paddingHorizontal: compactLayout() ? space.lg : space.xxl,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Icon name="circle-dot" size={14} color={palette().textMuted} />
          <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("goal.label")}</Text>
          <Text
            style={{
              ...textStyle("label", { color: palette().text }),
              fontWeight: "400",
              flex: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {entry().goal.objective}
          </Text>
          <Text style={textStyle("caption", { color: palette().textMuted })}>{goalStatusWord(entry().goal)}</Text>
          <View ref={el => goalMenuAnchor.set(el)}>
            <IconButton
              icon="more"
              size="xs"
              tooltip={tr("goal.actions")}
              accessibilityLabel="session-goal-menu"
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => goalMenuOpen.set(!goalMenuOpen())}
            />
          </View>
          <DropdownMenu
            open={goalMenuOpen()}
            anchor={goalMenuAnchor()}
            items={goalMenuItems(entry().goal, entry().target)}
            placement="bottom"
            align="end"
            onClose={() => goalMenuOpen.set(false)}
          />
        </View>
      )}
    </If>
  );
}

/** Whether the open session's host can hold a goal (an older one says so instead). */
export function goalAvailable(): boolean {
  const target = goalTarget();
  return Boolean(target) && !goalIsUnsupported(target as GoalTarget);
}

function GoalDialog(): JSX.Element {
  return (
    <ModalDialog
      open={goalDialog() !== null}
      title={goalDialog() === "edit" ? tr("goal.editTitle") : tr("goal.setTitle")}
      subtitle={tr("goal.body")}
      size="md"
      accessibilityLabel="session-goal-dialog"
      onClose={() => goalDialog.set(null)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => goalDialog.set(null)} />
          <Button
            label={goalDialog() === "edit" ? tr("common.save") : tr("goal.start")}
            variant="primary"
            size="md"
            loading={goalBusy()}
            disabled={!goalDraft().trim()}
            accessibilityLabel="session-goal-save"
            onPress={() => void submitGoal()}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <TextField
          autoFocus
          multiline
          minHeight={space.x6l}
          label={tr("goal.objective")}
          placeholder={tr("goal.placeholder")}
          value={goalDraft()}
          accessibilityLabel="session-goal-input"
          onChange={value => goalDraft.set(value)}
        />
        <If when={goalError()}>
          <Text style={textStyle("caption", { color: palette().danger })}>{goalError()}</Text>
        </If>
      </View>
    </ModalDialog>
  );
}

// ── Side question (ephemeral right-side split pane) ──────────────────────────

function sideQuestionEntryStateText(entry: SideQuestion): string {
  if (entry.state === "running") return entry.answer ? "" : tr("btw.thinking");
  if (entry.state === "cancelled") return tr("btw.stopped");
  if (entry.state === "failed") {
    return sideQuestionUnsupported()
      ? tr("btw.hostUpdate")
      : tr("btw.failed", { error: errorText(entry.error ?? "") });
  }
  return "";
}

function askFromSidePane(): void {
  const sessionId = activeSessionId();
  if (!sessionId) return;
  void askSideQuestion(
    {
      sessionId,
      deviceId: activeSessionDevice(),
      workspaceId: activeWorkspaceId(),
      workspacePath: activeWorkspaceRoot() || null,
    },
    sideQuestionDraft(),
  );
}

function SideQuestionPaneBody(): JSX.Element {
  let scrollRef: ScrollRef | undefined;
  const composing = signal(false);
  const copiedId = signal("");
  const running = () => sideQuestion()?.state === "running";
  const canSend = () => Boolean(activeSessionId()) && sideQuestionDraft().trim().length > 0 && !running();

  effect(() => {
    const history = sideQuestionHistory();
    const latest = history[history.length - 1];
    latest?.answer.length;
    latest?.state;
    scrollRef?.scrollToEnd({ animated: false });
  });

  const firstTitle = () => {
    const first = sideQuestionHistory()[0]?.question?.trim();
    if (!first) return "";
    return first.length > 36 ? `${first.slice(0, 36)}…` : first;
  };

  return (
    <View
      testID="side-question-pane"
      accessibilityLabel="side-question-sheet"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      {/* Header aligned to `layout.topBarHeight` with the primary conversation header */}
      <View
        style={{
          height: layout.topBarHeight,
          minHeight: layout.topBarHeight,
          paddingHorizontal: space.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: palette().canvas,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          flexShrink: 0,
        }}
      >
        <Icon name="sparkles" size={14} color={palette().accent} />
        <Text
          style={{
            ...textStyle("sectionTitle", { color: palette().text }),
            flexShrink: 0,
          }}
        >
          {tr("btw.title")}
        </Text>
        <If when={firstTitle()}>
          {title => (
            <Text
              style={{
                ...textStyle("caption", { color: palette().textMuted }),
                flex: 1,
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {`· ${title()}`}
            </Text>
          )}
        </If>
        <If when={!firstTitle()}>
          <View style={{ flex: 1, minWidth: 0 }} />
        </If>
        <If when={sideQuestionHistory().length > 0}>
          <IconButton
            icon="plus"
            size="sm"
            accessibilityLabel="side-question-new"
            tooltip={tr("nav.newSession")}
            onPress={() => resetSideQuestionThread()}
          />
        </If>
        <IconButton
          icon="close"
          size="sm"
          accessibilityLabel="side-question-close"
          tooltip={tr("common.close")}
          onPress={() => closeSideQuestion()}
        />
      </View>

      {/* Scrollable ephemeral conversation transcript */}
      <Scroll
        ref={el => {
          scrollRef = el;
        }}
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{
          flexGrow: 1,
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
        }}
      >
        <View style={{ width: "100%", flexGrow: 1, gap: space.lg }}>
          <If when={sideQuestionHistory().length === 0}>
            <View
              style={{
                flexGrow: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: space.lg,
                gap: space.sm,
              }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  backgroundColor: palette().surfaceTertiary,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="sparkles" size={16} color={palette().accent} />
              </View>
              <Text style={textStyle("sectionTitle")}>{tr("btw.title")}</Text>
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textMuted }),
                  textAlign: "center",
                  maxWidth: 320,
                }}
              >
                {tr("btw.body")}
              </Text>
            </View>
          </If>

          <Each of={sideQuestionHistory()} key={entry => entry.requestId}>
            {(entry, idx) => (
              <View style={{ gap: space.md }}>
                {/* Right-aligned user question bubble */}
                <View style={{ alignItems: "flex-end", gap: space.xs }}>
                  <View
                    style={{
                      maxWidth: "88%",
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      backgroundColor: palette().surfaceTertiary,
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      gap: space.xs,
                    }}
                  >
                    <If when={idx() === 0}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                        <Icon name="git-branch" size={11} color={palette().textMuted} />
                        <Text style={textStyle("caption", { color: palette().textMuted })}>
                          {tr("btw.body")}
                        </Text>
                      </View>
                    </If>
                    <Text
                      accessibilityLabel="side-question-asked"
                      style={{
                        color: palette().text,
                        fontSize: textSize(14),
                        lineHeight: textLineHeight(14, 1.5),
                      }}
                    >
                      {entry().question}
                    </Text>
                  </View>
                </View>

                {/* Streamed assistant answer */}
                <If when={entry().answer}>
                  <View style={{ gap: space.xs }}>
                    <View accessibilityLabel="side-question-answer">
                      <TextView
                        markdown={entry().answer}
                        selectable
                        options={entry().state === "running" ? STREAMING_MARKDOWN_OPTIONS : STATIC_MARKDOWN_OPTIONS}
                        styles={createMarkdownStyles()}
                      />
                    </View>
                    <If when={entry().state !== "running"}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                        <IconButton
                          icon={copiedId() === entry().requestId ? "check" : "copy"}
                          size="xs"
                          accessibilityLabel={`side-question-copy-${entry().requestId}`}
                          tooltip={tr("common.copy")}
                          onPress={() => {
                            const id = entry().requestId;
                            void Clipboard.writeText(entry().answer).then(() => {
                              copiedId.set(id);
                              setTimeout(() => {
                                if (copiedId() === id) copiedId.set("");
                              }, 1500);
                            });
                          }}
                        />
                      </View>
                    </If>
                  </View>
                </If>

                <If when={sideQuestionEntryStateText(entry())}>
                  {statusText => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                      <If when={entry().state === "running"}>
                        <BrandSpinner size={13} />
                      </If>
                      <Text
                        accessibilityLabel="side-question-state"
                        style={textStyle("caption", {
                          color: entry().state === "failed" ? palette().danger : palette().textMuted,
                        })}
                      >
                        {statusText()}
                      </Text>
                    </View>
                  )}
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>

      {/* Bottom floating composer matching main session composer */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.chip, paddingBottom: space.lg, flexShrink: 0 }}>
        <View
          style={{
            width: "100%",
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().inputBg,
            boxShadow: palette().shadowComposer,
            overflow: "hidden",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          focusWithinStyle={{
            borderColor: palette().fieldFocusBorder,
            boxShadow: palette().shadowComposerFocus,
          }}
        >
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs }}>
            <Input
              autoFocus
              multiline
              submitBehavior="submit"
              readonly={running()}
              value={sideQuestionDraft()}
              placeholder={tr("btw.placeholder")}
              accessibilityLabel="side-question-input"
              onChange={event => sideQuestionDraft.set(event.value)}
              onCompositionChange={event => composing.set(event.composing)}
              onSubmit={() => {
                if (!composing() && canSend()) askFromSidePane();
              }}
              style={{
                minHeight: controlHeight.sm,
                maxHeight: 140,
                color: palette().text,
                placeholderColor: palette().textMuted,
                caretColor: palette().accent,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.5),
              }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingHorizontal: space.sm,
              paddingBottom: space.sm,
              gap: space.xs,
            }}
          >
            <If
              when={running()}
              else={
                <IconCircleButton
                  icon="arrow-up"
                  variant={canSend() ? "primary" : "subtle"}
                  size={32}
                  iconSize={16}
                  disabled={!canSend()}
                  accessibilityLabel="side-question-ask"
                  tooltip={tr("btw.ask")}
                  onPress={askFromSidePane}
                />
              }
            >
              <IconCircleButton
                icon="stop"
                variant="primary"
                size={32}
                iconSize={14}
                accessibilityLabel="side-question-stop"
                tooltip={tr("btw.stop")}
                onPress={() => void cancelSideQuestion()}
              />
            </If>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Right-side ephemeral split pane for `/btw` on desktop viewports. */
export function SideQuestionSplitPane(): JSX.Element {
  return (
    <View
      style={{
        flexGrow: 1 - sessionSplitRatio(),
        flexBasis: 0,
        minWidth: 280,
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      <SideQuestionPaneBody />
    </View>
  );
}

/** Compact/phone fallback sheet only when side-by-side split is unavailable. */
function SideQuestionCompactSheet(): JSX.Element {
  return (
    <ModalDialog
      open={sideQuestionOpen() && compactLayout()}
      title={tr("btw.title")}
      size="lg"
      accessibilityLabel="side-question-compact-sheet"
      onClose={() => closeSideQuestion()}
    >
      <View style={{ minHeight: 340, maxHeight: 560 }}>
        <SideQuestionPaneBody />
      </View>
    </ModalDialog>
  );
}

export { openSideQuestion, sideQuestionOpen };

// ── Background commands ───────────────────────────────────────────────────────

const backgroundListOpen = signal(false);

const BACKGROUND_STATUS_KEYS: Record<string, MessageKey> = {
  running: "background.status.running",
  exited: "background.status.exited",
  interrupted: "background.status.interrupted",
  killed: "background.status.killed",
  pruned: "background.status.pruned",
  failed: "background.status.failed",
};

function backgroundStatusWord(command: BackgroundCommand): string {
  if (command.status === "exited" && typeof command.exitCode === "number") {
    return tr("background.exitedWith", { code: command.exitCode });
  }
  const key = BACKGROUND_STATUS_KEYS[command.status];
  return key ? tr(key) : command.status;
}

/** A 32 row above the composer while the session has commands running. */
export function BackgroundCommandsStrip(): JSX.Element {
  const running = computed(() => runningBackgroundCommands().length);
  return (
    <If when={running() > 0}>
      <View
        role="button"
        accessibilityLabel="background-commands-strip"
        onPress={() => backgroundListOpen.set(true)}
        style={{
          alignSelf: "center",
          width: "100%",
          maxWidth: layout.conversationWidth,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: compactLayout() ? layout.touchTarget : space.x3l,
          paddingHorizontal: space.lg,
          borderRadius: radii.md,
          borderCurve: "continuous",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.985)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon name="terminal" size={14} color={palette().textMuted} />
        <Text style={{ ...textStyle("label", { color: palette().textSecondary }), flex: 1, minWidth: 0 }}>
          {running() === 1
            ? tr("background.runningOne")
            : tr("background.runningOther", { count: running() })}
        </Text>
        <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("background.show")}</Text>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </View>
    </If>
  );
}

function BackgroundCommandRow(props: { command: BackgroundCommand }) {
  return (
    <View
      role="button"
      accessibilityLabel={`background-command-${props.command.execSessionId}`}
      onPress={() => void openBackgroundOutput(props.command, activeSessionDevice())}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: compactLayout() ? layout.touchTarget : space.xxl + space.lg,
        paddingHorizontal: space.sm,
        borderRadius: radii.md,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{
          ...textStyle("mono", { color: palette().text }),
          fontFamily: fontMono,
          flex: 1,
          minWidth: 0,
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.command.command}
      </Text>
      <Text style={textStyle("caption", { color: palette().textMuted, tabular: true })}>
        {backgroundStatusWord(props.command)}
      </Text>
    </View>
  );
}

function BackgroundCommandsDialog(): JSX.Element {
  const viewing = () => backgroundOutputOpen();
  const running = () => viewing()?.status === "running";
  return (
    <ModalDialog
      open={backgroundListOpen()}
      title={viewing() ? tr("background.outputTitle") : tr("background.title")}
      size="lg"
      accessibilityLabel="background-commands-dialog"
      onClose={() => {
        closeBackgroundOutput();
        backgroundListOpen.set(false);
      }}
      footer={
        <If when={viewing()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("background.back")}
              variant="ghost"
              size="md"
              leadingIcon="chevron-left"
              accessibilityLabel="background-output-back"
              onPress={() => closeBackgroundOutput()}
            />
            <View style={{ flex: 1 }} />
            <Button
              label={tr("background.interrupt")}
              variant="secondary"
              size="md"
              disabled={!running()}
              accessibilityLabel="background-output-interrupt"
              onPress={() => void controlBackgroundCommand("interrupt").catch(error => pushToast(errorText(error), "error"))}
            />
            <Button
              label={tr("background.kill")}
              variant="danger"
              size="md"
              disabled={!running()}
              accessibilityLabel="background-output-kill"
              onPress={() => void controlBackgroundCommand("kill").catch(error => pushToast(errorText(error), "error"))}
            />
          </View>
        </If>
      }
    >
      <If
        when={viewing()}
        else={
          <View style={{ gap: space.hair }}>
            <If when={backgroundCommands().length === 0}>
              <Text style={textStyle("body", { color: palette().textSecondary })}>{tr("background.none")}</Text>
            </If>
            <Each of={backgroundCommands()} key={command => String(command.execSessionId)}>
              {command => <BackgroundCommandRow command={command()} />}
            </Each>
          </View>
        }
      >
        {command => (
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text
                style={{
                  ...textStyle("mono", { color: palette().text }),
                  fontFamily: fontMono,
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {command().command}
              </Text>
              <Text style={textStyle("caption", { color: palette().textMuted })}>{backgroundStatusWord(command())}</Text>
            </View>
            <Scroll
              style={{
                height: 320,
                minHeight: 0,
                borderRadius: radii.md,
                backgroundColor: palette().surfaceTertiary,
              }}
              scrollbar={true}
            >
              <Text
                accessibilityLabel="background-output-text"
                style={{
                  ...textStyle("monoBlock", { color: palette().text }),
                  fontFamily: fontMono,
                  padding: space.md,
                  userSelect: "text",
                }}
              >
                {backgroundOutputText() || tr("background.noOutput")}
              </Text>
            </Scroll>
            <If when={running()}>
              <TextField
                monospace
                placeholder={tr("background.inputPlaceholder")}
                value={backgroundInputDraft()}
                accessibilityLabel="background-output-input"
                onChange={value => backgroundInputDraft.set(value)}
                onSubmit={text => void sendBackgroundInput(text).catch(error => pushToast(errorText(error), "error"))}
              />
            </If>
            <If when={backgroundOutputNotice()}>
              <Text style={textStyle("caption", { color: palette().danger })}>{errorText(backgroundOutputNotice())}</Text>
            </If>
          </View>
        )}
      </If>
    </ModalDialog>
  );
}

// ── MCP prompts ───────────────────────────────────────────────────────────────

/** The MCP prompts a typed `/token` lists. */
export const mcpPromptMatches = computed(() => (activeSessionId() ? mcpPromptsFor(composerText()) : []));

async function usePrompt(entry: McpPromptEntry, values: Record<string, string> = {}): Promise<void> {
  mcpPromptBusy.set(true);
  try {
    const text = await fetchMcpPromptText(entry, activeSessionDevice(), values);
    composerText.set(text);
    closeMcpPromptForm();
  } catch (error) {
    if (mcpPromptForm()) mcpPromptError.set(errorText(error));
    else pushToast(errorText(error), "error");
  } finally {
    mcpPromptBusy.set(false);
  }
}

/** Picks a prompt: one with arguments opens its form, one without fills the composer. */
export function chooseMcpPrompt(entry: McpPromptEntry): void {
  if (entry.arguments.length > 0) openMcpPromptForm(entry);
  else {
    composerText.set("");
    void usePrompt(entry);
  }
}

/** The prompt rows under the session commands in the `/` list. */
export function McpPromptRows(): JSX.Element {
  return (
    <If when={mcpPromptMatches().length > 0}>
      <View style={{ gap: space.hair }}>
        <Text
          style={{
            ...textStyle("caption", { color: palette().textMuted }),
            paddingHorizontal: space.sm,
            paddingTop: space.xs,
          }}
        >
          {tr("mcpPrompts.title")}
        </Text>
        <Each of={mcpPromptMatches()} key={entry => `${entry.serverId}/${entry.name}`}>
          {entry => (
            <View
              role="button"
              accessibilityLabel={`mcp-prompt-${entry().serverId}-${entry().name}`}
              onPress={() => chooseMcpPrompt(entry())}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                minHeight: compactLayout() ? layout.touchTarget : space.x3l,
                paddingHorizontal: space.sm,
                paddingVertical: space.chip,
                borderRadius: radii.md,
                borderCurve: "continuous",
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().panelHover }}
              activeStyle={tactileActiveStyle(0.985)}
              focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
            >
              <Icon name="plug" size={14} color={palette().textMuted} />
              <Text style={{ ...textStyle("mono", { color: palette().text }), fontFamily: fontMono }}>
                {entry().title ?? entry().name}
              </Text>
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textMuted }),
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {entry().description ?? entry().serverName}
              </Text>
            </View>
          )}
        </Each>
      </View>
    </If>
  );
}

function McpPromptDialog(): JSX.Element {
  const entry = () => mcpPromptForm();
  const missing = () =>
    (entry()?.arguments ?? []).some(argument => argument.required && !(mcpPromptValues()[argument.name] ?? "").trim());
  return (
    <ModalDialog
      open={entry() !== null}
      title={entry()?.title ?? entry()?.name ?? ""}
      subtitle={entry() ? tr("mcpPrompts.from", { server: entry()?.serverName ?? "" }) : undefined}
      size="md"
      accessibilityLabel="mcp-prompt-dialog"
      onClose={() => closeMcpPromptForm()}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => closeMcpPromptForm()} />
          <Button
            label={tr("mcpPrompts.insert")}
            variant="primary"
            size="md"
            loading={mcpPromptBusy()}
            disabled={missing()}
            accessibilityLabel="mcp-prompt-insert"
            onPress={() => {
              const current = entry();
              if (current) void usePrompt(current, mcpPromptValues());
            }}
          />
        </View>
      }
    >
      <View style={{ gap: space.md }}>
        <If when={entry()?.description ?? ""}>
          {text => <Text style={textStyle("body", { color: palette().textSecondary })}>{text()}</Text>}
        </If>
        <Each of={entry()?.arguments ?? []} key={argument => argument.name}>
          {argument => (
            <TextField
              label={argument().required ? `${argument().title ?? argument().name} *` : (argument().title ?? argument().name)}
              hint={argument().description}
              value={mcpPromptValues()[argument().name] ?? ""}
              accessibilityLabel={`mcp-prompt-arg-${argument().name}`}
              onChange={value => mcpPromptValues.set({ ...mcpPromptValues(), [argument().name]: value })}
            />
          )}
        </Each>
        <If when={mcpPromptError()}>
          <Text style={textStyle("caption", { color: palette().danger })}>{mcpPromptError()}</Text>
        </If>
      </View>
    </ModalDialog>
  );
}

// ── MCP App panels ────────────────────────────────────────────────────────────

const appDescriptors = signal<Record<string, McpAppDescriptor | null>>({});
const pendingAppLookups = new Set<string>();

/** "Open app" on a finished MCP tool call whose tool declares a UI; nothing otherwise. */
export function McpAppLauncher(props: { call: ToolCallView; cardId: string }): JSX.Element {
  const done = computed(() => props.call.status === "completed" || props.call.success === true);
  const key = computed(() => `${activeSessionDevice()}/${props.cardId}`);
  effect(() => {
    if (!done()) return;
    const currentKey = key();
    const device = activeSessionDevice();
    const call = props.call;
    if (currentKey in untracked(appDescriptors) || pendingAppLookups.has(currentKey)) return;
    pendingAppLookups.add(currentKey);
    void mcpAppFor(call, device)
      .then(found => {
        appDescriptors.set({ ...untracked(appDescriptors), [currentKey]: found });
      })
      .catch(() => undefined)
      .finally(() => {
        pendingAppLookups.delete(currentKey);
      });
  });
  return (
    <If when={done() ? (appDescriptors()[key()] ?? null) : null}>
      {descriptor => (
        <Button
          label={tr("mcpApp.open")}
          variant="secondary"
          size="sm"
          leadingIcon="layout-grid"
          accessibilityLabel={`mcp-app-open-${props.cardId}`}
          style={{
            alignSelf: "flex-start",
            minHeight: compactLayout() ? layout.touchTarget : undefined,
          }}
          onPress={() => void openMcpApp(descriptor())}
        />
      )}
    </If>
  );
}

function McpAppPanel(): JSX.Element {
  let frame: WebViewRef | null = null;
  const post = (message: unknown) => frame?.injectJavaScript(deliverScript(message));
  return (
    <ModalDialog
      open={mcpAppOpen() !== null}
      title={tr("mcpApp.title")}
      subtitle={mcpAppOpen()?.toolName}
      size="lg"
      accessibilityLabel="mcp-app-panel"
      onClose={() => closeMcpApp()}
    >
      <View style={{ gap: space.sm }}>
        <If when={mcpAppLoading()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs }}>
            <BrandSpinner variant="matrix" size={12} color={palette().accent} />
            <Text style={textStyle("label", { color: palette().textMuted })}>{tr("mcpApp.loading")}</Text>
          </View>
        </If>
        <If when={mcpAppError()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text accessibilityLabel="mcp-app-error" style={{ ...textStyle("label", { color: palette().textSecondary }), flex: 1, minWidth: 0 }}>
              {mcpAppError() === "empty" ? tr("mcpApp.empty") : tr("mcpApp.failed", { error: errorText(mcpAppError()) })}
            </Text>
            <If when={mcpAppOpen()}>
              {current => (
                <Button
                  label={tr("common.tryAgain")}
                  variant="ghost"
                  size="sm"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => void openMcpApp(current())}
                />
              )}
            </If>
          </View>
        </If>
        <If when={mcpAppDocument()}>
          {document => (
            <WebView
              ref={node => {
                frame = node;
              }}
              accessibilityLabel="mcp-app-frame"
              html={document().html}
              incognito
              injectedJavaScriptBeforeContentLoaded={MCP_APP_BRIDGE_SHIM}
              onMessage={event =>
                void handleMcpAppMessage(event.data, post, {
                  hostVersion: "2.0",
                  onMessage: text => {
                    composerText.set(text);
                    closeMcpApp();
                  },
                })
              }
              onError={event => mcpAppError.set(event.message || "error")}
              style={{
                height: Math.min(Math.max(document().height ?? 420, 160), compactLayout() ? 420 : 540),
                alignSelf: "stretch",
                borderRadius: radii.md,
                overflow: "hidden",
              }}
            />
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

/** Every dialog of this module; mounted once by the session scene. */
export function SessionExtrasDialogs(): JSX.Element {
  return (
    <>
      <GoalDialog />
      <SideQuestionCompactSheet />
      <BackgroundCommandsDialog />
      <McpPromptDialog />
      <McpAppPanel />
    </>
  );
}

/**
 * `/goal <objective>` and `/btw <question>` typed in the composer; the host's
 * own session commands come first, so these run only when it offers neither.
 */
export function runExtrasCommand(text: string): boolean {
  const match = /^\/(goal|btw)(?:\s+([\s\S]+))?$/i.exec(text.trim());
  const target = goalTarget();
  if (!match || !target) return false;
  const cmd = match[1]!.toLowerCase();
  const body = (match[2] ?? "").trim();
  if (cmd === "goal") {
    if (!body || /^edit$/i.test(body)) {
      openGoalDialog();
    } else if (/^clear$/i.test(body)) {
      void clearSessionGoal(target).catch(error => pushToast(errorText(error), "error"));
    } else if (/^pause$/i.test(body)) {
      void setSessionGoalStatus(target, "paused").catch(error => pushToast(errorText(error), "error"));
    } else if (/^resume$/i.test(body)) {
      void setSessionGoalStatus(target, "active").catch(error => pushToast(errorText(error), "error"));
    } else {
      void setSessionGoal(target, body).catch(error => pushToast(errorText(error), "error"));
    }
    return true;
  }
  if (!body) {
    openSideQuestion();
  } else {
    openSideQuestion();
    void askSideQuestion(
      {
        sessionId: target.sessionId,
        deviceId: target.deviceId,
        workspaceId: target.workspaceId,
        workspacePath: activeWorkspaceRoot() || null,
      },
      body,
    );
  }
  return true;
}

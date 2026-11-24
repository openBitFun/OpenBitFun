// Session parity extras (wave 22 P5): the session goal strip, side questions,
// background commands, MCP prompts in the `/` list and MCP App panels. Each
// piece draws one backend owner's answer (see its store) for the open session
// on the device that runs it; SessionsScene mounts them in anchored slots.

import {
  cleanup,
  computed,
  effect,
  Scroll,
  signal,
  Text,
  untracked,
  View,
  WebView,
  type JSX,
  type ViewRef,
  type WebViewRef,
} from "nsh";
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
  openSideQuestion,
  sideQuestionOpen,
  subscribeSideQuestionEvents,
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
} from "../state";
import {
  compactLayout,
  controlHeight,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
} from "../theme";
import { BrandSpinner, MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import {
  DropdownMenu,
  ListRowContent,
  ModalDialog,
  listRowHoverBg,
  pushToast,
  type DropdownMenuItem,
} from "./overlays";
import { Button, IconButton, TextField, focusRingStyle } from "./primitives";
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

// Side questions (`/btw`) share the unified session pane/transcript/composer
// primitives in `SessionsScene.tsx` so primary, split, and `/btw` maintain one UI.
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
            color: palette().textMuted,
            fontSize: textSize(12),
            fontWeight: "500",
            lineHeight: textLineHeight(12, 1.3),
            paddingHorizontal: space.sm,
            paddingTop: space.sm,
            paddingBottom: space.xs,
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
                minHeight: compactLayout() ? layout.touchTarget : controlHeight.md,
                paddingHorizontal: space.sm,
                paddingVertical: 7,
                borderRadius: radii.md,
                borderCurve: "continuous",
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: listRowHoverBg() }}
              activeStyle={tactileActiveStyle(0.985, { backgroundColor: palette().buttonSecondaryHover })}
              focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
            >
              <ListRowContent
                icon="plug"
                iconColor={palette().textSecondary}
                title={entry().title ?? entry().name}
                titleWeight="500"
                subtitle={entry().description ?? entry().serverName}
              />
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
      onSubmit={() => {
        const current = entry();
        if (current && !missing() && !mcpPromptBusy()) void usePrompt(current, mcpPromptValues());
      }}
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

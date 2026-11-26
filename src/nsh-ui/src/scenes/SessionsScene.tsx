/**
 * Sessions conversation viewport — combines OpenBitFun Tauri's `FlowChat` Muse
 * progressive-disclosure transcript and 3-band `ChatInput` dock with the calm,
 * borderless editorial craft of Codex, Antigravity, and Claude Desktop.
 * Navigation across workspaces and sessions is owned by `App.tsx`'s `NavPanel`.
 */

import { Buffer } from "buffer";
import { Canvas, cleanup, Clipboard, computed, effect, Image, List, openUrl, Overlay, reduceMotion, Scroll, signal, Text, untracked, View } from "nsh";
import type {
  Align,
  Bounds,
  InputRef,
  JSX,
  ListRef,
  Motion,
  PasteEvent,
  Placement,
  ScrollEvent,
  ScrollRef,
  Signal,
  ViewRef,
  ViewStyle,
  ViewToken,
} from "nsh";
import { DiffView, Input, TextView } from "nsh/base";
import { invokeCommand } from "../bridge";
import { CaptionActionStrip, SceneCaptionInset } from "../ui/titleBar";
import {
  getLiveRoundText,
  getLiveRoundThinking,
  getSecondaryLiveRoundText,
  getSecondaryLiveRoundThinking,
  hasLiveContent,
  hasLiveRoundTailText,
  hasLiveRoundText,
  hasLiveRoundThinking,
  hasLiveText,
  hasLiveThinking,
  hasLiveTools,
  hasSecondaryLiveRoundTailText,
  hasSecondaryLiveRoundText,
  hasSecondaryLiveRoundThinking,
  isStreamDraining,
  liveTurn,
  secondaryLiveTurn,
  secondaryStreamScrollTick,
  streamScrollTick,
  turnStartedAt,
  type LiveModelRound,
  type LiveToolItem,
  hasVisibleTextFrom,
} from "../agentEvents";
import { recoverInterruptedDialogTurn, rollbackSessionToTurn, type TranscriptTurnView } from "../api";
import {
  chooseSessionPermissionMode,
  contextUsage,
  effectivePermissionMode,
  followsDefaultMode,
  loadSessionPermissionMode,
  permissionModeNotice,
  permissionModePickerOpen,
  permissionModeSupported,
  subscribeContextUsage,
} from "../composerStatusStore";
import { permissionMode } from "../permissionPolicyStore";
import { isRemoteWorkspace } from "../shared/workspaceUtils";
import {
  ExploreGroupCard,
  FoldedGroupStep,
  isCardExpanded,
  persistedToolState,
  resetExpandedCards,
  ToolCard,
  toolTargetOf,
  toolTitleOf,
  TRANSCRIPT_ROW_RAIL_OFFSET,
  TranscriptRowChevron,
  TranscriptRowIconSlot,
  transcriptRowStyle,
} from "../ui/toolCards";
import {
  addFileAttachment,
  attachmentNotice,
  attachmentPreviewSrc,
  fileUrlOfPath,
  attachImagesFromPicker,
  fileAttachments,
  imageAttachments,
  isLocalAttachmentPathAllowed,
  isLongTextPaste,
  pathOfFileUrl,
  removeAttachment,
  removeFileAttachment,
  saveLongTextPasteToWorkspace,
  toRelativeWorkspacePath,
  type FileAttachment,
  type ImageAttachment,
} from "../attachmentStore";
import { contentWidth } from "../contentWidthStore";
import {
  basename,
  commandOf,
  diffOf,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  formatPlural,
  formatTime,
  formatTimestamp,
  formatTokens,
  LARGE_MARKDOWN_CHARS,
  lineCountOf,
  markdownPreviewCut,
  markdownPreviewSlice,
  groupExploreItems,
  isFoldableToolCall,
  pathOf,
  todosOf,
  toolCallsOf,
  turnDurationMs,
  turnEffectiveModel,
  turnFailureOf,
  turnItems,
  turnParts,
  type FoldedProcessItem,
  type ToolCallView,
  type TranscriptItem,
  type TurnFailure,
  type TurnPart,
} from "../format";
import { currentLocale, isAuthRequiredError, localizeHostError, tr, type MessageKey } from "../i18n";
import {
  answerPermission,
  answerPermissionBatch,
  answeringPermission,
  permissionsForSession,
  type PermissionRequestView,
} from "../permissionStore";
import type { PromptAnswer } from "../attentionStore";
import { fleetDeviceById, fleetSessionRow } from "../fleetStore";
import type { FleetPrompt } from "../fleetTypes";
import { activeConversationId } from "../superagentStore";
import { PromptAttention, ReviewNotesBar, type AttentionDevice } from "../ui/attention";
import { DeviceBadge, StateMark, deviceException, type MarkState } from "../ui/fleet";
import {
  loadQuestionMailbox,
  type QuestionPrompt,
  type QuestionView,
  questionsForSession,
  setQuestionOther,
  submitQuestion,
  toggleQuestionOption,
} from "../userQuestionStore";
import {
  hostQueueReorderSupported,
  loadQueueForSession,
  moveQueued,
  queueFallbackReason,
  queueForSession,
  queueNotice,
  recordQueuedFromSubmit,
  removeQueued,
  sendQueuedNow,
  takeQueuedEntry,
} from "../queueStore";
import {
  activeModelId,
  activeModelDetail,
  activeModelLabel,
  activeReasoningChoices,
  activeReasoningId,
  activeReasoningLabel,
  chatModels,
  chooseModel,
  chooseReasoning,
  ensureModelsLoaded,
  fleetChoiceOf,
  fleetModelGroups,
  fleetModelText,
  modelIdForSession,
  modelTextForSession,
  reasoningChoicesForSession,
  reasoningIdForSession,
  reasoningLabelForSession,
  refreshFleetModels,
  type FleetModelChoice,
  type FleetModelsDevice,
  type SessionModelTarget,
  ensureReasoningLoaded,
  modelPickerOpen,
  reasoningPickerOpen,
} from "../modelStore";
import { remoteWorkspaceAliasOf } from "../sshRemoteStore";
import { midTurnSendPolicy } from "../sendPolicyStore";
import {
  type AgentChoice,
  activeSessionStarted,
  agentAgents,
  agentCatalogNotice,
  agentIdsMatch,
  agentLabel,
  agentModeLockedToSingle,
  agentNotice,
  agentPickerOpen,
  agentProfiles,
  chooseAgentMode,
  ensureAgentModes,
  pendingAgentSession,
  reloadAgentModes,
  startSessionAs,
} from "../agentModeStore";
import { ensureQuickActions, quickActions } from "../quickActionStore";
import {
  clearPromptSuggestion,
  ensurePromptSuggestionSettingLoaded,
  isCompletedTurnStatus,
  promptSuggestionForSession,
} from "../promptSuggestionStore";
import {
  browseMentionDir,
  browseMentionParent,
  closeMention,
  insertMention,
  insertSlashSkill,
  loadSessionCommands,
  loadSlashSkills,
  mentionBrowseDir,
  mentionHits,
  mentionInline,
  mentionLoading,
  mentionNotice,
  mentionOpen,
  mentionQuery,
  mentionSearched,
  mentionTruncated,
  openMention,
  parseSlashCommand,
  runSlashCommand,
  sessionCommandsUnsupported,
  setMentionQuery,
  slashCommandLabel,
  slashCommandsFor,
  slashSkillsFor,
  type SlashCommand,
  type SlashSkillItem,
  syncInlineMention,
} from "../mentionStore";
import {
  activeSession,
  activeSessionDevice,
  activeSessionId,
  activeSessionKey,
  activeWorkspace,
  activeWorkspaceRoot,
  auxPaneOpen,
  auxPaneTab,
  canGoBack,
  goBackScene,
  navigateScene,
  openSessionList,
  showDevice,
  activeWorkspaceId,
  agentTypeOf,
  archiveSessionRow,
  composerText,
  copyActiveSession,
  deleteSessionRow,
  focusPane,
  focusedPane,
  forkActiveSession,
  hasEarlierTurns,
  isSessionArchived,
  loadEarlierTurns,
  loadTurns,
  openInAuxPane,
  pendingTurn,
  pendingTurnState,
  registerTranscriptAutoBackfillGuard,
  registerTranscriptBeforePrependListener,
  renameSession,
  runningTurnId,
  secondarySessionDevice,
  secondarySessionId,
  secondarySessionKey,
  secondaryWorkspaceId,
  sendNotice,
  sendTurn,
  SESSION_SPLIT_DEFAULT_RATIO,
  sessionSplitRatio,
  sessionTurns,
  sessions,
  setSessionSplitRatio,
  splitPaneOpen,
  stopRunningTurn,
  streamText,
  thinkingText,
  turnError,
  transcriptNotice,
  turnsLoading,
} from "../state";
import {
  addSecondaryFileAttachment,
  addSecondaryImageAttachment,
  closeSplitPane,
  createSecondarySession,
  loadSecondaryEarlierTurns,
  openSplitPane,
  registerSecondaryAutoBackfillGuard,
  registerSecondaryBeforePrependListener,
  removeSecondaryFileAttachment,
  removeSecondaryImageAttachment,
  secondaryComposerText,
  secondaryFileAttachments,
  secondaryHasEarlierTurns,
  secondaryImageAttachments,
  secondaryPendingTurnState,
  secondaryRunningTurnId,
  secondarySendNotice,
  secondarySessionTitle,
  secondaryTranscriptNotice,
  secondaryTurnError,
  secondaryTurns,
  secondaryTurnsLoading,
  secondaryWorkspaceName,
  secondaryWorkspaceRecord,
  secondaryWorkspaceRoot,
  selectSecondarySession,
  sendSecondaryTurn,
  stopSecondaryTurn,
  swapSplitPanes,
} from "../splitSessionStore";
import {
  compactLayout,
  controlHeight,
  elevationShadow,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
  textTracking,
} from "../theme";
import { searchRevealTurn } from "../globalSearchStore";
import { openAccountAuthModal } from "../ui/AccountAuthModal";
import { RemoteWorkspaceStatusBanner } from "../ui/SshWorkspaceModals";
import { Icon, type IconName } from "../ui/icons";
import { openImageLightbox } from "../ui/ImageLightbox";
import { OpenBitFunLogoMark } from "../ui/studio";
import {
  STATIC_MARKDOWN_OPTIONS,
  STREAMING_MARKDOWN_OPTIONS,
  createDiffViewStyles,
  createMarkdownCodeActions,
  createMarkdownStyles,
  extractVisualizeDirectives,
  inferCodeLanguage,
  resolveWorkspaceMarkdownLink,
  stripVisualizeDirectives,
  type InlineFigureDirective,
} from "../ui/markdown";
import {
  MOTION_DURATION,
  MOTION_EASE_STANDARD_BEZIER,
  BrandSpinner,
  enterMotion,
  paintTransition,
  popoverEnterMotion,
  popoverOrigin,
  pressTransition,
  rotatingChevronStyle,
  subtleCrossfadeMotion,
  tactileActiveStyle,
} from "../ui/motion";
import {
  DropdownMenu,
  ListRowContent,
  ModalDialog,
  listRowHoverBg,
  listRowTitleLineHeight,
  menuSurfaceStyle,
  pushToast,
  registerEscapeDismiss,
  type DropdownMenuItem,
} from "../ui/overlays";
import {
  addSideQuestionFileAttachment,
  addSideQuestionImageAttachment,
  askSideQuestion,
  cancelSideQuestion,
  closeSideQuestion,
  removeSideQuestionFileAttachment,
  removeSideQuestionImageAttachment,
  resetSideQuestionThread,
  sideQuestion,
  sideQuestionDraft,
  sideQuestionFileAttachments,
  sideQuestionHistory,
  sideQuestionImageAttachments,
  sideQuestionModelOverride,
  sideQuestionUnsupported,
  type SideQuestion,
} from "../btwStore";
import { sessionMenuItems } from "../ui/sessionActions";
import { ReviewLauncherDialog } from "../ui/ReviewLauncher";
import {
  TurnChangesDiffModal,
  TurnFileChangesCard,
  type TurnChangesReviewState,
} from "../ui/TurnFileChanges";
import { GenUIToolItem } from "../genui/GenUIView";
import { isGenUICall } from "../genui/genuiSource";
import {
  isReviewCommand,
  launchReviewFromCommand,
  openReviewLauncher,
  reviewNotesFor,
  sendReviewNotes,
  sendingReviewNotes,
} from "../reviewStore";
import { superAgentUi } from "../productGates"; // wave23-E
// wave22-p5 session parity: goal, side questions, background commands, MCP prompts and apps.
import {
  BackgroundCommandsStrip,
  GoalStrip,
  goalAvailable,
  McpPromptRows,
  mcpPromptMatches,
  openGoalDialog,
  openSideQuestion,
  runExtrasCommand,
  SessionExtrasDialogs,
  sideQuestionOpen,
  useSessionExtras,
} from "../ui/sessionExtras";
import {
  Badge,
  Button,
  IconButton,
  IconCircleButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SplitHandle,
  StatusDot,
  TooltipBubble,
  focusRingStyle as baseFocusRingStyle,
  splitDragging,
} from "../ui/primitives";

const renaming = signal(false);
const renameValue = signal("");
const permissionModeTarget = signal<{
  sessionId: string;
  workspaceId?: string | null;
  workspacePath?: string | null;
  turnId?: string | null;
} | null>(null);
const anyRightSplitOpen = computed(() => !compactLayout() && (splitPaneOpen() || sideQuestionOpen()));
const threadMenuOpen = signal(false);
const transcriptSearchOpen = signal(false);
const transcriptSearchQuery = signal("");
const copiedTranscript = signal(false);
const quickActionMenuOpen = signal(false);
const queueCollapsed = signal(false);
const composerFileDragActive = signal(false);
const composerComposing = signal(false);
const composerCaretBounds = signal<Bounds | null>(null);
const turnChangesReview = signal<TurnChangesReviewState | null>(null);
const mentionSelectedIndex = signal(0);

const threadMenuAnchor = signal<ViewRef | null>(null);
const composerCardAnchor = signal<ViewRef | null>(null);
const agentPickerAnchor = signal<ViewRef | null>(null);
const modelPickerAnchor = signal<ViewRef | null>(null);
const reasoningPickerAnchor = signal<ViewRef | null>(null);
const quickActionsAnchor = signal<ViewRef | null>(null);
const composerPlusAnchor = signal<ViewRef | null>(null);
const composerPlusOpen = signal(false);

const threadMenuPlacement = signal<Placement>("bottom");
const mentionPlacement = signal<Placement>("top");
const quickActionsPlacement = signal<Placement>("top");
const agentPickerPlacement = signal<Placement>("top");
const modelPickerPlacement = signal<Placement>("top");
const reasoningPickerPlacement = signal<Placement>("top");
const slashMenuPlacement = signal<Placement>("top");
const permissionModePlacement = signal<Placement>("top");
const contextUsagePlacement = signal<Placement>("top");
const transcriptScrolled = signal(false);
const sessionsPaneWidth = signal(0);
const sessionsCompact = computed(() => sessionsPaneWidth() > 0 && sessionsPaneWidth() < 600);
const sessionsPadX = computed(() => (sessionsCompact() || anyRightSplitOpen() ? space.lg : space.xxl));
function paneTranscriptPadLeft(hasRail: boolean): number {
  const base = sessionsPadX();
  return !compactLayout() && hasRail ? Math.max(base, 34) : base;
}

let composerInputRef: InputRef | undefined;
let nextDroppedAttachmentId = 0;

const enabledQuickActions = computed(() => quickActions().filter(action => action.enabled));

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "avif",
]);

/** The open session's device when the index says it is offline (fleet only). A function: it is read before the header's computeds exist. */
function sessionDeviceOffline(): { name: string; asOfMs: number } | null {
  const device = fleetDeviceById(activeSessionDevice());
  return device && device.state === "offline" ? { name: device.name, asOfMs: device.asOfMs } : null;
}

/** "{device} is offline. Showing what was saved at {time}." (spec §4.12). */
function offlineNoticeText(): string {
  const offline = sessionDeviceOffline();
  return offline ? tr("session.offlineNotice", { device: offline.name, time: formatTime(offline.asOfMs) }) : "";
}

const composerDisabled = computed(() => !activeSessionId() || sessionDeviceOffline() !== null);

const activePromptSuggestion = computed<string>(() => {
  const sessionId = activeSessionId();
  if (
    !sessionId ||
    composerDisabled() ||
    runningTurnId() ||
    pendingTurn() ||
    pendingTurnState() ||
    composerText().length > 0 ||
    imageAttachments().length > 0
  ) {
    return "";
  }
  const entry = promptSuggestionForSession(sessionId, activeSessionDevice());
  if (!entry) return "";
  const turns = sessionTurns();
  const latestTurn = turns[turns.length - 1];
  if (!latestTurn || latestTurn.turnId !== entry.sourceTurnId || !isCompletedTurnStatus(latestTurn.status)) {
    return "";
  }
  return entry.suggestion;
});

function acceptActivePromptSuggestion(): boolean {
  const suggestion = activePromptSuggestion();
  if (!suggestion) return false;
  const sessionId = activeSessionId();
  composerText.set(suggestion);
  clearPromptSuggestion(sessionId, activeSessionDevice());
  composerInputRef?.focus();
  return true;
}

function focusRingStyle(offset = 2): ViewStyle {
  return offset === 2 ? baseFocusRingStyle() : { ...baseFocusRingStyle(), outlineOffset: offset };
}

/**
 * Anchored popover entrance that reacts cleanly when `<Overlay>` flips its
 * placement after measurement, and registers Escape dismissal on the shared
 * LIFO stack while mounted.
 */
function usePopoverMotion(placement: () => Placement, align: Align, onClose?: () => void): Motion {
  if (onClose) cleanup(registerEscapeDismiss(onClose));
  const initial = placement();
  const motion = popoverEnterMotion(initial, align, MOTION_DURATION.popover);
  let settled = initial;
  effect(() => {
    const next = placement();
    if (next === settled) return;
    settled = next;
    if (reduceMotion()) return;
    const keyframes =
      next === "top"
        ? { opacity: [0.92, 1], scale: [0.97, 1], translateY: [4, 0] }
        : next === "left"
          ? { opacity: [0.92, 1], scale: [0.97, 1], translateX: [4, 0] }
          : next === "right"
            ? { opacity: [0.92, 1], scale: [0.97, 1], translateX: [-4, 0] }
            : { opacity: [0.92, 1], scale: [0.97, 1], translateY: [-4, 0] };
    void motion.play({
      keyframes,
      duration: MOTION_DURATION.fast,
      easing: MOTION_EASE_STANDARD_BEZIER,
    });
  });
  return motion;
}

function toggleThreadMenu(): void {
  closePickers();
  if (threadMenuOpen()) closeThreadMenu();
  else threadMenuOpen.set(true);
}

function closeThreadMenu(): void {
  threadMenuOpen.set(false);
  threadMenuPlacement.set("bottom");
}

function closeMentionPopover(): void {
  closeMention();
  mentionPlacement.set("top");
}

function closePickers(except?: "model" | "reasoning" | "agent" | "actions"): void {
  if (except !== "model") {
    modelPickerOpen.set(false);
    modelPickerPlacement.set("top");
  }
  if (except !== "reasoning") {
    reasoningPickerOpen.set(false);
    reasoningPickerPlacement.set("top");
  }
  if (except !== "agent") {
    agentPickerOpen.set(false);
    agentPickerPlacement.set("top");
  }
  if (except !== "actions") {
    quickActionMenuOpen.set(false);
    quickActionsPlacement.set("top");
  }
  permissionModePickerOpen.set(false);
  permissionModePlacement.set("top");
  contextPopoverOpen.set(false);
  contextUsagePlacement.set("top");
  composerPlusOpen.set(false);
}

/** Shared surface of the anchored composer & thread menus (the overlays menu surface). */
function overlayPopoverStyle(): ViewStyle {
  return menuSurfaceStyle();
}

/** Inset of the anchored popovers; rows inside take the concentric radius. */
const POPOVER_PADDING = space.xs;
const POPOVER_ROW_RADIUS = radii.md;

/**
 * One row of an anchored popover list: hover / keyboard-highlight fill that stays
 * visible on the popover surface; the content is a `ListRowContent`.
 */
function popoverRowStyle(highlighted = false, disabled = false): ViewStyle {
  return {
    flexDirection: "row",
    alignItems: "center",
    minHeight: compactLayout() || sessionsCompact() ? layout.touchTarget : controlHeight.md,
    paddingHorizontal: space.sm,
    paddingVertical: 7,
    borderRadius: POPOVER_ROW_RADIUS,
    borderCurve: "continuous",
    backgroundColor: highlighted ? listRowHoverBg() : "transparent",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    ...paintTransition(MOTION_DURATION.fast),
  };
}

function popoverRowHoverStyle(disabled = false): ViewStyle {
  return { backgroundColor: disabled ? "transparent" : listRowHoverBg() };
}

function popoverRowActiveStyle(): ViewStyle {
  return { backgroundColor: palette().buttonSecondaryHover };
}

/** The current value of a picker: a check on the title line. */
function PopoverCheck() {
  return <Icon name="check" size={13} color={palette().accent} />;
}

/** Section header inside a popover: 12 px, medium, muted, no glyph, optional count. */
function PopoverSectionHeader(props: { label: string; count?: number; first?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingTop: props.first === false ? space.sm : space.xs,
        paddingBottom: space.xs,
        pointerEvents: "none",
      }}
    >
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().textMuted,
          fontSize: textSize(12),
          fontWeight: "500",
          lineHeight: textLineHeight(12, 1.3),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.count !== undefined}>
        <Text
          style={{
            flexShrink: 0,
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontVariant: ["tabular-nums"],
          }}
        >
          {String(props.count ?? "")}
        </Text>
      </If>
    </View>
  );
}

/** 1 px separator between popover groups. */
function PopoverSeparator() {
  return (
    <View
      style={{
        height: 1,
        marginVertical: space.xs,
        marginHorizontal: space.sm,
        backgroundColor: palette().borderSubtle,
      }}
    />
  );
}

function isArchived(session: { status?: string; persistedStatus?: string }): boolean {
  return isSessionArchived(session as Parameters<typeof isSessionArchived>[0]);
}

function sessionTitle(session: { sessionName?: string; sessionId: string }): string {
  return session.sessionName || session.sessionId;
}

function turnKeyOf(turn: unknown): string {
  if (!turn || typeof turn !== "object") return "";
  const record = turn as Record<string, unknown>;
  const id = record.turnId ?? record.turn_id ?? record.id;
  return typeof id === "string" ? id : "";
}

function turnTimestampOf(turn: unknown): number | undefined {
  if (!turn || typeof turn !== "object") return undefined;
  const candidate = (turn as Partial<TranscriptTurnView>).user?.timestampMs ?? (turn as Partial<TranscriptTurnView>).startTimeMs;
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
}

function turnMetadataLabel(turn: unknown): string {
  const model = turnEffectiveModel(turn) ?? "";
  const durationMs = turnDurationMs(turn);
  const duration =
    durationMs !== null && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${Math.round(durationMs)}ms`
      : "";
  return [model, duration].filter(Boolean).join(" · ");
}

function turnPartKey(turn: unknown, part: { role: string; text: string }): string {
  return `${turnKeyOf(turn)}|${part.role}|${part.text}`;
}

function userPartsOf(turn: unknown): TurnPart[] {
  return turnParts(turn).filter(part => part.role === "user");
}

function thinkingPartsOf(turn: unknown): TurnPart[] {
  return turnParts(turn).filter(part => part.role === "thinking");
}

function responsePartsOf(turn: unknown): TurnPart[] {
  return turnParts(turn).filter(part => part.role !== "user" && part.role !== "thinking");
}

/** A turn's searchable text, lowercased once: answered turns are replaced, never edited. */
const turnSearchTextCache = new WeakMap<object, string>();

function turnSearchText(turn: unknown): string {
  if (!turn || typeof turn !== "object") return "";
  let text = turnSearchTextCache.get(turn);
  if (text === undefined) {
    // Parts are joined by a character no query holds, so no match spans two parts.
    text = turnParts(turn)
      .map(part => part.text.toLowerCase())
      .join("\u0000");
    turnSearchTextCache.set(turn, text);
  }
  return text;
}

function turnMatchesSearch(turn: unknown, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return turnSearchText(turn).includes(needle);
}

/** The query the matches are computed for: typing settles first, clearing applies at once. */
const appliedTranscriptSearch = signal("");
let searchApplyTimer: ReturnType<typeof setTimeout> | null = null;
const SEARCH_SETTLE_MS = 120;

function setTranscriptSearch(value: string): void {
  transcriptSearchQuery.set(value);
  if (searchApplyTimer) clearTimeout(searchApplyTimer);
  searchApplyTimer = null;
  if (!value.trim()) {
    appliedTranscriptSearch.set("");
    return;
  }
  searchApplyTimer = setTimeout(() => {
    searchApplyTimer = null;
    appliedTranscriptSearch.set(transcriptSearchQuery());
  }, SEARCH_SETTLE_MS);
}

const transcriptMatchKeys = computed(() => {
  const query = appliedTranscriptSearch().trim();
  if (!query) return [] as string[];
  return sessionTurns()
    .filter(turn => turnMatchesSearch(turn, query))
    .map((turn, index) => turnKeyOf(turn) || `index-${index}`);
});
const transcriptMatchCount = computed(() => transcriptMatchKeys().length);
const matchingSearchTurnIds = computed(() => new Set(transcriptMatchKeys()));
const searchMatchIndex = signal(0);
const activeSearchTurnKey = computed(() => {
  const keys = transcriptMatchKeys();
  if (!keys.length) return "";
  return keys[Math.min(searchMatchIndex(), keys.length - 1)] ?? "";
});

const activeRailTurnKey = signal("");
const hoveredPrimaryTurnKey = signal("");
const hoveredSecondaryTurnKey = signal("");
/** Briefly prevents an upward animated rail jump from re-locking `followLatest` on its first frames near the bottom. */
let suppressAutoFollowUntil = 0;

function syncActiveRailForLatest(): void {
  const rows = visibleTurnRows();
  if (rows.length === 0) {
    if (activeRailTurnKey() !== "") activeRailTurnKey.set("");
    return;
  }
  if (followLatest()) {
    const last = rows[rows.length - 1]!.key;
    if (activeRailTurnKey() !== last) activeRailTurnKey.set(last);
  }
}

/** Where the primary viewport is, in rows, so a jump knows whether it is a short hop. */
let primaryFirstViewableIndex = -1;
let primaryViewableCount = 0;

/**
 * Whether scrolling from the viewport to row `target` stays among rows the list
 * already holds. An animated scroll across rows that were never laid out makes
 * the list build cells for every frame of the flight, which leaves the viewport
 * blank until it lands; such a jump goes straight to its row instead.
 */
function isShortHop(target: number, firstViewable: number, viewableCount: number): boolean {
  if (firstViewable < 0 || viewableCount <= 0) return false;
  return Math.abs(target - firstViewable) <= Math.max(6, viewableCount);
}

function syncActiveRailFromViewable(viewableItems: ReadonlyArray<ViewToken<TranscriptBlockRow>>): void {
  primaryFirstViewableIndex = viewableItems[0]?.index ?? -1;
  primaryViewableCount = viewableItems.length;
  const rows = visibleTurnRows();
  if (rows.length === 0) {
    if (activeRailTurnKey() !== "") activeRailTurnKey.set("");
    return;
  }
  if (followLatest()) {
    const last = rows[rows.length - 1]!.key;
    if (activeRailTurnKey() !== last) activeRailTurnKey.set(last);
    return;
  }
  const firstTurnKey = viewableItems[0]?.item?.turnKey;
  if (firstTurnKey && activeRailTurnKey() !== firstTurnKey) {
    activeRailTurnKey.set(firstTurnKey);
  }
}

function jumpToTurn(rowKey: string): void {
  const index = rowKey ? primaryTranscriptBlocks().firstIndexByTurnKey.get(rowKey) : undefined;
  if (index === undefined) return;
  followLatest.set(false);
  suppressAutoFollowUntil = Date.now() + 500;
  cancelScheduledTranscriptScroll();
  activeRailTurnKey.set(rowKey);
  transcriptListRef?.scrollToIndex({
    index,
    viewPosition: 0,
    animated: isShortHop(index, primaryFirstViewableIndex, primaryViewableCount),
  });
}

function revealSearchMatch(): void {
  const key = activeSearchTurnKey();
  const index = key ? primaryTranscriptBlocks().firstIndexByTurnId.get(key) : undefined;
  if (index === undefined) return;
  followLatest.set(false);
  cancelScheduledTranscriptScroll();
  transcriptListRef?.scrollToIndex({ index, viewPosition: 0, animated: false });
}

/** Steps to the previous (-1) or next (1) matching turn, wrapping at the ends. */
function stepSearchMatch(direction: -1 | 1): void {
  const total = transcriptMatchKeys().length;
  if (!total) return;
  searchMatchIndex.set((Math.min(searchMatchIndex(), total - 1) + direction + total) % total);
  revealSearchMatch();
}

let copiedTranscriptTimer: ReturnType<typeof setTimeout> | null = null;

async function copyWholeTranscript(): Promise<void> {
  const lines: string[] = [];
  for (const turn of sessionTurns()) {
    for (const part of turnParts(turn)) {
      if (part.role === "thinking") continue;
      const prefix = part.role === "user" ? tr("common.user") : tr("sessions.assistantRole");
      lines.push(`${prefix}:\n${part.text}`);
    }
  }
  const text = lines.join("\n\n").trim();
  if (!text) return;
  await Clipboard.writeText(text);
  copiedTranscript.set(true);
  pushToast(tr("sessions.transcriptCopied"), "success");
  if (copiedTranscriptTimer) clearTimeout(copiedTranscriptTimer);
  copiedTranscriptTimer = setTimeout(() => {
    copiedTranscriptTimer = null;
    copiedTranscript.set(false);
  }, 1600);
}


function isImageMimeOrPath(mime: string, nameOrUri: string): boolean {
  if (mime.toLowerCase().startsWith("image/")) return true;
  const clean = nameOrUri.split(/[?#]/)[0] ?? nameOrUri;
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function decodeFileUri(uri: string): string {
  return pathOfFileUrl(uri);
}

function mimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

async function attachRemoteDroppedImage(uri: string, name: string, mime: string): Promise<boolean> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? (mime || mimeFromFilename(name));
    const attachment: ImageAttachment = {
      id: `attachment-drop-${++nextDroppedAttachmentId}`,
      name,
      mimeType: contentType,
      fileSize: bytes.byteLength,
      dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
    };
    imageAttachments.update(list => [...list, attachment]);
    attachmentNotice.set("");
    return true;
  } catch {
    return false;
  }
}

/** Computes the post-edit caret index directly from `prev` and `next` text (order-independent of `onSelectionChange`). */
function estimateCaretAfterEdit(prev: string, next: string): number {
  let prefix = 0;
  const minLen = Math.min(prev.length, next.length);
  while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return next.length - suffix;
}

function attachOrReferenceFileUris(uris: string[], mimeTypes: string[]): void {
  let attachedImages = 0;
  let attachedFiles = 0;
  const allowLocalPath = isLocalAttachmentPathAllowed();
  const wsRoot = activeWorkspaceRoot();

  for (let i = 0; i < uris.length; i += 1) {
    const uri = uris[i];
    if (!uri) continue;
    const mime = mimeTypes[i] ?? "";
    const filePath = decodeFileUri(uri);
    const name = basename(filePath) || "file";
    if (isImageMimeOrPath(mime, name)) {
      if (!allowLocalPath) {
        // Never send controller-local `imagePath` to a remote peer or remote workspace;
        // try reading bytes into a `dataUrl`, else refuse loudly.
        void attachRemoteDroppedImage(uri, name, mime).then(ok => {
          if (!ok) {
            attachmentNotice.set(tr("error.unsupported"));
            pushToast(tr("error.unsupported"), "error");
          }
        });
        continue;
      }
      const attachment: ImageAttachment = {
        id: `attachment-drop-${++nextDroppedAttachmentId}`,
        name,
        mimeType: mime || mimeFromFilename(name),
        fileSize: 0,
        imagePath: filePath,
      };
      imageAttachments.update(list => [...list, attachment]);
      attachedImages += 1;
    } else {
      const relativePath = toRelativeWorkspacePath(filePath, wsRoot);
      addFileAttachment({
        name,
        path: filePath,
        relativePath,
        isDirectory: false,
        source: "file",
      });
      attachedFiles += 1;
    }
  }

  if (attachedImages > 0 || attachedFiles > 0) {
    attachmentNotice.set("");
    composerInputRef?.focus();
  }
}

async function handleComposerPaste(event: PasteEvent, insertText: (text: string) => void): Promise<void> {
  let handledMediaOrFiles = false;
  if (event.files && event.files.length > 0) {
    for (const file of event.files) {
      if (isImageMimeOrPath(file.type, file.name)) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mimeType = file.type || mimeFromFilename(file.name);
          const id = `attachment-paste-${++nextDroppedAttachmentId}`;
          const attachment: ImageAttachment = {
            id,
            name: file.name || `pasted-image-${nextDroppedAttachmentId}.png`,
            mimeType,
            fileSize: bytes.byteLength,
            dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
          };
          imageAttachments.update(list => [...list, attachment]);
          attachmentNotice.set("");
          handledMediaOrFiles = true;
        } catch (error) {
          attachmentNotice.set(localizeHostError(error));
        }
      } else if (file.type.startsWith("text/") || /\.(md|txt|json|ts|tsx|js|jsx|rs|py|yml|yaml|toml|csv|log)$/i.test(file.name)) {
        try {
          const content = await file.text();
          const saved = await saveLongTextPasteToWorkspace(content, {
            fileName: file.name || undefined,
          });
          if (saved) {
            handledMediaOrFiles = true;
          }
        } catch (error) {
          attachmentNotice.set(localizeHostError(error));
        }
      }
    }
  }
  if (event.uris && event.uris.length > 0) {
    attachOrReferenceFileUris(event.uris, []);
    handledMediaOrFiles = true;
  }
  if (handledMediaOrFiles) {
    return;
  }
  const text = event.text ?? "";
  if (!text) return;
  if (isLongTextPaste(text)) {
    const saved = await saveLongTextPasteToWorkspace(text);
    if (saved) {
      composerInputRef?.focus();
      return;
    }
    pushToast(tr("sessions.pastedSaveFailed"), "warning");
  }
  insertText(text);
}

function handleComposerFileDrop(event: { uris: string[]; mimeTypes: string[] }): void {
  composerFileDragActive.set(false);
  if (!event.uris || event.uris.length === 0) return;
  attachOrReferenceFileUris(event.uris, event.mimeTypes ?? []);
}

const activePermissions = computed(() => permissionsForSession(activeSessionId()));
const activeQuestions = computed(() => questionsForSession(activeSessionId()));

/** The session's one header state: shown only when it is not idle (spec §4.5). */
const headerState = computed<MarkState | null>(() => {
  if (runningTurnId() || isStreamDraining()) return "working";
  if (activePermissions().length > 0 || activeQuestions().length > 0) return "needs_you";
  const pending = pendingTurnState();
  const openKey = activeSessionKey();
  const pendingMatches =
    Boolean(pending && (!pending.sessionKey || !openKey || pending.sessionKey === openKey)) || Boolean(pendingTurn());
  if (pendingMatches && !turnError()) return "working";
  const id = activeSessionId();
  const row = id ? fleetSessionRow(activeSessionDevice(), id) : null;
  if (row?.status === "waiting" || row?.needsAttention) return row.status === "error" ? "failed" : "needs_you";
  if (row?.status === "error") return "failed";
  if (row?.status === "running") return "working";
  return null;
});

/** The device the open session runs on, as a badge (fleet only; a single-device backend draws none). */
const sessionDeviceLabel = computed<AttentionDevice | null>(() => {
  const device = fleetDeviceById(activeSessionDevice());
  if (!device) return null;
  return {
    name: device.name,
    kind: device.hostKind,
    exception: deviceException(device.state),
    onPress: () => showDevice(device.deviceId),
  };
});

interface SessionOrigin {
  conversationId: string;
  title: string;
}

/** "Started by OpenBitFun": only when the backend says the session's origin is the superagent. */
const sessionOrigin = computed<SessionOrigin | null>(() => {
  // wave23-E: no "Started by Super Agent" link while the Super Agent UI is gated off.
  if (!superAgentUi()) return null;
  const id = activeSessionId();
  const row = id ? fleetSessionRow(activeSessionDevice(), id) : null;
  if (row?.origin !== "superagent") return null;
  const ref = (row as unknown as { jobRef?: { conversationId?: unknown; conversationTitle?: unknown } }).jobRef;
  return {
    conversationId: typeof ref?.conversationId === "string" ? ref.conversationId : "",
    title: typeof ref?.conversationTitle === "string" ? ref.conversationTitle : "",
  };
});

function openOrigin(origin: SessionOrigin): void {
  if (origin.conversationId) activeConversationId.set(origin.conversationId);
  navigateScene("openbitfun");
}

type ToolPaneId = "files" | "git" | "terminal" | "browser";

const TOOL_TOGGLES: ReadonlyArray<{ id: ToolPaneId; icon: IconName; label: MessageKey }> = [
  { id: "files", icon: "folder", label: "tools.files" },
  { id: "git", icon: "git-branch", label: "tools.changes" },
  { id: "terminal", icon: "terminal", label: "tools.terminal" },
  { id: "browser", icon: "globe", label: "tools.browser" },
];

// wave22-p2: the Browser is the inspector's fourth tab, like the other tools.
function toolActive(id: ToolPaneId): boolean {
  return auxPaneOpen() && auxPaneTab() === id;
}

function toggleTool(id: ToolPaneId): void {
  if (toolActive(id)) auxPaneOpen.set(false);
  else openInAuxPane(id);
}

/** A 28 tool toggle; active = `accentSoft` + `accent` (spec §3 Session header). */
function ToolToggle(props: {
  id: ToolPaneId;
  icon: IconName;
  label: string;
  labelPrefix?: string;
  onBeforeToggle?: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={`${props.labelPrefix ?? ""}session-tool-${props.id}`}
      accessibilityState={{ selected: toolActive(props.id) }}
      tooltip={compactLayout() ? undefined : <TooltipBubble text={props.label} />}
      onPress={() => {
        props.onBeforeToggle?.();
        toggleTool(props.id);
      }}
      style={{
        width: controlHeight.sm,
        height: controlHeight.sm,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: toolActive(props.id) ? palette().accentSoft : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: toolActive(props.id) ? palette().accentSoft : palette().panelHover }}
      activeStyle={tactileActiveStyle(0.97)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon name={props.icon} size={16} color={toolActive(props.id) ? palette().accent : palette().textSecondary} />
    </View>
  );
}

/** The workspace the open session belongs to: the device's index row, else the open workspace. */
function sessionWorkspaceName(): string {
  const id = activeSessionId();
  const device = fleetDeviceById(activeSessionDevice());
  const workspace = id ? device?.workspaces.find(item => item.sessions.some(session => session.sessionId === id)) : undefined;
  const record = workspace ?? activeWorkspace();
  const name = record?.name ?? "";
  if (!name) return "";
  const alias = remoteWorkspaceAliasOf(record);
  return alias ? `${name} · ${alias}` : name;
}

/**
 * The permission mode, only when this session deviates from the device's
 * default (spec §4.5): 20 high, radius 6, `chip`, 12 `textSecondary`.
 * Shared across Primary and Split sessions.
 */
function DeviationChip(props: {
  sessionId?: () => string | null;
  accessibilityLabel?: string;
} = {}) {
  const mode = () => {
    const id = (props.sessionId ?? activeSessionId)();
    if (!id || permissionModeSupported() === false || followsDefaultMode(id)) return null;
    const current = effectivePermissionMode(id);
    return current === permissionMode() ? null : current;
  };
  return (
    <If when={mode()}>
      {current => (
        <View
          accessibilityLabel={props.accessibilityLabel ?? "session-permission-deviation"}
          style={{
            height: 20,
            justifyContent: "center",
            paddingHorizontal: space.chip,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            backgroundColor: palette().chip,
            flexShrink: 0,
          }}
        >
          <Text style={textStyle("caption", { color: palette().textSecondary })}>
            {current() === "ask" ? tr("session.askFirst") : permissionModeLabel(current())}
          </Text>
        </View>
      )}
    </If>
  );
}

/** Device › workspace, each segment pressable (spec §3 Session header). Shared across Primary and Split. */
function SessionBreadcrumb(props: {
  device?: () => AttentionDevice | null;
  workspaceName?: () => string;
  deviceTestID?: string;
  workspaceAccessibilityLabel?: string;
} = {}) {
  const deviceFn = props.device ?? sessionDeviceLabel;
  const workspaceFn = props.workspaceName ?? sessionWorkspaceName;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0, flexShrink: 1 }}>
      <If when={deviceFn()}>
        {device => (
          <DeviceBadge
            testID={props.deviceTestID}
            name={device().name}
            kind={device().kind}
            exception={device().exception}
            onPress={device().onPress}
          />
        )}
      </If>
      <If when={!compactLayout() ? workspaceFn() : ""}>
        {name => (
          <>
            <If
              when={deviceFn()}
              else={<Text style={textStyle("caption", { color: palette().textMuted })}>·</Text>}
            >
              <Icon name="chevron-right" size={12} color={palette().textMuted} />
            </If>
            <View
              role="button"
              accessibilityLabel={props.workspaceAccessibilityLabel}
              onPress={() => openSessionList()}
              style={{
                minWidth: 0,
                flexShrink: 1,
                borderRadius: radii.xs,
                paddingHorizontal: space.hair,
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().panelHover }}
              activeStyle={tactileActiveStyle(0.98)}
              focusVisibleStyle={focusRingStyle()}
            >
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textSecondary }),
                  fontWeight: "500",
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {name()}
              </Text>
            </View>
          </>
        )}
      </If>
    </View>
  );
}

/**
 * Single unified desktop header bar shared by Primary, Secondary Split, and BTW panes.
 * Guarantees pixel-identical height (`layout.topBarHeight`), borders, typography, and focus indicator.
 */
function SessionHeaderBar(props: {
  paneToRight?: () => boolean;
  testID?: string;
  titleTestID?: string;
  title: () => string;
  subtitle?: () => string;
  focused?: () => boolean;
  bordered?: () => boolean;
  tall?: () => boolean;
  leadingIcon?: IconName;
  leadingIconColor?: () => string;
  breadcrumb?: JSX.Element;
  deviation?: JSX.Element;
  statusState?: () => MarkState | null;
  statusLabelPrefix?: string;
  showTools?: () => boolean;
  toolLabelPrefix?: string;
  onToolPress?: () => void;
  focusAccessibilityLabel?: string | (() => string | undefined);
  focusIndicatorTestID?: string;
  onFocus?: () => void;
  actions?: JSX.Element;
  subline?: JSX.Element;
}) {
  const sceneInset = SceneCaptionInset();
  const captionInset = () => props.paneToRight?.() ? 0 : sceneInset();
  const focusLabel = () =>
    typeof props.focusAccessibilityLabel === "function"
      ? props.focusAccessibilityLabel()
      : props.focusAccessibilityLabel;
  const focusActive = () => Boolean(props.onFocus) && (props.focusAccessibilityLabel === undefined || Boolean(focusLabel()));
  return (
    <View
      testID={props.testID}
      style={{
        position: "relative",
        height: props.tall?.() ? 64 : layout.topBarHeight,
        minHeight: props.tall?.() ? 64 : layout.topBarHeight,
        paddingLeft: sessionsPadX(),
        paddingRight: captionInset() > 0 ? captionInset() + space.sm : sessionsPadX(),
        justifyContent: "center",
        gap: space.hair,
        backgroundColor: palette().canvas,
        borderBottomWidth: 1,
        borderColor: props.bordered?.() ? palette().borderSubtle : "transparent",
        flexShrink: 0,
        ...paintTransition(MOTION_DURATION.fast),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          minHeight: layout.topBarHeight - space.lg,
        }}
      >
        <View
          role={focusActive() ? "button" : undefined}
          accessibilityLabel={focusLabel()}
          accessibilityState={focusActive() ? { selected: Boolean(props.focused?.()) } : undefined}
          onPress={focusActive() ? props.onFocus : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            overflow: captionInset() > 0 ? "hidden" : "visible",
            ...(focusActive() ? { cursor: "pointer", userSelect: "none" } : {}),
          }}
        >
          <If when={Boolean(props.leadingIcon)}>
            <Icon
              name={props.leadingIcon!}
              size={14}
              color={props.leadingIconColor ? props.leadingIconColor() : palette().accent}
            />
          </If>
          <View
            style={{
              position: "relative",
              minWidth: 0,
              flexShrink: props.subtitle ? 0 : 1,
              justifyContent: "center",
            }}
          >
            <Text
              testID={props.titleTestID}
              style={{
                ...textStyle("sectionTitle", { color: palette().text }),
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.title()}
            </Text>
            <If when={Boolean(props.focused?.())}>
              <View
                testID={props.focusIndicatorTestID}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: -3,
                  height: 2,
                  borderRadius: radii.pill,
                  backgroundColor: palette().accent,
                  pointerEvents: "none",
                }}
              />
            </If>
          </View>
          <If when={props.subtitle?.() ?? ""}>
            {sub => (
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textMuted }),
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {`· ${sub()}`}
              </Text>
            )}
          </If>
          {props.breadcrumb}
          {props.deviation}
        </View>
        <CaptionActionStrip inset={captionInset()} gap={space.xs}>
          <If when={props.statusState?.() ?? null}>
            {state => (
              <View
                accessibilityLabel={`${props.statusLabelPrefix ?? "session-status-"}${state()}`}
                style={{ marginRight: space.xs }}
              >
                <StateMark state={state()} withWord={true} />
              </View>
            )}
          </If>
          <If when={Boolean(props.showTools?.())}>
            <Each of={TOOL_TOGGLES} key={tool => tool.id}>
              {tool => (
                <ToolToggle
                  id={tool().id}
                  icon={tool().icon}
                  label={tr(tool().label)}
                  labelPrefix={props.toolLabelPrefix}
                  onBeforeToggle={props.onToolPress}
                />
              )}
            </Each>
          </If>
          {props.actions}
        </CaptionActionStrip>
      </View>
      {props.subline}
    </View>
  );
}

function headerTitle(): string {
  const session = activeSession();
  if (session) return sessionTitle(session);
  // A session of another device is in its device's index, not in this device's list.
  const id = activeSessionId();
  const row = id ? fleetSessionRow(activeSessionDevice(), id) : null;
  return row?.title || activeWorkspace()?.name || tr("sessions.newConversation");
}

function ThreadMenuTrigger() {
  return (
    <View ref={el => threadMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
      <If
        when={compactLayout()}
        else={
          <IconButton
            icon="more"
            size="sm"
            active={threadMenuOpen()}
            accessibilityLabel="thread-actions-trigger"
            tooltip={tr("nav.threadActions")}
            onPress={toggleThreadMenu}
          />
        }
      >
        <TouchTargetButton
          icon="more"
          tone={threadMenuOpen() ? "active" : "ghost"}
          accessibilityLabel="thread-actions-trigger"
          onPress={toggleThreadMenu}
        />
      </If>
    </View>
  );
}

/**
 * The session header (spec §3, §4.5). Desktop: 44 (64 with the origin line),
 * padding 0 24; title 16/600, the device › workspace breadcrumb, then on the
 * right the state word (only when not idle), the tool toggles (≥ 720) and ⋯.
 * Phone: 48, ‹ back, the title 15/600 over the device badge, ⋯.
 */
function ConversationHeader(props: { paneToRight: () => boolean }) {
  let searchRevealTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (searchRevealTimer) {
      clearTimeout(searchRevealTimer);
      searchRevealTimer = null;
    }
  });
  return (
    <View>
      <If
        when={compactLayout()}
        else={
          <SessionHeaderBar
            testID="session-header"
            paneToRight={props.paneToRight}
            titleTestID="session-title"
            title={headerTitle}
            focused={() => splitPaneOpen() && focusedPane() === 0}
            bordered={() => anyRightSplitOpen() || transcriptScrolled()}
            tall={() => Boolean(sessionOrigin())}
            focusAccessibilityLabel={() => (splitPaneOpen() ? "primary-pane-focus" : undefined)}
            focusIndicatorTestID="primary-pane-active-indicator"
            onFocus={() => {
              if (splitPaneOpen()) focusPane(0);
            }}
            breadcrumb={
              <SessionBreadcrumb
                device={sessionDeviceLabel}
                workspaceName={sessionWorkspaceName}
                deviceTestID="session-breadcrumb-device"
                workspaceAccessibilityLabel="session-breadcrumb-workspace"
              />
            }
            deviation={
              <DeviationChip
                sessionId={activeSessionId}
                accessibilityLabel="session-permission-deviation"
              />
            }
            statusState={headerState}
            statusLabelPrefix="session-status-"
            showTools={() => !compactLayout() && !sessionsCompact()}
            onToolPress={() => {
              if (splitPaneOpen()) focusPane(0);
            }}
            actions={
              <>
                <ThreadMenuTrigger />
                <If when={splitPaneOpen()}>
                  <IconButton
                    icon="close"
                    size="sm"
                    accessibilityLabel="session-pane-close-0"
                    tooltip={tr("sessions.splitClosePane")}
                    onPress={() => closeSplitPane(0)}
                  />
                </If>
              </>
            }
            subline={
              <If when={sessionOrigin()}>
                {origin => (
                  <View
                    role="button"
                    accessibilityLabel="session-origin"
                    onPress={() => openOrigin(origin())}
                    style={{
                      alignSelf: "flex-start",
                      borderRadius: radii.xs,
                      cursor: "pointer",
                      userSelect: "none",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().panelHover }}
                    activeStyle={tactileActiveStyle(0.98)}
                    focusVisibleStyle={focusRingStyle()}
                  >
                    <Text style={textStyle("caption")}>
                      {`${origin().title ? tr("session.origin", { title: origin().title }) : tr("session.originPlain")} ›`}
                    </Text>
                  </View>
                )}
              </If>
            }
          />
        }
      >
        <View
          testID="session-header"
          style={{
            height: layout.phoneTopBarHeight,
            paddingHorizontal: space.xs,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            backgroundColor: palette().canvas,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <TouchTargetButton
            icon="chevron-left"
            tone="ghost"
            accessibilityLabel="session-back"
            onPress={() => (canGoBack() ? goBackScene() : navigateScene("all-sessions"))}
          />
          <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
            <Text
              testID="session-title"
              style={{
                ...textStyle("prose"),
                fontWeight: "600",
                lineHeight: textLineHeight(15, 20 / 15),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {headerTitle()}
            </Text>
            <If when={sessionDeviceLabel()}>
              {device => (
                <DeviceBadge name={device().name} kind={device().kind} exception={device().exception} />
              )}
            </If>
          </View>
          <If when={headerState()}>
            {state => (
              <View accessibilityLabel={`session-status-${state()}`}>
                <StateMark state={state()} />
              </View>
            )}
          </If>
          <ThreadMenuTrigger />
        </View>
      </If>

      {/* Anchored Thread Actions Dropdown Overlay */}
      <If when={threadMenuOpen()}>
        <Overlay
          anchor={threadMenuAnchor()}
          placement="bottom"
          align="end"
          offset={6}
          margin={8}
          onPosition={pos => threadMenuPlacement.set(pos.placement)}
          onPressOutside={closeThreadMenu}
          onCancel={closeThreadMenu}
        >
          <ThreadActionsSurface
            placement={threadMenuPlacement()}
            splitOpen={splitPaneOpen()}
            onToggleSplit={() => {
              if (splitPaneOpen()) closeSplitPane(1);
              else openSplitPane();
            }}
          />
        </Overlay>
      </If>

      {/* Inline Rename Strip */}
      <If when={renaming()}>
        <View
          style={{
            paddingHorizontal: sessionsPadX(),
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: contentWidth(),
              alignSelf: "center",
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <InputBox
              value={renameValue()}
              placeholder={activeSession()?.sessionName || tr("nav.threadName")}
              size="sm"
              autoFocus={true}
              accessibilityLabel="session-rename"
              style={{ flex: 1, minWidth: 0 }}
              onChange={value => renameValue.set(value)}
              onKeyPress={event => {
                if (event.key === "Escape") renaming.set(false);
              }}
              onSubmit={() => {
                const id = activeSessionId();
                const next = renameValue().trim();
                if (id && next) void renameSession(id, next);
                renaming.set(false);
              }}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => {
                const id = activeSessionId();
                const next = renameValue().trim();
                if (id && next) void renameSession(id, next);
                renaming.set(false);
              }}
            />
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => {
                renaming.set(false);
              }}
            />
          </View>
        </View>
      </If>

      {/* Inline Transcript Search Bar */}
      <If when={transcriptSearchOpen()}>
        <View
          style={{
            paddingHorizontal: sessionsPadX(),
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: contentWidth(),
              alignSelf: "center",
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <InputBox
              value={transcriptSearchQuery()}
              placeholder={tr("sessions.findInConversation")}
              leadingIcon="search"
              size="sm"
              autoFocus={true}
              accessibilityLabel="transcript-search-input"
              style={{ flex: 1, minWidth: 0 }}
              onChange={value => {
                setTranscriptSearch(value);
                searchMatchIndex.set(0);
                if (searchRevealTimer) clearTimeout(searchRevealTimer);
                searchRevealTimer = setTimeout(() => {
                  searchRevealTimer = null;
                  revealSearchMatch();
                }, 0);
              }}
              onSubmit={() => stepSearchMatch(1)}
              trailing={
                appliedTranscriptSearch().trim().length > 0 ? (
                  <Text
                    style={{
                      flexShrink: 0,
                      color: transcriptMatchCount() > 0 ? palette().accent : palette().textMuted,
                      fontSize: textSize(11),
                      lineHeight: textLineHeight(11, 1.25),
                      fontWeight: "500",
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatPlural(transcriptMatchCount(), "format.matchOne", "format.matchOther")}
                  </Text>
                ) : undefined
              }
            />
            <If when={transcriptMatchCount() > 0}>
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().textMuted,
                  fontSize: textSize(11),
                  lineHeight: textLineHeight(11, 1.25),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {`${Math.min(searchMatchIndex(), transcriptMatchCount() - 1) + 1}/${transcriptMatchCount()}`}
              </Text>
            </If>
            <IconButton
              icon="chevron-up"
              size="sm"
              disabled={transcriptMatchCount() === 0}
              accessibilityLabel="search-prev"
              tooltip={tr("chat.searchPrevious")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepSearchMatch(-1)}
            />
            <IconButton
              icon="chevron-down"
              size="sm"
              disabled={transcriptMatchCount() === 0}
              accessibilityLabel="search-next"
              tooltip={tr("chat.searchNext")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepSearchMatch(1)}
            />
            <IconButton
              icon="close"
              size="sm"
              accessibilityLabel="close-transcript-search"
              tooltip={tr("sessions.closeSearch")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => {
                transcriptSearchOpen.set(false);
                setTranscriptSearch("");
              }}
            />
          </View>
        </View>
      </If>
    </View>
  );
}

function ThreadMenuDivider() {
  return <PopoverSeparator />;
}

function ThreadActionsSurface(props: {
  placement: Placement;
  onToggleSplit?: () => void;
  splitOpen?: boolean;
}) {
  const motion = usePopoverMotion(() => props.placement, "end", closeThreadMenu);
  const confirmingDelete = signal(false);
  return (
    <View
      role="menu"
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 212,
          maxWidth: 264,
          padding: POPOVER_PADDING,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "end"),
        },
        motion.style,
      ]}
    >
      <If when={activeSession()}>
        {session => (
          <>
            <ThreadMenuAction
              icon="edit"
              label={tr("common.rename")}
              onPress={() => {
                closeThreadMenu();
                renameValue.set(session().sessionName || "");
                renaming.set(true);
              }}
            />
            <If when={Boolean(props.onToggleSplit)}>
              <ThreadMenuAction
                icon="columns"
                label={props.splitOpen ? tr("sessions.splitClose") : tr("sessions.splitOpen")}
                accessibilityLabel={props.splitOpen ? "session-split-close" : "session-split-open"}
                onPress={() => {
                  closeThreadMenu();
                  props.onToggleSplit?.();
                }}
              />
            </If>
            <ThreadMenuAction
              icon={isArchived(session()) ? "undo" : "layers"}
              label={isArchived(session()) ? tr("sessions.restore") : tr("sessions.archive")}
              onPress={() => {
                closeThreadMenu();
                void archiveSessionRow(session().sessionId, !isArchived(session()));
              }}
            />
            <If when={sessionsCompact()}>
              <ThreadMenuAction
                icon="globe"
                label={tr("browser.live.menu")}
                accessibilityLabel="session-browser-live"
                onPress={() => {
                  closeThreadMenu();
                  navigateScene("browser");
                }}
              />
            </If>

            <ThreadMenuDivider />

            <If when={!isTranscriptEmpty() || transcriptSearchOpen()}>
              <ThreadMenuAction
                icon="search"
                label={tr("sessions.searchTranscript")}
                accessibilityLabel="transcript-search-toggle"
                onPress={() => {
                  closeThreadMenu();
                  const next = !transcriptSearchOpen();
                  transcriptSearchOpen.set(next);
                  if (!next) setTranscriptSearch("");
                }}
              />
            </If>
            <ThreadMenuAction
              icon="git-branch"
              label={tr("sessions.fork")}
              onPress={() => {
                closeThreadMenu();
                void forkActiveSession();
              }}
            />
            <ThreadMenuAction
              icon="copy"
              label={tr("sessions.duplicate")}
              onPress={() => {
                closeThreadMenu();
                void copyActiveSession();
              }}
            />
            <ThreadMenuAction
              icon="eye"
              label={tr("review.open")}
              accessibilityLabel="review-launch-open"
              onPress={() => {
                closeThreadMenu();
                openReviewLauncher();
              }}
            />

            <ThreadMenuDivider />

            <If when={sessionTurns().length > 0}>
              <ThreadMenuAction
                icon={copiedTranscript() ? "check" : "copy"}
                label={tr("sessions.copyTranscript")}
                accessibilityLabel="copy-transcript"
                onPress={() => {
                  closeThreadMenu();
                  void copyWholeTranscript();
                }}
              />
            </If>
            <Each
              of={sessionMenuItems(
                {
                  sessionId: session().sessionId,
                  deviceId: activeSessionDevice(),
                  workspaceId: activeWorkspaceId() ?? "",
                  title: sessionTitle(session()),
                  archived: isArchived(session()),
                },
                { omit: ["rename", "archive", "delete", "split"] },
              )}
              key={item => item.id}
            >
              {item => (
                <ThreadMenuAction
                  icon={item().icon ?? "more"}
                  label={item().label}
                  hint={item().hint}
                  disabled={item().disabled}
                  accessibilityLabel={item().accessibilityLabel}
                  onPress={() => {
                    closeThreadMenu();
                    item().onSelect?.();
                  }}
                />
              )}
            </Each>

            <ThreadMenuDivider />

            <If
              when={confirmingDelete()}
              else={
                <ThreadMenuAction
                  icon="trash"
                  label={tr("common.delete")}
                  danger={true}
                  accessibilityLabel="session-delete-trigger"
                  onPress={() => confirmingDelete.set(true)}
                />
              }
            >
              <View
                accessibilityLabel="session-delete-inline-confirm"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: compactLayout() || sessionsCompact() ? layout.touchTarget : controlHeight.md,
                  paddingHorizontal: space.xs,
                  gap: space.xs,
                  borderRadius: POPOVER_ROW_RADIUS,
                  borderCurve: "continuous",
                  backgroundColor: palette().dangerSoft,
                }}
              >
                <View
                  role="button"
                  accessibilityLabel="session-delete-cancel"
                  onPress={() => confirmingDelete.set(false)}
                  style={{
                    flex: 1,
                    height: compactLayout() ? 32 : 24,
                    borderRadius: radii.xs,
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: listRowHoverBg() }}
                  activeStyle={tactileActiveStyle(0.96)}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <Text style={{ ...textStyle("caption", { color: palette().text }), fontWeight: "500" }}>
                    {tr("common.cancel")}
                  </Text>
                </View>
                <View style={{ width: 1, height: 14, backgroundColor: palette().borderSubtle }} />
                <View
                  role="button"
                  accessibilityLabel="session-delete-confirm"
                  onPress={() => {
                    confirmingDelete.set(false);
                    closeThreadMenu();
                    void deleteSessionRow(session().sessionId);
                  }}
                  style={{
                    flex: 1,
                    height: compactLayout() ? 32 : 24,
                    borderRadius: radii.xs,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: palette().danger,
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ opacity: 0.92 }}
                  activeStyle={tactileActiveStyle(0.96)}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <Text style={{ ...textStyle("caption", { color: palette().actionPrimaryFg }), fontWeight: "600" }}>
                    {tr("common.confirm")}
                  </Text>
                </View>
              </View>
            </If>
          </>
        )}
      </If>
    </View>
  );
}

function ThreadMenuAction(props: {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <View
      role="menuitem"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={popoverRowStyle(false, props.disabled)}
      hoverStyle={
        props.disabled ? {} : { backgroundColor: props.danger ? palette().dangerSoft : listRowHoverBg() }
      }
      activeStyle={
        props.danger ? { backgroundColor: palette().dangerHoverBg } : popoverRowActiveStyle()
      }
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <ListRowContent
        icon={props.icon}
        iconColor={props.danger ? palette().danger : palette().textSecondary}
        title={props.label}
        titleColor={props.danger ? palette().danger : palette().text}
        subtitle={props.hint}
        subtitleLines={2}
      />
    </View>
  );
}

/** Which block's "Copy" button just confirmed; key is the turn + block text. */
const copiedBlock = signal("");

function CopyChip(props: { partKey: string; text: string }) {
  const copied = computed(() => copiedBlock() === props.partKey);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });
  return (
    <View
      role="button"
      onPress={() => {
        void Clipboard.writeText(props.text).then(() => {
          copiedBlock.set(props.partKey);
          if (copyTimer) clearTimeout(copyTimer);
          copyTimer = setTimeout(() => {
            copyTimer = null;
            if (copiedBlock() === props.partKey) copiedBlock.set("");
          }, 1500);
        });
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        minWidth: compactLayout() ? layout.touchTarget : undefined,
        minHeight: compactLayout() ? layout.touchTarget : undefined,
        gap: space.xs,
        paddingHorizontal: compactLayout() ? space.sm : space.chip,
        paddingVertical: space.hair,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
      activeStyle={tactileActiveStyle(0.97)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon
        name={copied() ? "check" : "copy"}
        size={12}
        color={copied() ? palette().success : palette().textMuted}
      />
      <Text
        style={{
          color: copied() ? palette().success : palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "500",
        }}
      >
        {copied() ? tr("common.copied") : tr("common.copy")}
      </Text>
    </View>
  );
}

/** User messages longer than this many lines start clamped behind "Show more". */
const USER_MESSAGE_CLAMP_LINES = 12;
const expandedUserMessages = signal<string[]>([]);

interface UserImage {
  id: string;
  name: string;
  dataUrl?: string;
  imagePath?: string;
}

/** The images the turn's user message carried, as the host's view reports them. */
function userImagesOf(turn: unknown): UserImage[] {
  if (!turn || typeof turn !== "object") return [];
  const images = (turn as Partial<TranscriptTurnView>).user?.images;
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => ({
    id: `${image.name}-${index}`,
    name: image.name,
    ...(image.dataUrl ? { dataUrl: image.dataUrl } : {}),
    ...(image.imagePath ? { imagePath: image.imagePath } : {}),
  }));
}

/** Converts persisted or live `UserImage` items back to `ImageAttachment[]` for retry / edit-and-rerun. */
function userImagesToAttachments(images: ReadonlyArray<UserImage>): ImageAttachment[] {
  return images.flatMap((image, index) => {
    if (!image.dataUrl && !image.imagePath) return [];
    const dataMime = image.dataUrl?.match(/^data:([^;,]+)[;,]/i)?.[1];
    const mimeType = dataMime || mimeFromFilename(image.name || image.imagePath || "image.png");
    const base64Body = image.dataUrl?.split(",")[1] ?? "";
    const fileSize = base64Body ? Math.floor((base64Body.length * 3) / 4) : 0;
    return [
      {
        id: `reused-image-${index}-${++nextDroppedAttachmentId}`,
        name: image.name || `image-${index + 1}.png`,
        mimeType,
        fileSize,
        ...(image.dataUrl ? { dataUrl: image.dataUrl } : {}),
        ...(image.imagePath ? { imagePath: image.imagePath } : {}),
      },
    ];
  });
}

function UserImageStrip(props: { images: UserImage[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
      <Each of={props.images} key={image => image.id}>
        {image => (
          <If
            when={attachmentPreviewSrc(image())}
            else={
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Icon name="image" size={12} color={palette().textSecondary} />
                <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
                  {image().name}
                </Text>
              </View>
            }
          >
            {src => (
              <View
                role="button"
                accessibilityLabel={`user-image-preview-${image().name}`}
                tooltip={<TooltipBubble text={image().name} />}
                onPress={() => openImageLightbox({ src: src(), title: image().name })}
                style={{
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  overflow: "hidden",
                  cursor: "pointer",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ borderColor: palette().borderStrong, opacity: 0.94 }}
                activeStyle={tactileActiveStyle(0.97)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Image
                  src={src()}
                  accessibilityLabel={`user-image-${image().name}`}
                  style={{ width: 96, height: 96, objectFit: "cover" }}
                />
              </View>
            )}
          </If>
        )}
      </Each>
    </View>
  );
}

interface ParsedUserFileTag {
  key: string;
  kind: "file" | "dir";
  ref: string;
  name: string;
}

function extractUserMessageFileTags(raw: string): { files: ParsedUserFileTag[]; text: string } {
  const files: ParsedUserFileTag[] = [];
  const seen = new Set<string>();
  const stripped = raw.replace(/(?:^|\s)#(file|dir):(\S+)/g, (match, kind: "file" | "dir", ref: string) => {
    const key = `${kind}:${ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      const name = basename(ref) || ref;
      files.push({ key, kind, ref, name });
    }
    return match.startsWith(" ") || match.startsWith("\n") ? " " : "";
  });
  return {
    files,
    text: stripped.replace(/[ \t]{2,}/g, " ").trim(),
  };
}

function fileAttachmentIcon(entry: { isDirectory?: boolean; source?: FileAttachment["source"]; name: string }): IconName {
  if (entry.isDirectory) return "folder";
  if (entry.source === "pasted-text") return "file-text";
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "sh", "json", "toml", "yaml", "yml", "css", "html"].includes(ext)) {
    return "code";
  }
  return "file-text";
}

function resolveUserTagPath(ref: string): string {
  if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) return ref;
  const root = activeWorkspaceRoot();
  if (!root) return ref;
  const sep = !isRemoteActiveWorkspace() && /^[A-Za-z]:\\/.test(root) ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${ref.replace(/^[\\/]+/, "")}`;
}

function UserBubble(props: {
  partKey: string;
  text: string;
  timestamp?: number;
  showCopy?: boolean;
  turnId?: string;
  images?: UserImage[];
}) {
  const hovered = signal(false);
  effect(() => {
    // Reset local hover when a virtualized list cell is recycled for another turn.
    props.partKey;
    hovered.set(false);
  });
  const parsed = computed(() => extractUserMessageFileTags(props.text));
  const displayText = computed(() => parsed().text);
  const long = computed(
    () => displayText().split("\n").length > USER_MESSAGE_CLAMP_LINES || displayText().length > 900,
  );
  const expanded = computed(() => expandedUserMessages().includes(props.partKey));
  const revealActions = computed(
    () =>
      compactLayout() ||
      hovered() ||
      copiedBlock() === props.partKey ||
      Boolean(props.turnId && rerunTarget()?.turnId === props.turnId),
  );
  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        alignSelf: "flex-end",
        // Spec §3 User: min(560, 72 %) of the column actually drawn (a phone's is narrower than `contentWidth()`).
        maxWidth: Math.min(
          560,
          Math.round(
            Math.min(contentWidth(), sessionsPaneWidth() > 0 ? sessionsPaneWidth() - 2 * sessionsPadX() : contentWidth()) * 0.72,
          ),
        ),
        gap: space.xs,
        alignItems: "flex-end",
      }}
    >
      <If when={(props.images?.length ?? 0) > 0}>
        <UserImageStrip images={props.images ?? []} />
      </If>
      <If when={parsed().files.length > 0}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.chip }}>
          <Each of={parsed().files} key={item => item.key}>
            {item => (
              <View
                role="button"
                accessibilityLabel={`user-file-ref-${item().name}`}
                tooltip={<TooltipBubble text={`${item().ref} · ${tr("sessions.fileChipOpenHint")}`} />}
                onPress={() => {
                  if (item().kind === "file") {
                    openInAuxPane("files", resolveUserTagPath(item().ref));
                  } else {
                    openInAuxPane("files");
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                  maxWidth: 240,
                  height: 26,
                  paddingHorizontal: space.sm,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().panelHover, borderColor: palette().border }}
                activeStyle={tactileActiveStyle(0.97)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Icon
                  name={fileAttachmentIcon({ isDirectory: item().kind === "dir", name: item().name })}
                  size={12}
                  color={item().kind === "dir" ? palette().accent : palette().textSecondary}
                />
                <Text
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    color: palette().text,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.3),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {item().name}
                </Text>
              </View>
            )}
          </Each>
        </View>
      </If>
      <If when={displayText().length > 0 || (parsed().files.length === 0 && (props.images?.length ?? 0) === 0)}>
      <View
        style={{
          backgroundColor: palette().userBubble,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          gap: space.xs,
        }}
      >
        <Text
          style={{
            ...textStyle("prose", { color: palette().userBubbleText }),
            userSelect: "text",
            numberOfLines: long() && !expanded() ? USER_MESSAGE_CLAMP_LINES : undefined,
            textOverflow: long() && !expanded() ? "ellipsis" : undefined,
          }}
        >
          {displayText()}
        </Text>
        <If when={long()}>
          <View
            role="button"
            accessibilityLabel={`user-message-toggle-${props.partKey}`}
            onPress={() => {
              const current = expandedUserMessages();
              expandedUserMessages.set(
                current.includes(props.partKey)
                  ? current.filter(key => key !== props.partKey)
                  : [...current, props.partKey],
              );
            }}
            style={{
              alignSelf: "flex-start",
              minHeight: compactLayout() ? layout.touchTarget : undefined,
              justifyContent: "center",
              paddingHorizontal: space.xs,
              borderRadius: radii.sm,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            activeStyle={tactileActiveStyle(0.98)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), fontWeight: "500" }}>
              {expanded() ? tr("chat.showLess") : tr("chat.showMore")}
            </Text>
          </View>
        </If>
      </View>
      </If>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: compactLayout() ? layout.touchTarget : controlHeight.xs,
          gap: space.xs,
          paddingHorizontal: space.hair,
          opacity: revealActions() ? 1 : 0,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        focusWithinStyle={{ opacity: 1 }}
      >
        <If when={props.timestamp ? formatTimestamp(props.timestamp) : ""}>
          {stamp => (
            <Text style={textStyle("caption", { tabular: true })}>
              {stamp()}
            </Text>
          )}
        </If>
        <If when={props.turnId && !runningTurnId() ? props.turnId : ""}>
          {turnId => (
            <IconButton
              icon="edit"
              size="xs"
              accessibilityLabel={`edit-rerun-${turnId()}`}
              tooltip={tr("chat.editAndRerun")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => beginRerun(turnId(), props.text, props.images)}
            />
          )}
        </If>
        <If when={props.showCopy !== false}>
          <CopyChip partKey={props.partKey} text={props.text} />
        </If>
      </View>
    </View>
  );
}

/**
 * Edit-and-rerun from a user message: `rollback_session_to_turn` drops that turn
 * and everything after it, then the edited text (and its preserved images) starts
 * a new turn — the order the desktop's `UserMessageItem` uses.
 */
const rerunTarget = signal<{ turnId: string; text: string; images: ImageAttachment[] } | null>(null);
const rerunBusy = signal(false);

function beginRerun(turnId: string, text: string, images?: UserImage[]): void {
  rerunTarget.set({
    turnId,
    text,
    images: images && images.length > 0 ? userImagesToAttachments(images) : [],
  });
}

async function confirmRerun(): Promise<void> {
  const target = rerunTarget();
  const sessionId = activeSessionId();
  const workspaceId = activeWorkspaceId();
  if (!target || !sessionId || !workspaceId || rerunBusy()) return;
  const text = target.text.trim();
  if (!text && target.images.length === 0) return;
  rerunBusy.set(true);
  try {
    clearPromptSuggestion(sessionId, activeSessionDevice());
    await rollbackSessionToTurn({ sessionId, targetTurnId: target.turnId, workspaceId });
    rerunTarget.set(null);
    await loadTurns(sessionId);
    jumpToTranscriptEnd();
    await sendTurn(text, undefined, target.images.length > 0 ? { attachments: target.images } : undefined);
  } catch (error) {
    turnError.set(error instanceof Error ? error.message : String(error));
  } finally {
    rerunBusy.set(false);
  }
}

function RerunEditor() {
  return (
    <If when={rerunTarget()}>
      {target => (
        <View style={{ gap: 8, alignSelf: "stretch" }}>
          <If when={target().images.length > 0}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              <Each of={target().images} key={image => image.id}>
                {image => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.xs,
                      paddingLeft: space.xs,
                      paddingRight: space.chip,
                      paddingVertical: space.hair + 1,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <If
                      when={attachmentPreviewSrc(image())}
                      else={<Icon name="image" size={12} color={palette().textSecondary} />}
                    >
                      {src => (
                        <Image
                          src={src()}
                          style={{ width: 20, height: 20, borderRadius: radii.xs }}
                        />
                      )}
                    </If>
                    <Text
                      style={{
                        ...textStyle("caption", { color: palette().textSecondary }),
                        maxWidth: 140,
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {image().name}
                    </Text>
                    <IconButton
                      icon="close"
                      size="xs"
                      iconSize={10}
                      accessibilityLabel={`rerun-remove-image-${image().id}`}
                      onPress={() => {
                        const current = rerunTarget();
                        if (!current) return;
                        rerunTarget.set({
                          ...current,
                          images: current.images.filter(entry => entry.id !== image().id),
                        });
                      }}
                    />
                  </View>
                )}
              </Each>
            </View>
          </If>
          <InputBox
            value={target().text}
            multiline={true}
            accessibilityLabel="rerun-input"
            onChange={value => {
              const current = rerunTarget();
              if (current) rerunTarget.set({ ...current, text: value });
            }}
          />
          <InlineConfirmBar
            message={tr("chat.rerunConfirm")}
            confirmLabel={tr("chat.rerunAction")}
            danger={true}
            onConfirm={() => void confirmRerun()}
            onCancel={() => {
              rerunTarget.set(null);
            }}
          />
        </View>
      )}
    </If>
  );
}

/**
 * Thinking blocks start collapsed — both while streaming and when persisted —
 * so reasoning never expands then snaps shut and jumps the transcript height.
 * A reader can expand or collapse any block by hand at any time.
 */
const thinkingOverrides = signal<Record<string, boolean>>({});

function ThinkingBlock(props: {
  partKey: string;
  text: string | (() => string);
  kind?: "reasoning" | "summary";
  live?: boolean;
}) {
  let tailRef: ScrollRef | undefined;
  const expanded = computed(() => thinkingOverrides()[props.partKey] === true);
  const resolvedText = () => (typeof props.text === "function" ? props.text() : props.text);
  effect(() => {
    // Tail-follow while the reasoning streams into a block the reader opened.
    if (props.live && expanded()) {
      resolvedText();
      tailRef?.scrollToEnd({ animated: false });
    }
  });
  return (
    <View style={{ gap: space.xs }}>
      <View
        role="button"
        accessibilityLabel={`thinking-${props.partKey}`}
        onPress={() => {
          thinkingOverrides.update(current => ({ ...current, [props.partKey]: !expanded() }));
        }}
        style={{
          alignSelf: "flex-start",
          ...transcriptRowStyle(true),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        activeStyle={tactileActiveStyle(0.98)}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <TranscriptRowIconSlot>
          <If when={Boolean(props.live)} else={<Icon name="bulb" size={14} color={palette().textMuted} />}>
            <BrandSpinner size={12} color={palette().accent} variant="matrix" />
          </If>
        </TranscriptRowIconSlot>
        <Text style={textStyle("label", { color: palette().textMuted })}>
          {props.live
            ? tr("state.thinking")
            : props.kind === "summary"
              ? tr("chat.thinkingSummary")
              : tr("chat.thinking")}
        </Text>
        <TranscriptRowChevron expanded={expanded} />
      </View>
      <If when={expanded()}>
        {() => {
          const reveal = subtleCrossfadeMotion();
          return (
            <View
              style={[
                {
                  marginLeft: TRANSCRIPT_ROW_RAIL_OFFSET,
                  paddingLeft: 15,
                  borderLeftWidth: 2,
                  borderColor: props.live ? palette().accentBorder : palette().borderSubtle,
                },
                reveal.style,
              ]}
            >
              <Scroll smoothWheel ref={tailRef} style={{ maxHeight: 300, minHeight: 0 }} scrollbar={true}>
                <TextView
                  markdown={resolvedText()}
                  selectable
                  links="report"
                  onLinkPress={handleMarkdownLink}
                  options={props.live ? STREAMING_MARKDOWN_OPTIONS : STATIC_MARKDOWN_OPTIONS}
                  styles={createMarkdownStyles({ compact: true, baseFontSize: 13 })}
                />
              </Scroll>
            </View>
          );
        }}
      </If>
    </View>
  );
}

function isRemoteActiveWorkspace(): boolean {
  return isRemoteWorkspace(activeWorkspace());
}

/** A link in a reply: external links open via OS, relative or file paths resolve against the workspace root. */
function handleMarkdownLink(event: { url: string }): void {
  const resolved = resolveWorkspaceMarkdownLink(event.url, activeWorkspaceRoot(), isRemoteActiveWorkspace());
  if (resolved.kind === "external") {
    void openUrl(resolved.url).catch(() => undefined);
    return;
  }
  if (resolved.kind === "workspace") {
    openInAuxPane("files", resolved.path);
  }
}

function handleMarkdownImagePress(event: { image: { src: string; alt?: string; title?: string } }): void {
  const raw = (event.image.src ?? "").trim();
  if (!raw) return;
  const title = event.image.alt || event.image.title || undefined;
  if (/^(https?:|data:|file:|asset:)/i.test(raw)) {
    openImageLightbox({ src: raw, title });
    return;
  }
  const resolved = resolveWorkspaceMarkdownLink(raw, activeWorkspaceRoot(), isRemoteActiveWorkspace());
  if (resolved.kind === "workspace") {
    if (isLocalAttachmentPathAllowed()) {
      openImageLightbox({ src: fileUrlOfPath(resolved.path), title: title || basename(resolved.path) });
    } else {
      openInAuxPane("files", resolved.path);
    }
  }
}

/** Structured summary card for an inline visualization figure (`visualize{...}` or `publishedFigures`). */
function InlineFigureCard(props: { figure: InlineFigureDirective }) {
  const canOpenInFiles = () => !props.figure.path.startsWith("openbitfun://");
  return (
    <View
      testID={`inline-figure-${props.figure.slug}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceTertiary,
      }}
    >
      <Icon name="sparkles" size={14} color={palette().accent} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            ...textStyle("label", { color: palette().text }),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.figure.title || props.figure.slug}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontFamily: fontMono,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.3),
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {props.figure.path}
        </Text>
      </View>
      <If when={canOpenInFiles()}>
        <Button
          label={tr("common.open")}
          variant="ghost"
          size="xs"
          accessibilityLabel={`open-figure-${props.figure.slug}`}
          onPress={() => openInAuxPane("files", props.figure.path)}
        />
      </If>
      <Button
        label={tr("pane.files.copyPath")}
        variant="ghost"
        size="xs"
        accessibilityLabel={`copy-figure-${props.figure.slug}`}
        onPress={() => {
          void Clipboard.writeText(props.figure.path).then(
            () => pushToast(tr("common.copied"), "success"),
            () => undefined,
          );
        }}
      />
    </View>
  );
}

/** Reads any backend-projected `publishedFigures` attached to a turn that weren't already emitted inline. */
function publishedFiguresOf(turn: unknown): InlineFigureDirective[] {
  if (!turn || typeof turn !== "object") return [];
  const record = turn as Record<string, unknown>;
  const raw = record.publishedFigures ?? record.published_figures;
  if (!Array.isArray(raw)) return [];
  const inlinePaths = new Set<string>();
  for (const part of turnParts(turn)) {
    if (part.role === "assistant" && part.text.includes("\uE200")) {
      for (const fig of extractVisualizeDirectives(part.text).figures) inlinePaths.add(fig.path);
    }
  }
  const figures: InlineFigureDirective[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const path = typeof item.uri === "string" ? item.uri.trim() : typeof item.path === "string" ? item.path.trim() : "";
    if (!path || inlinePaths.has(path)) continue;
    inlinePaths.add(path);
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined;
    const base = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
    const slug = base.replace(/\.html?$/i, "") || "figure";
    figures.push({ path, slug, ...(title ? { title } : {}) });
  }
  return figures;
}

/** Which oversized replies the reader opened in full, one signal per item key. */
const fullReplySignals = new Map<string, Signal<boolean>>();
/** Turn IDs that streamed live in the open session, so settling never collapses a reply the user just watched stream. */
const liveStreamedTurnIds = new Set<string>();

function fullReplySignal(key: string): Signal<boolean> {
  let entry = fullReplySignals.get(key);
  if (!entry) {
    entry = signal(false);
    fullReplySignals.set(key, entry);
  }
  return entry;
}

function MarkdownBody(props: { text: string; live?: boolean }) {
  const parsed = computed(() => extractVisualizeDirectives(props.text, { streaming: props.live }));
  return (
    <View style={{ width: "100%", gap: space.sm }}>
      <If when={parsed().text}>
        <TextView
          markdown={parsed().text}
          selectable
          links="report"
          onLinkPress={handleMarkdownLink}
          onImagePress={handleMarkdownImagePress}
          options={props.live ? STREAMING_MARKDOWN_OPTIONS : STATIC_MARKDOWN_OPTIONS}
          codeBlockActions={createMarkdownCodeActions()}
          styles={createMarkdownStyles()}
        />
      </If>
      <If when={parsed().figures.length > 0}>
        <View style={{ gap: space.xs }}>
          <Each of={parsed().figures} key={fig => fig.path}>
            {fig => <InlineFigureCard figure={fig()} />}
          </Each>
        </View>
      </If>
    </View>
  );
}

/**
 * A reply, full column width. A settled reply above `LARGE_MARKDOWN_CHARS`
 * opens as a preview cut at a safe paragraph break, and lays out the rest only
 * when the reader asks for it, so a session with a few huge answers opens fast.
 */
function AnswerMarkdown(props: { text: string; live?: boolean; itemKey?: string; preserveFullReply?: boolean }) {
  const large = computed(() => !props.live && !props.preserveFullReply && props.text.length > LARGE_MARKDOWN_CHARS);
  const cut = computed(() => (large() ? markdownPreviewCut(props.text) : props.text.length));
  const collapsed = computed(
    () => large() && cut() < props.text.length && !fullReplySignal(props.itemKey ?? props.text.slice(0, 64))(),
  );
  return (
    <View style={{ width: "100%", gap: 6 }}>
      <If
        when={collapsed()}
        else={<MarkdownBody text={props.text} live={props.live} />}
      >
        <MarkdownBody text={markdownPreviewSlice(props.text, cut())} />
        <View style={{ alignSelf: "flex-start" }}>
          <Button
            label={tr("chat.polish.showFullReply", { count: formatCount(lineCountOf(props.text.slice(cut()))) })}
            variant="ghost"
            size="xs"
            trailingIcon="chevron-down"
            accessibilityLabel={`show-full-reply-${props.itemKey ?? ""}`}
            onPress={() => fullReplySignal(props.itemKey ?? props.text.slice(0, 64)).set(true)}
          />
        </View>
      </If>
    </View>
  );
}

type ItemOf<K extends TranscriptItem["kind"]> = Extract<TranscriptItem, { kind: K }>;

function renderFoldedThinking(item: Extract<FoldedProcessItem, { kind: "thinking" }>, pane: 0 | 1 = 0): JSX.Element {
  const text: string | (() => string) = item.roundId
    ? () => (pane === 1 ? getSecondaryLiveRoundThinking(item.roundId!) : getLiveRoundThinking(item.roundId!))
    : item.text;
  return <ThinkingBlock partKey={item.key} text={text} kind={item.reasoningKind} live={item.live} />;
}

/**
 * One ordered transcript item, drawn the same way whether it is live or
 * persisted. Branches reactively on `props.item.kind` so recycled virtualized
 * `<List>` cells can cleanly swap between text, thinking, tool, and explore rows.
 */
function TranscriptItemView(props: {
  item: TranscriptItem;
  live?: boolean;
  preserveFullReply?: boolean;
  pane?: 0 | 1;
  /** In the virtualized transcript an open group's steps are rows of their own. */
  stepsAsRows?: boolean;
}) {
  const kind = () => props.item.kind;
  const isGenUI = () => kind() === "tool" && isGenUICall((props.item as ItemOf<"tool">).call);
  const pane = props.pane ?? 0;
  return (
    <View style={{ width: "100%" }}>
      <If when={kind() === "text"}>
        <AnswerMarkdown
          text={(props.item as ItemOf<"text">).text}
          live={props.live}
          itemKey={props.item.key}
          preserveFullReply={props.preserveFullReply}
        />
      </If>
      <If when={kind() === "thinking"}>
        {() => {
          const item = () => props.item as ItemOf<"thinking">;
          return (
            <ThinkingBlock
              partKey={item().key}
              text={
                item().roundId
                  ? () => (pane === 1 ? getSecondaryLiveRoundThinking(item().roundId!) : getLiveRoundThinking(item().roundId!))
                  : item().text
              }
              kind={item().reasoningKind}
              live={item().live}
            />
          );
        }}
      </If>
      <If when={isGenUI()}>
        <GenUIToolItem
          call={(props.item as ItemOf<"tool">).call}
          cardId={props.item.key}
          status={persistedToolState((props.item as ItemOf<"tool">).call)}
          fallback={
            <ToolCard
              call={(props.item as ItemOf<"tool">).call}
              cardId={props.item.key}
              status={persistedToolState((props.item as ItemOf<"tool">).call)}
            />
          }
        />
      </If>
      <If when={kind() === "tool" && !isGenUI()}>
        <ToolCard
          call={(props.item as ItemOf<"tool">).call}
          cardId={props.item.key}
          status={persistedToolState((props.item as ItemOf<"tool">).call)}
        />
      </If>
      <If when={kind() === "explore"}>
        <ExploreGroupCard
          items={(props.item as ItemOf<"explore">).items}
          calls={(props.item as ItemOf<"explore">).calls}
          cardId={props.item.key}
          stateOf={persistedToolState}
          renderThinking={entry => renderFoldedThinking(entry, pane)}
          live={props.live}
          inlineSteps={!props.stepsAsRows}
        />
      </If>
    </View>
  );
}

/** Renders an ordered item list; rows are kept by the item's key. */
function TranscriptItems(props: { items: TranscriptItem[]; live?: boolean; preserveFullReply?: boolean; pane?: 0 | 1 }) {
  return (
    <View style={{ gap: 8 }}>
      <Each of={props.items} key={item => item.key}>
        {item => (
          <TranscriptItemView
            item={item()}
            live={props.live}
            preserveFullReply={props.preserveFullReply}
            pane={props.pane}
          />
        )}
      </Each>
    </View>
  );
}

function liveToolToCallView(tool: LiveToolItem): ToolCallView {
  return {
    id: tool.toolId,
    name: tool.effectiveToolName || tool.toolName,
    detail: tool.progressMessage || tool.detail,
    ...(tool.input !== undefined ? { input: tool.input } : {}),
    status: tool.status,
    ...(tool.error ? { error: tool.error } : {}),
    ...(tool.result !== undefined ? { result: tool.result } : {}),
    ...(tool.resultForAssistant ? { resultForAssistant: tool.resultForAssistant } : {}),
    ...(tool.durationMs !== undefined ? { durationMs: tool.durationMs } : {}),
    ...(tool.genuiStream
      ? {
          genuiStream: {
            source: tool.genuiStream.source,
            format: tool.genuiStream.format,
            ...(tool.genuiStream.title ? { title: tool.genuiStream.title } : {}),
          },
        }
      : {}),
  };
}

const liveRounds = computed<LiveModelRound[]>(() => liveTurn()?.rounds ?? []);

type LiveDisplayBlock =
  | { kind: "liveText"; key: string; roundId: string; start: number; end?: number }
  | { kind: "thinking"; key: string; roundId: string; reasoningKind?: "reasoning" | "summary"; live: boolean }
  | { kind: "tool"; key: string; call: ToolCallView }
  | { kind: "explore"; key: string; items: FoldedProcessItem[]; calls: ToolCallView[] };

/**
 * Projects live rounds into the exact same folded structure `turnItems` produces
 * on settle, reading only coarse structural signals (`hasLiveRoundThinking`,
 * `hasLiveRoundText`, `hasLiveRoundTailText`) so steady-state streaming never
 * recomputes the block list.
 */
function buildLiveDisplayBlocks(rounds: LiveModelRound[], pane: 0 | 1 = 0): LiveDisplayBlock[] {
  const singleRound = rounds.length === 1;
  const raw: LiveDisplayBlock[] = [];
  for (const round of rounds) {
    const hasThinking = pane === 1 ? hasSecondaryLiveRoundThinking(round.roundId) : hasLiveRoundThinking(round.roundId);
    const hasText = pane === 1 ? hasSecondaryLiveRoundText(round.roundId) : hasLiveRoundText(round.roundId);
    const hasTailText = pane === 1 ? hasSecondaryLiveRoundTailText(round.roundId) : hasLiveRoundTailText(round.roundId);
    if (hasThinking) {
      raw.push({
        kind: "thinking",
        key: round.roundId === "__default__" || singleRound ? "live-thinking" : `live-thinking-${round.roundId}`,
        roundId: round.roundId,
        ...(round.reasoningKind ? { reasoningKind: round.reasoningKind } : {}),
        live: !round.completed && !round.thinkingEnded && !hasText && round.tools.length === 0,
      });
    }
    let cursor = 0;
    let segment = 0;
    for (const tool of round.tools) {
      const offset = Math.max(cursor, tool.textOffset ?? 0);
      if (hasText && offset > cursor) {
        raw.push({
          kind: "liveText",
          key: `live-text-${round.roundId}-${segment}`,
          roundId: round.roundId,
          start: cursor,
          end: offset,
        });
        segment += 1;
        cursor = offset;
      }
      raw.push({ kind: "tool", key: `tool:${tool.toolId}`, call: liveToolToCallView(tool) });
    }
    if ((cursor === 0 && hasText) || (cursor > 0 && hasTailText)) {
      raw.push({
        kind: "liveText",
        key: `live-text-${round.roundId}-${segment}`,
        roundId: round.roundId,
        start: cursor,
      });
    }
  }

  const blocks: LiveDisplayBlock[] = [];
  let run: FoldedProcessItem[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const firstTool = run.find(entry => entry.kind === "tool");
      const calls = run.flatMap(entry => (entry.kind === "tool" ? [entry.call] : []));
      blocks.push({
        kind: "explore",
        key: `explore:${(firstTool ?? run[0]!).key}`,
        items: run,
        calls,
      });
    } else if (run.length === 1) {
      const only = run[0]!;
      if (only.kind === "thinking") {
        blocks.push({
          kind: "thinking",
          key: only.key,
          roundId: only.roundId ?? "__default__",
          ...(only.reasoningKind ? { reasoningKind: only.reasoningKind } : {}),
          live: Boolean(only.live),
        });
      } else {
        blocks.push(only);
      }
    }
    run = [];
  };

  for (const item of raw) {
    if (item.kind === "thinking") {
      run.push({
        kind: "thinking",
        key: item.key,
        text: "",
        roundId: item.roundId,
        ...(item.reasoningKind ? { reasoningKind: item.reasoningKind } : {}),
        live: item.live,
      });
      continue;
    }
    if (item.kind === "tool" && isFoldableToolCall(item.call)) {
      run.push(item);
      continue;
    }
    flush();
    blocks.push(item);
  }
  flush();
  return blocks;
}

const liveDisplayBlocks = computed<LiveDisplayBlock[]>(() => buildLiveDisplayBlocks(liveRounds(), 0));

/**
 * True when live blocks already carry an active visual pulse (live thinking,
 * a running/preparing tool, or actively streaming text in an open round), so
 * the standalone waiting indicator can hand off without duplicating spinners.
 */
function liveBlocksHaveActiveMotion(
  blocks: ReadonlyArray<LiveDisplayBlock>,
  rounds: ReadonlyArray<LiveModelRound>,
  pane: 0 | 1,
): boolean {
  for (const block of blocks) {
    if (block.kind === "thinking" && block.live) return true;
    if (block.kind === "tool") {
      if (persistedToolState(block.call) === "running") return true;
    }
    if (block.kind === "explore") {
      for (const entry of block.items) {
        if (entry.kind === "thinking" && entry.live) return true;
        if (entry.kind === "tool") {
          if (persistedToolState(entry.call) === "running") return true;
        }
      }
    }
  }
  const latestRound = rounds[rounds.length - 1];
  if (latestRound && !latestRound.completed) {
    const hasText = pane === 1 ? hasSecondaryLiveRoundText(latestRound.roundId) : hasLiveRoundText(latestRound.roundId);
    const hasTailText =
      pane === 1 ? hasSecondaryLiveRoundTailText(latestRound.roundId) : hasLiveRoundTailText(latestRound.roundId);
    if (latestRound.tools.length === 0 ? hasText : hasTailText) return true;
  }
  return false;
}

/**
 * Calm, zero-jump waiting row shown immediately after sending a message (before
 * TTFT) and between finished tool rounds while waiting for the next LLM chunk.
 */
function TurnWaitingIndicator(props: { startedAt?: () => number | undefined; accessibilityLabel: string }) {
  const mountedAt = Date.now();
  const originMs = () => {
    const reported = props.startedAt?.();
    return typeof reported === "number" && reported > 0 ? Math.min(reported, mountedAt) : mountedAt;
  };
  const elapsedSec = signal(Math.max(0, Math.floor((Date.now() - originMs()) / 1000)));
  const timer = setInterval(() => {
    elapsedSec.set(Math.max(0, Math.floor((Date.now() - originMs()) / 1000)));
  }, 1000);
  cleanup(() => clearInterval(timer));
  const motion = enterMotion("fadeIn", MOTION_DURATION.fast);
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={[
        transcriptRowStyle(false),
        {
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
          paddingVertical: 0,
        },
        motion.style,
      ]}
    >
      <TranscriptRowIconSlot>
        <BrandSpinner size={12} color={palette().accent} variant="matrix" />
      </TranscriptRowIconSlot>
      <Text style={textStyle("label", { color: palette().textMuted })}>
        {tr("state.thinking")}
      </Text>
      <If when={elapsedSec() >= 2}>
        <Text
          style={{
            ...textStyle("caption", { color: palette().textMuted, tabular: true }),
            opacity: 0.72,
          }}
        >
          {`· ${formatDuration(elapsedSec() * 1000)}`}
        </Text>
      </If>
    </View>
  );
}

/** Fine-grained streaming text slice: subscribes only to its own round's text channel. */
function LiveTextSegment(props: { roundId: string; start: number; end?: number; pane: 0 | 1; itemKey: string }) {
  const slice = computed(() => {
    const full = props.pane === 1 ? getSecondaryLiveRoundText(props.roundId) : getLiveRoundText(props.roundId);
    const start = Math.min(full.length, Math.max(0, props.start));
    const end = props.end !== undefined ? Math.min(full.length, Math.max(start, props.end)) : full.length;
    return full.slice(start, end);
  });
  return (
    <If when={hasVisibleTextFrom(slice())}>
      <AnswerMarkdown text={slice()} live={true} itemKey={props.itemKey} />
    </If>
  );
}

/** Shared live-turn block list used identically by Primary and Secondary split panes. */
function LiveTranscriptBlocks(props: { blocks: () => LiveDisplayBlock[]; pane: 0 | 1; cardPrefix?: string }) {
  const prefix = props.cardPrefix ?? "";
  return (
    <View style={{ gap: 8 }}>
      <Each of={props.blocks()} key={block => block.key}>
        {block => {
          const kind = () => block().kind;
          const isGenUI = () => kind() === "tool" && isGenUICall((block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call);
          return (
            <View style={{ width: "100%" }}>
              <If when={kind() === "liveText"}>
                <LiveTextSegment
                  roundId={(block() as Extract<LiveDisplayBlock, { kind: "liveText" }>).roundId}
                  start={(block() as Extract<LiveDisplayBlock, { kind: "liveText" }>).start}
                  end={(block() as Extract<LiveDisplayBlock, { kind: "liveText" }>).end}
                  pane={props.pane}
                  itemKey={block().key}
                />
              </If>
              <If when={kind() === "thinking"}>
                {() => {
                  const item = () => block() as Extract<LiveDisplayBlock, { kind: "thinking" }>;
                  return (
                    <ThinkingBlock
                      partKey={item().key}
                      text={() =>
                        props.pane === 1
                          ? getSecondaryLiveRoundThinking(item().roundId)
                          : getLiveRoundThinking(item().roundId)
                      }
                      kind={item().reasoningKind}
                      live={item().live}
                    />
                  );
                }}
              </If>
              <If when={isGenUI()}>
                <GenUIToolItem
                  call={(block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call}
                  cardId={`${prefix}${block().key}`}
                  status={persistedToolState((block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call)}
                  fallback={
                    <ToolCard
                      call={(block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call}
                      cardId={`${prefix}${block().key}`}
                      status={persistedToolState((block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call)}
                    />
                  }
                />
              </If>
              <If when={kind() === "tool" && !isGenUI()}>
                <ToolCard
                  call={(block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call}
                  cardId={`${prefix}${block().key}`}
                  status={persistedToolState((block() as Extract<LiveDisplayBlock, { kind: "tool" }>).call)}
                />
              </If>
              <If when={kind() === "explore"}>
                <ExploreGroupCard
                  items={(block() as Extract<LiveDisplayBlock, { kind: "explore" }>).items}
                  calls={(block() as Extract<LiveDisplayBlock, { kind: "explore" }>).calls}
                  cardId={`${prefix}${block().key}`}
                  stateOf={persistedToolState}
                  renderThinking={entry => renderFoldedThinking(entry, props.pane)}
                  live={true}
                />
              </If>
            </View>
          );
        }}
      </Each>
    </View>
  );
}

/** Fallback live items when a legacy host streams flat text without structured rounds. */
const liveFallbackItems = computed<TranscriptItem[]>(() => {
  if (liveRounds().length > 0) return [];
  const fallback: TranscriptItem[] = [];
  if (thinkingText()) {
    fallback.push({ kind: "thinking", key: "live-thinking", text: thinkingText(), live: !streamText() });
  }
  if (streamText()) fallback.push({ kind: "text", key: "live-text", text: streamText() });
  return fallback;
});

/** Cheap O(items) check so TurnFooter never strips/joins markdown on mount. */
function turnHasAssistantText(turn: unknown): boolean {
  if (!turn || typeof turn !== "object") return false;
  const view = turn as { items?: ReadonlyArray<{ kind?: string; text?: string }> };
  if (Array.isArray(view.items)) {
    for (const item of view.items) {
      if (item?.kind === "text" && typeof item.text === "string" && item.text.trim().length > 0) {
        return true;
      }
    }
    return false;
  }
  return turnAnswerText(turn).length > 0;
}

/** The answer text of one persisted turn, for its footer's copy button. */
function turnAnswerText(turn: unknown): string {
  return turnParts(turn)
    .filter(part => part.role === "assistant")
    .map(part => stripVisualizeDirectives(part.text))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function turnTokenLabel(turn: unknown): string {
  if (!turn || typeof turn !== "object") return "";
  const usage = (turn as Record<string, unknown>).tokenUsage ?? (turn as Record<string, unknown>).token_usage;
  if (!usage || typeof usage !== "object") return "";
  const record = usage as Record<string, unknown>;
  const input = record.inputTokens ?? record.input_tokens;
  const output = record.outputTokens ?? record.output_tokens;
  const parts: string[] = [];
  if (typeof input === "number") parts.push(tr("chat.tokensIn", { count: formatTokens(input) }));
  if (typeof output === "number") parts.push(tr("chat.tokensOut", { count: formatTokens(output) }));
  return parts.join(" · ");
}

/** One footer per settled turn: copy the answer, fork from here, and what it cost. */
/** Copy, fork and "{model} · {duration}": on hover only (spec §3 Assistant). */
function TurnFooter(props: { turn: unknown; visible?: boolean }) {
  const hasAnswer = computed(() => turnHasAssistantText(props.turn));
  const turnId = computed(() => turnKeyOf(props.turn));
  const meta = computed(() =>
    [turnMetadataLabel(props.turn), turnTokenLabel(props.turn)].filter(Boolean).join(" · "),
  );
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });
  const revealed = () => props.visible !== false || copiedBlock() === `answer-${turnId()}`;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: compactLayout() ? layout.touchTarget : controlHeight.sm,
        gap: space.hair,
        marginLeft: -space.xs,
        opacity: revealed() ? 1 : 0,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      focusWithinStyle={{ opacity: 1 }}
    >
      <If when={hasAnswer()}>
        <IconButton
          icon={copiedBlock() === `answer-${turnId()}` ? "check" : "copy"}
          size="sm"
          accessibilityLabel={`copy-answer-${turnId()}`}
          tooltip={tr("chat.copyAnswer")}
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={() => {
            const text = turnAnswerText(props.turn);
            if (!text) return;
            const id = turnId();
            void Clipboard.writeText(text).then(() => {
              copiedBlock.set(`answer-${id}`);
              if (copyTimer) clearTimeout(copyTimer);
              copyTimer = setTimeout(() => {
                copyTimer = null;
                if (copiedBlock() === `answer-${id}`) copiedBlock.set("");
              }, 1500);
            });
          }}
        />
      </If>
      <If when={turnId() && !runningTurnId() ? turnId() : ""}>
        {id => (
          <IconButton
            icon="git-branch"
            size="sm"
            accessibilityLabel={`fork-turn-${id()}`}
            tooltip={tr("chat.forkFromHere")}
            style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={() => void forkActiveSession(id())}
          />
        )}
      </If>
      <If when={meta()}>
        {text => (
          <Text style={{ ...textStyle("caption", { tabular: true }), marginLeft: space.chip }}>{text()}</Text>
        )}
      </If>
    </View>
  );
}

function failureDetailLines(failure: TurnFailure): string[] {
  const detail = failure.detail;
  if (!detail) return [];
  const lines: string[] = [];
  const read = (keys: string[]) => {
    for (const key of keys) {
      const value = detail[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  };
  const provider = read(["provider", "providerId", "provider_id"]);
  const code = read(["code", "errorCode", "error_code", "statusCode", "status_code", "httpStatus"]);
  const requestId = read(["requestId", "request_id"]);
  if (provider) lines.push(tr("chat.failureProvider", { value: provider }));
  if (code) lines.push(tr("chat.failureCode", { value: code }));
  if (requestId) lines.push(tr("chat.failureRequest", { value: requestId }));
  return lines;
}

/** The recovery the host offers for an interrupted turn, when it recorded one. */
function interruptedRecoveryOf(turn: unknown): { generation: number } | null {
  if (!turn || typeof turn !== "object") return null;
  const recovery = (turn as Record<string, unknown>).recovery;
  if (!recovery || typeof recovery !== "object") return null;
  const record = recovery as Record<string, unknown>;
  if (record.status !== "interrupted") return null;
  const generation = record.executionGeneration ?? record.execution_generation;
  return typeof generation === "number" ? { generation } : null;
}

const resumingTurn = signal("");

async function resumeInterruptedTurn(turn: unknown): Promise<void> {
  const sessionId = activeSessionId();
  const turnId = turnKeyOf(turn);
  const recovery = interruptedRecoveryOf(turn);
  if (!sessionId || !turnId || !recovery || resumingTurn()) return;
  resumingTurn.set(turnId);
  try {
    await recoverInterruptedDialogTurn({
      sessionId,
      dialogTurnId: turnId,
      executionGeneration: recovery.generation,
      ...(activeWorkspaceId() ? { workspaceId: activeWorkspaceId()! } : {}),
      ...(activeWorkspace()?.rootPath ? { workspacePath: activeWorkspace()!.rootPath } : {}),
    });
    jumpToTranscriptEnd();
  } catch (error) {
    turnError.set(error instanceof Error ? error.message : String(error));
  } finally {
    resumingTurn.set("");
  }
}

/** Why a settled turn stopped, inside that turn, with a retry that re-sends its prompt. */
/**
 * A failed turn (spec §3 Error): no box, a 2 px `danger` rail, "The turn
 * stopped: {reason}" and a ghost "Try again" below. A stopped turn is a quiet
 * notice: `info` 14 and 13 `textMuted`, no rail.
 */
function TurnFailureNotice(props: { turn: unknown; failure: TurnFailure; pane?: 0 | 1 }) {
  const isSecondary = props.pane === 1;
  const cancelled = computed(() => props.failure.status === "cancelled" || props.failure.status === "interrupted");
  const prompt = computed(() => userPartsOf(props.turn)[0]?.text ?? "");
  const promptImages = computed(() => userImagesOf(props.turn));
  const reason = computed(() => (props.failure.message ? localizeHostError(props.failure.message) : ""));
  const isBusy = () => Boolean(isSecondary ? secondaryRunningTurnId() : runningTurnId());
  const raw = computed(() => {
    try {
      return JSON.stringify({ error: props.failure.message, detail: props.failure.detail ?? null }, null, 2);
    } catch {
      return props.failure.message;
    }
  });
  return (
    <View
      style={{
        gap: space.sm,
        paddingLeft: cancelled() ? 0 : space.md,
        borderLeftWidth: cancelled() ? 0 : 2,
        borderColor: palette().danger,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ height: textLineHeight(14, 20 / 14), justifyContent: "center" }}>
          <TranscriptRowIconSlot>
            <Icon name={cancelled() ? "info" : "close"} size={14} color={cancelled() ? palette().textMuted : palette().danger} />
          </TranscriptRowIconSlot>
        </View>
        <Text
          style={{
            ...textStyle(cancelled() ? "label" : "body", { color: cancelled() ? palette().textMuted : palette().text }),
            fontWeight: "400",
            flex: 1,
            minWidth: 0,
            userSelect: "text",
          }}
        >
          {cancelled()
            ? tr("chat.turnInterrupted")
            : reason()
              ? tr("session.turnStopped", { reason: reason() })
              : tr("chat.turnFailed")}
        </Text>
        <If when={!cancelled() && props.failure.message ? "copy" : ""}>
          <CopyChip partKey={`failure-${isSecondary ? "sec-" : ""}${turnKeyOf(props.turn)}`} text={raw()} />
        </If>
      </View>
      <If when={!cancelled() ? failureDetailLines(props.failure).join(" · ") : ""}>
        {line => <Text style={{ ...textStyle("mono", { color: palette().textMuted }), userSelect: "text" }}>{line()}</Text>}
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <If when={!isSecondary && interruptedRecoveryOf(props.turn) && !isBusy() ? "resume" : ""}>
          <Button
            label={tr("chat.resume")}
            variant="ghost"
            size="sm"
            loading={resumingTurn() === turnKeyOf(props.turn)}
            accessibilityLabel={`resume-turn-${turnKeyOf(props.turn)}`}
            onPress={() => void resumeInterruptedTurn(props.turn)}
          />
        </If>
        <If when={(prompt() || promptImages().length > 0) && !isBusy()}>
          <Button
            label={tr("common.tryAgain")}
            variant="ghost"
            size="sm"
            accessibilityLabel={`${isSecondary ? "secondary-" : ""}retry-turn-${turnKeyOf(props.turn)}`}
            onPress={() => {
              if (isSecondary) {
                focusPane(1);
                void sendSecondaryTurn(prompt());
                return;
              }
              jumpToTranscriptEnd();
              const preserved = userImagesToAttachments(promptImages());
              void sendTurn(prompt(), undefined, preserved.length > 0 ? { attachments: preserved } : undefined);
            }}
          />
        </If>
      </View>
    </View>
  );
}

const followLatest = signal(true);
let transcriptListRef: ListRef | undefined;
let transcriptScrollRafId: number | null = null;
let peakFollowScrollY = 0;
let lastObservedScrollY = 0;
let lastEventContentHeight = 0;
let lastEventViewportHeight = 0;

function cancelScheduledTranscriptScroll(): void {
  if (transcriptScrollRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(transcriptScrollRafId);
  }
  transcriptScrollRafId = null;
}

function resetTranscriptScrollTracking(): void {
  cancelScheduledTranscriptScroll();
  peakFollowScrollY = 0;
  lastObservedScrollY = 0;
  lastEventContentHeight = 0;
  lastEventViewportHeight = 0;
  suppressAutoFollowUntil = 0;
  hoveredPrimaryTurnKey.set("");
  activeRailTurnKey.set("");
  followLatest.set(true);
}

function atTranscriptEnd(event: ScrollEvent): boolean {
  const max = Math.max(0, event.contentSize.height - event.size.height);
  return event.offset.y >= max - 24;
}

/**
 * Scrolls to the bottom at most once per animation frame so high-frequency
 * token streaming never forces synchronous layout reflow on every chunk.
 */
function stickToTranscriptEnd(): void {
  if (!followLatest()) return;
  if (typeof requestAnimationFrame === "function") {
    if (transcriptScrollRafId !== null) return;
    transcriptScrollRafId = requestAnimationFrame(() => {
      transcriptScrollRafId = null;
      if (!followLatest()) return;
      transcriptListRef?.scrollToEnd({ animated: false });
    });
    return;
  }
  transcriptListRef?.scrollToEnd({ animated: false });
}

function jumpToTranscriptEnd(): void {
  suppressAutoFollowUntil = 0;
  followLatest.set(true);
  peakFollowScrollY = lastObservedScrollY;
  cancelScheduledTranscriptScroll();
  transcriptListRef?.scrollToEnd({ animated: false });
  stickToTranscriptEnd();
  syncActiveRailForLatest();
}

function handleTranscriptScroll(event: ScrollEvent): void {
  const y = event.offset.y;
  const contentHeight = event.contentSize.height;
  const viewportHeight = event.size.height;
  const viewportGrow =
    lastEventViewportHeight > 0 ? Math.max(0, viewportHeight - lastEventViewportHeight) : 0;
  const contentShrink =
    lastEventContentHeight > 0 ? Math.max(0, lastEventContentHeight - contentHeight) : 0;

  lastObservedScrollY = y;
  lastEventContentHeight = contentHeight;
  lastEventViewportHeight = viewportHeight;
  transcriptScrolled.set(y > 4);

  if (atTranscriptEnd(event)) {
    if (!followLatest() && Date.now() >= suppressAutoFollowUntil) {
      followLatest.set(true);
    }
    if (followLatest()) {
      peakFollowScrollY = y;
    }
    syncActiveRailForLatest();
    return;
  }

  if (followLatest()) {
    // Adjust the high-water mark for scroll clamping when the viewport grows
    // (e.g. composer shrinks on submit) or content shrinks (e.g. thinking collapses),
    // so layout clamping is never mistaken for a manual upward scroll.
    if (viewportGrow > 0 || contentShrink > 0) {
      peakFollowScrollY = Math.max(0, peakFollowScrollY - viewportGrow - contentShrink);
    }
    if (y < peakFollowScrollY - 4) {
      followLatest.set(false);
      cancelScheduledTranscriptScroll();
    } else if (y > peakFollowScrollY) {
      peakFollowScrollY = y;
    }
  }
}

function WelcomeStudio() {
  const heroMotion = subtleCrossfadeMotion();
  return (
    <View
      style={{
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: space.x3l,
        alignItems: "center",
        width: "100%",
        maxWidth: 520,
        alignSelf: "center",
      }}
    >
      <View style={[{ alignItems: "center", gap: space.lg }, heroMotion.style]}>
        <OpenBitFunLogoMark size={64} color={palette().text} />
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(22),
            lineHeight: textLineHeight(22, 1.28),
            fontWeight: "600",
            letterSpacing: textTracking(22),
            textAlign: "center",
          }}
        >
          {tr("sessions.welcomeTitle")}
        </Text>
      </View>
    </View>
  );
}

/** Subtle elevated floating scroll-to-bottom control (Codex / Claude Desktop aesthetic). */
function LatestPill(props?: { onPress?: () => void; accessibilityLabel?: string }) {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  return (
    <View
      role="button"
      accessibilityLabel={props?.accessibilityLabel ?? "Latest"}
      onPress={props?.onPress ?? jumpToTranscriptEnd}
      style={[
        {
          position: "absolute",
          bottom: space.md,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
          gap: space.xs,
          paddingHorizontal: space.md,
          paddingVertical: space.chip,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: palette().borderStrong,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(12px)",
          boxShadow: palette().shadowOverlay,
          transformOrigin: "bottom center",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        },
        motion.style,
      ]}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.97)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon name="arrow-down" size={12} color={palette().text} />
      <Text
        style={{
          ...textStyle("caption", { color: palette().text }),
          fontWeight: "500",
        }}
      >
        {tr("sessions.latest")}
      </Text>
    </View>
  );
}

const isTranscriptEmpty = computed(
  () =>
    sessionTurns().length === 0 &&
    !turnsLoading() &&
    !transcriptNotice() &&
    !pendingTurn() &&
    !pendingTurnState() &&
    !runningTurnId() &&
    !hasLiveContent(),
);

/**
 * The user's line of the turn that is running: the optimistic text this surface
 * sent, else what the host reported when the turn started (a turn restored after
 * switching back to its session, or one another surface started).
 */
const optimisticUserText = computed(() => {
  const pending = pendingTurnState();
  const openKey = activeSessionKey();
  const pendingMatches = pending && (!pending.sessionKey || !openKey || pending.sessionKey === openKey);
  const text = pendingMatches ? pending.userText || pendingTurn() : pendingTurn();
  if (text) return text;
  const live = liveTurn();
  return live?.turnId && live.sessionId === activeSessionId() && (live.deviceId ?? "") === activeSessionDevice()
    ? live.userText
    : "";
});

/** The images attached to the in-flight pending turn so the live UserBubble shows them immediately. */
const pendingTurnImages = computed<UserImage[]>(() => {
  const pending = pendingTurnState();
  const openKey = activeSessionKey();
  const pendingMatches = pending && (!pending.sessionKey || !openKey || pending.sessionKey === openKey);
  if (!pendingMatches || !pending.images?.length) return [];
  return pending.images.map((img, idx) => ({
    id: img.id || `pending-img-${idx}`,
    name: img.name,
    ...(img.dataUrl ? { dataUrl: img.dataUrl } : {}),
    ...(img.imagePath ? { imagePath: img.imagePath } : {}),
  }));
});

const primaryAwaitingResponse = computed<boolean>(() => {
  if (turnError()) return false;
  if (activePermissions().length > 0 || activeQuestions().length > 0) return false;
  const live = liveTurn();
  if (live?.settling) return false;
  const hasPending = Boolean(optimisticUserText() || pendingTurnImages().length > 0);
  const hasRunning = Boolean(runningTurnId());
  if (!hasPending && !hasRunning) return false;
  if (liveFallbackItems().length > 0) return false;
  return !liveBlocksHaveActiveMotion(liveDisplayBlocks(), liveRounds(), 0);
});

const primaryWaitingStartedAt = computed<number | undefined>(() => {
  const sid = activeSessionId();
  return pendingTurnState()?.createdAt ?? (sid ? turnStartedAt(sid) : undefined);
});


/**
 * The host answers every reload (a turn settling, "Load earlier") with fresh
 * objects for every turn. A settled turn whose record did not change keeps the
 * row the transcript already drew, so its `turn()` never changes and nothing
 * under it is evaluated again; only new or changed turns re-render, and turns
 * prepended by "Load earlier" never shift the rows below them.
 *
 * Uses an O(items) structural fingerprint instead of `JSON.stringify(turn)` so
 * long sessions never serialize or duplicate the full transcript into memory.
 */
interface TurnRow {
  key: string;
  turn: unknown;
}

let turnRowCache = new Map<string, { row: TurnRow; signature: string }>();
let turnRowSession: string | null = null;

function turnSignature(turn: unknown): string {
  if (!turn || typeof turn !== "object") return String(turn ?? "");
  const view = turn as Partial<TranscriptTurnView> & { publishedFigures?: unknown[]; published_figures?: unknown[] };
  const userText = view.user?.text ?? "";
  const userImages = Array.isArray(view.user?.images) ? view.user.images.length : 0;
  const items = Array.isArray(view.items) ? view.items : [];
  const figures = Array.isArray(view.publishedFigures)
    ? view.publishedFigures.length
    : Array.isArray(view.published_figures)
      ? view.published_figures.length
      : 0;
  const parts: string[] = [
    String(view.turnId ?? ""),
    String(view.turnIndex ?? ""),
    String(view.status ?? ""),
    view.settled ? "1" : "0",
    String(view.assistantTimestampMs ?? ""),
    String(view.durationMs ?? ""),
    String(view.effectiveModel ?? ""),
    String(view.error ?? ""),
    `${userText.length}:${userText.slice(0, 24)}:${userText.slice(-16)}:${userImages}`,
    String(view.tokenUsage?.totalTokens ?? ""),
    `${view.recovery?.status ?? ""}:${view.recovery?.executionGeneration ?? ""}`,
    String(figures),
    String(items.length),
  ];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === "text" || item.kind === "thinking") {
      const len = item.text.length;
      parts.push(`${item.kind[0]}:${item.id ?? i}:${len}:${item.text.slice(-16)}`);
    } else if (item.kind === "tool") {
      const tool = item.tool;
      const resultTag =
        tool.result === undefined || tool.result === null
          ? "0"
          : typeof tool.result === "string"
            ? `s${tool.result.length}`
            : "o";
      parts.push(
        `T:${tool.id ?? i}:${tool.name}:${tool.status ?? ""}:${tool.success ?? ""}:${tool.durationMs ?? ""}:${tool.error?.length ?? 0}:${tool.subagentItems?.length ?? 0}:${resultTag}`,
      );
    }
  }
  return parts.join("|");
}

const stableTurnRows = computed<TurnRow[]>(() => {
  const turns = sessionTurns();
  const sessionKeyId = activeSessionKey() ?? activeSessionId();
  if (sessionKeyId !== turnRowSession) {
    turnRowSession = sessionKeyId;
    turnRowCache = new Map();
  }
  const next = new Map<string, { row: TurnRow; signature: string }>();
  const rows = turns.map((turn, index) => {
    const id = turnKeyOf(turn);
    // A host that repeats an id (or sends none) gets a positional key, so the
    // keyed list never sees two rows under one key.
    // Keys carry the device-scoped session key, so switching sessions disposes
    // the previous transcript's rows instead of reusing them.
    const key =
      id && !next.has(`${sessionKeyId}|turn:${id}`)
        ? `${sessionKeyId}|turn:${id}`
        : `${sessionKeyId}|index:${index}`;
    const previous = turnRowCache.get(key);
    if (previous && previous.row.turn === turn) {
      next.set(key, previous);
      return previous.row;
    }
    const signature = turnSignature(turn);
    const row = previous && previous.signature === signature ? previous.row : { key, turn };
    next.set(key, { row, signature });
    return row;
  });
  turnRowCache = next;
  return rows;
});

/**
 * Persisted turns, minus the one still streaming: a host that persists a turn
 * while it runs would otherwise draw it twice (its partial record and the live
 * stream) until it settles.
 */
/** Only which turn is live matters to the persisted rows, not each event it receives. */
const liveTurnId = computed<string | null>(() => liveTurn()?.turnId ?? null);

const visibleTurnRows = computed<TurnRow[]>(() => {
  const rows = stableTurnRows();
  const liveId = liveTurnId();
  if (!liveId) return rows;
  return rows.filter(row => turnKeyOf(row.turn) !== liveId);
});

/** The persisted turns the transcript draws, in order. */
const visibleTurns = computed(() => visibleTurnRows().map(row => row.turn));

const loadingEarlier = signal(false);

/**
 * Widens the history window while NSH `<List maintainVisibleContentPosition>`
 * natively keeps the visible rows anchored in place above the reader's viewport.
 */
async function showEarlierTurns(): Promise<void> {
  if (loadingEarlier() || !hasEarlierTurns()) return;
  loadingEarlier.set(true);
  followLatest.set(false);
  try {
    await loadEarlierTurns();
  } finally {
    loadingEarlier.set(false);
  }
}

function turnFileChangesOf(turn: unknown) {
  if (!turn || typeof turn !== "object") return [];
  const changes = (turn as { fileChanges?: TranscriptTurnView["fileChanges"] }).fileChanges;
  return Array.isArray(changes) ? changes : [];
}

function openTurnChangesReview(
  turnId: string,
  changes: NonNullable<TranscriptTurnView["fileChanges"]>,
  initialFilePath?: string,
  target?: { sessionId?: string; workspaceId?: string; workspacePath?: string },
): void {
  const sessionId = target?.sessionId ?? activeSessionId();
  if (!sessionId || changes.length === 0) return;
  turnChangesReview.set({
    sessionId,
    turnId,
    workspaceId: target?.workspaceId ?? (activeWorkspaceId() ?? undefined),
    workspacePath: target?.workspacePath ?? (activeWorkspaceRoot() || undefined),
    changes,
    selectedPath: initialFilePath || changes[0]!.filePath,
  });
}

/**
 * Flat virtualized row rendered inside NSH `<List>`. Flattening each turn's
 * user bubble, individual assistant items (text / thinking / tool / explore),
 * the steps of every open folded group, figures, failure notice, file changes,
 * and footer into independent list cells guarantees that even a single
 * 1,200-tool agent turn only ever mounts the ~30–60 cells near the viewport
 * instead of thousands of native NSViews at once. An open group drawn as one
 * cell would defeat that: jumping into it built every step before anything
 * painted.
 */
type TranscriptBlockRow =
  | {
      kind: "user";
      key: string;
      turnKey: string;
      turnId: string;
      partKey: string;
      text: string;
      timestamp?: number;
      images: UserImage[];
      showRerunSlot: boolean;
      topGap: number;
    }
  | {
      kind: "item";
      key: string;
      turnKey: string;
      turnId: string;
      item: TranscriptItem;
      preserveFullReply: boolean;
      topGap: number;
    }
  | {
      kind: "groupStep";
      key: string;
      turnKey: string;
      turnId: string;
      groupCardId: string;
      entry: FoldedProcessItem;
      index: number;
      first: boolean;
      topGap: number;
    }
  | {
      kind: "figures";
      key: string;
      turnKey: string;
      turnId: string;
      figures: InlineFigureDirective[];
      topGap: number;
    }
  | {
      kind: "failure";
      key: string;
      turnKey: string;
      turnId: string;
      turn: unknown;
      failure: TurnFailure;
      topGap: number;
    }
  | {
      kind: "fileChanges";
      key: string;
      turnKey: string;
      turnId: string;
      changes: NonNullable<TranscriptTurnView["fileChanges"]>;
      topGap: number;
    }
  | {
      kind: "footer";
      key: string;
      turnKey: string;
      turnId: string;
      turn: unknown;
      topGap: number;
    };

interface TranscriptBlockProjection {
  rows: TranscriptBlockRow[];
  firstIndexByTurnKey: Map<string, number>;
  firstIndexByTurnId: Map<string, number>;
  /** The mean height the rows are likely to have, for the rows the list has not measured yet. */
  estimatedRowHeight: number;
}

/**
 * Gap above every row but the first. The list's own `gap` stays 0 so the steps
 * of an open group can sit closer together, as they do inside the group card.
 */
const TRANSCRIPT_ROW_GAP = 8;

type CachedTurnBlocks = { turnKey: string; openGroups: string; blocks: TranscriptBlockRow[] };
const cachedPrimaryTurnBlocks = new WeakMap<object, CachedTurnBlocks>();
const cachedSecondaryTurnBlocks = new WeakMap<object, CachedTurnBlocks>();

/** Likely height of a row the list has not measured yet, by what it draws. */
function estimatedRowHeightOf(row: TranscriptBlockRow): number {
  switch (row.kind) {
    case "user":
      return 72 + Math.min(6, Math.floor(row.text.length / 90)) * 22;
    case "item":
      if (row.item.kind === "text") return 48 + Math.min(18, Math.floor(row.item.text.length / 110)) * 22;
      return controlHeight.sm;
    case "groupStep":
      return controlHeight.sm + space.hair;
    case "figures":
      return 220;
    case "failure":
    case "fileChanges":
      return 88;
    default:
      return controlHeight.sm;
  }
}

function blocksForSingleTurn(turnRow: TurnRow, isSecondary: boolean): TranscriptBlockRow[] {
  const turn = turnRow.turn;
  const cache = isSecondary ? cachedSecondaryTurnBlocks : cachedPrimaryTurnBlocks;
  const items = turnItems(turn);
  // Reading each group's open state here makes the projection follow it: an
  // open group contributes one row per step, so the list virtualizes them.
  const openGroups = items
    .filter(item => item.kind === "explore" && isCardExpanded(item.key))
    .map(item => item.key)
    .join("\n");
  if (turn && typeof turn === "object") {
    const hit = cache.get(turn);
    if (hit && hit.turnKey === turnRow.key && hit.openGroups === openGroups) return hit.blocks;
  }

  const turnKey = turnRow.key;
  const turnId = turnKeyOf(turn);
  const blocks: TranscriptBlockRow[] = [];
  const userParts = userPartsOf(turn);
  const images = userImagesOf(turn);
  const timestamp = turnTimestampOf(turn);
  const prefix = isSecondary ? "sec-" : "";

  userParts.forEach((part, index) => {
    blocks.push({
      kind: "user",
      key: `${turnKey}|u:${index}`,
      turnKey,
      turnId,
      partKey: `${prefix}${turnPartKey(turn, part)}`,
      text: part.text,
      timestamp,
      images,
      showRerunSlot: !isSecondary && index === userParts.length - 1,
      topGap: 0,
    });
  });

  const preserveFullReply = !isSecondary && liveStreamedTurnIds.has(turnId);
  const seenItemKeys = new Set<string>();
  items.forEach((item, index) => {
    const rawKey = `${turnKey}|${item.key}`;
    const key = seenItemKeys.has(rawKey) ? `${rawKey}#${index}` : rawKey;
    seenItemKeys.add(key);
    blocks.push({
      kind: "item",
      key,
      turnKey,
      turnId,
      item,
      preserveFullReply,
      topGap: TRANSCRIPT_ROW_GAP + (index === 0 && userParts.length > 0 ? space.xs : 0),
    });
    if (item.kind === "explore" && isCardExpanded(item.key)) {
      item.items.forEach((entry, stepIndex) => {
        blocks.push({
          kind: "groupStep",
          key: `${key}|step:${entry.key || stepIndex}`,
          turnKey,
          turnId,
          groupCardId: item.key,
          entry,
          index: stepIndex,
          first: stepIndex === 0,
          // The card's own header-to-steps gap; the gap between steps is drawn inside the rail.
          topGap: stepIndex === 0 ? space.xs : 0,
        });
      });
    }
  });

  const figures = publishedFiguresOf(turn);
  if (figures.length > 0) {
    blocks.push({
      kind: "figures",
      key: `${turnKey}|figures`,
      turnKey,
      turnId,
      figures,
      topGap: TRANSCRIPT_ROW_GAP,
    });
  }

  const failure = turnFailureOf(turn);
  if (failure) {
    blocks.push({
      kind: "failure",
      key: `${turnKey}|failure`,
      turnKey,
      turnId,
      turn,
      failure,
      topGap: TRANSCRIPT_ROW_GAP + space.xs,
    });
  }

  const fileChanges = turnFileChangesOf(turn);
  if (fileChanges.length > 0) {
    blocks.push({
      kind: "fileChanges",
      key: `${turnKey}|fileChanges`,
      turnKey,
      turnId,
      changes: fileChanges,
      topGap: TRANSCRIPT_ROW_GAP + space.xs,
    });
  }

  if (items.length > 0) {
    blocks.push({
      kind: "footer",
      key: `${turnKey}|footer`,
      turnKey,
      turnId,
      turn,
      topGap: TRANSCRIPT_ROW_GAP,
    });
  }

  if (turn && typeof turn === "object") {
    cache.set(turn, { turnKey, openGroups, blocks });
  }
  return blocks;
}

/**
 * A turn's first row with the space between turns. Kept per block, so every
 * projection hands the list the same object and the list does not take an
 * unchanged turn for a changed one.
 */
const turnOpeningRows = new WeakMap<TranscriptBlockRow, TranscriptBlockRow>();

function turnOpeningRow(block: TranscriptBlockRow, topGap: number): TranscriptBlockRow {
  const held = turnOpeningRows.get(block);
  if (held && held.topGap === topGap) return held;
  const row = { ...block, topGap };
  turnOpeningRows.set(block, row);
  return row;
}

function buildTranscriptBlockProjection(
  turnRows: ReadonlyArray<TurnRow>,
  isSecondary: boolean,
): TranscriptBlockProjection {
  const rows: TranscriptBlockRow[] = [];
  const firstIndexByTurnKey = new Map<string, number>();
  const firstIndexByTurnId = new Map<string, number>();
  let estimatedTotal = 0;
  for (let t = 0; t < turnRows.length; t += 1) {
    const turnRow = turnRows[t]!;
    const turnBlocks = blocksForSingleTurn(turnRow, isSecondary);
    if (turnBlocks.length === 0) continue;
    const startIdx = rows.length;
    firstIndexByTurnKey.set(turnRow.key, startIdx);
    const tid = turnBlocks[0]!.turnId;
    if (tid && !firstIndexByTurnId.has(tid)) {
      firstIndexByTurnId.set(tid, startIdx);
    }
    // A turn opens with the row gap plus the space between turns; the very first row has none.
    const turnGap = rows.length > 0 ? TRANSCRIPT_ROW_GAP + space.sm : 0;
    for (let i = 0; i < turnBlocks.length; i += 1) {
      const block = turnBlocks[i]!;
      const row = i === 0 && turnGap !== block.topGap ? turnOpeningRow(block, turnGap) : block;
      rows.push(row);
      estimatedTotal += estimatedRowHeightOf(row) + row.topGap;
    }
  }
  // Rounded so a turn more or less does not keep changing the list's estimate.
  const estimatedRowHeight =
    rows.length > 0 ? Math.max(controlHeight.sm, Math.round(estimatedTotal / rows.length / 4) * 4) : 44;
  return { rows, firstIndexByTurnKey, firstIndexByTurnId, estimatedRowHeight };
}

const primaryTranscriptBlocks = computed<TranscriptBlockProjection>(() =>
  buildTranscriptBlockProjection(visibleTurnRows(), false),
);

/**
 * One recycled virtualized cell inside `<List>`. Every branch reads `props.row()`
 * reactively and keeps per-item state external, so cell recycling across turns
 * and item kinds never leaks stale UI state.
 */
function TranscriptBlockCell(props: { row: () => TranscriptBlockRow; pane?: 0 | 1 }) {
  const isSecondary = props.pane === 1;
  const hoveredSignal = isSecondary ? hoveredSecondaryTurnKey : hoveredPrimaryTurnKey;
  const turnKey = () => props.row().turnKey;
  const turnId = () => props.row().turnId;
  const kind = () => props.row().kind;
  const matches = computed(() => !isSecondary && Boolean(turnId()) && matchingSearchTurnIds().has(turnId()));

  return (
    <View style={{ width: "100%", alignItems: "center" }}>
      <View
        onMouseEnter={() => hoveredSignal.set(turnKey())}
        onMouseLeave={() => {
          if (hoveredSignal() === turnKey()) hoveredSignal.set("");
        }}
        style={{
          width: "100%",
          maxWidth: contentWidth(),
          paddingTop: props.row().topGap,
          paddingHorizontal: matches() ? space.sm : 0,
          borderRadius: matches() ? radii.md : 0,
          borderLeftWidth: matches() ? 2 : 0,
          borderColor: activeSearchTurnKey() === turnId() ? palette().accent : palette().accentBorder,
          backgroundColor: matches() ? palette().accentSoft : "transparent",
        }}
      >
        <If when={kind() === "user"}>
          <View style={{ gap: space.md }}>
            <UserBubble
              partKey={(props.row() as Extract<TranscriptBlockRow, { kind: "user" }>).partKey}
              text={(props.row() as Extract<TranscriptBlockRow, { kind: "user" }>).text}
              timestamp={(props.row() as Extract<TranscriptBlockRow, { kind: "user" }>).timestamp}
              turnId={turnId()}
              images={(props.row() as Extract<TranscriptBlockRow, { kind: "user" }>).images}
            />
            <If
              when={
                !isSecondary &&
                (props.row() as Extract<TranscriptBlockRow, { kind: "user" }>).showRerunSlot &&
                Boolean(rerunTarget() && rerunTarget()!.turnId === turnId())
              }
            >
              <RerunEditor />
            </If>
          </View>
        </If>

        <If when={kind() === "item"}>
          <TranscriptItemView
            item={(props.row() as Extract<TranscriptBlockRow, { kind: "item" }>).item}
            preserveFullReply={
              !isSecondary &&
              ((props.row() as Extract<TranscriptBlockRow, { kind: "item" }>).preserveFullReply ||
                liveStreamedTurnIds.has(turnId()))
            }
            pane={props.pane}
            stepsAsRows={true}
          />
        </If>

        <If when={kind() === "groupStep"}>
          <FoldedGroupStep
            entry={(props.row() as Extract<TranscriptBlockRow, { kind: "groupStep" }>).entry}
            groupCardId={(props.row() as Extract<TranscriptBlockRow, { kind: "groupStep" }>).groupCardId}
            index={(props.row() as Extract<TranscriptBlockRow, { kind: "groupStep" }>).index}
            first={(props.row() as Extract<TranscriptBlockRow, { kind: "groupStep" }>).first}
            stateOf={persistedToolState}
            renderThinking={entry => renderFoldedThinking(entry, props.pane ?? 0)}
          />
        </If>

        <If when={kind() === "figures"}>
          <View style={{ gap: space.xs }}>
            <Each
              of={(props.row() as Extract<TranscriptBlockRow, { kind: "figures" }>).figures}
              key={fig => fig.path}
            >
              {fig => <InlineFigureCard figure={fig()} />}
            </Each>
          </View>
        </If>

        <If when={kind() === "failure"}>
          <TurnFailureNotice
            turn={(props.row() as Extract<TranscriptBlockRow, { kind: "failure" }>).turn}
            failure={(props.row() as Extract<TranscriptBlockRow, { kind: "failure" }>).failure}
            pane={props.pane}
          />
        </If>

        <If when={kind() === "fileChanges"}>
          <TurnFileChangesCard
            turnId={turnId()}
            changes={(props.row() as Extract<TranscriptBlockRow, { kind: "fileChanges" }>).changes}
            onReview={filePath =>
              openTurnChangesReview(
                turnId(),
                (props.row() as Extract<TranscriptBlockRow, { kind: "fileChanges" }>).changes,
                filePath,
                isSecondary
                  ? {
                      sessionId: secondarySessionId() ?? undefined,
                      workspaceId: secondaryWorkspaceId() ?? undefined,
                      workspacePath: secondaryWorkspaceRoot() || undefined,
                    }
                  : undefined,
              )
            }
          />
        </If>

        <If when={kind() === "footer"}>
          <TurnFooter
            turn={(props.row() as Extract<TranscriptBlockRow, { kind: "footer" }>).turn}
            visible={hoveredSignal() === turnKey() || compactLayout()}
          />
        </If>
      </View>
    </View>
  );
}

interface TurnJumpPreviewData {
  prompt: string;
  reply: string;
  timestamp?: number;
}

function collapsedExcerpt(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function turnPromptExcerpt(turn: unknown): string {
  const combined = userPartsOf(turn)
    .map(part => part.text.trim())
    .filter(Boolean)
    .join(" ");
  return collapsedExcerpt(combined, 140);
}

function turnReplyExcerpt(turn: unknown): string {
  const combined = responsePartsOf(turn)
    .map(part => part.text.trim())
    .filter(Boolean)
    .join(" ");
  return collapsedExcerpt(combined, 220);
}

function turnJumpPreview(
  rows: ReadonlyArray<{ key: string; turn: unknown }>,
  key: string,
): TurnJumpPreviewData | null {
  const row = rows.find(item => item.key === key);
  if (!row) return null;
  return {
    prompt: turnPromptExcerpt(row.turn),
    reply: turnReplyExcerpt(row.turn),
    timestamp: turnTimestampOf(row.turn),
  };
}

/**
 * Subtle left-edge turn minimap shared by Primary, Secondary Split, and BTW panes:
 * thin horizontal hairlines (one per turn) that thicken on hover with an anchored
 * preview card, and scroll directly to that turn on click.
 */
function TurnJumpRail(props: {
  rows: () => ReadonlyArray<{ key: string }>;
  previewOf: (key: string) => TurnJumpPreviewData | null;
  activeKey: () => string;
  onJump: (key: string) => void;
  accessibilityLabel?: string;
  tickPrefix?: string;
}) {
  const localHoveredKey = signal("");
  const localHoveredAnchor = signal<ViewRef | null>(null);
  const visible = computed(() => !compactLayout() && props.rows().length >= 2);
  const dense = computed(() => props.rows().length > 24);
  const resolvedActiveKey = computed(() => {
    const current = props.activeKey();
    const list = props.rows();
    if (current && list.some(row => row.key === current)) return current;
    return list[list.length - 1]?.key ?? "";
  });
  const hoveredEntry = computed(() => {
    const key = localHoveredKey();
    if (!key) return null;
    const list = props.rows();
    const index = list.findIndex(row => row.key === key);
    if (index < 0) return null;
    const preview = props.previewOf(key);
    if (!preview) return null;
    return { key, ...preview, index, total: list.length };
  });

  const tickPrefix = props.tickPrefix ?? "turn-jump-";

  const renderTicks = () => (
    <View style={{ alignItems: "flex-start" }}>
      <Each of={props.rows()} key={row => row.key}>
        {(row, index) => {
          let tickRef: ViewRef | null = null;
          const key = () => row().key;
          const isHovered = () => localHoveredKey() === key();
          const isActive = () => resolvedActiveKey() === key();
          return (
            <View
              ref={el => {
                tickRef = el;
              }}
              role="button"
              accessibilityLabel={`${tickPrefix}${index() + 1}`}
              accessibilityState={{ selected: isActive() }}
              onMouseEnter={() => {
                localHoveredKey.set(key());
                localHoveredAnchor.set(tickRef);
              }}
              onMouseLeave={() => {
                if (localHoveredKey() === key()) {
                  localHoveredKey.set("");
                  localHoveredAnchor.set(null);
                }
              }}
              onPress={() => props.onJump(key())}
              style={{
                width: 24,
                height: dense() ? 8 : 12,
                justifyContent: "center",
                alignItems: "flex-start",
                cursor: "pointer",
                userSelect: "none",
              }}
              focusVisibleStyle={focusRingStyle(-1)}
            >
              <View
                style={{
                  width: 9,
                  height: 2,
                  borderRadius: radii.pill,
                  transformOrigin: "left center",
                  pointerEvents: "none",
                  backgroundColor: isHovered() || isActive() ? palette().text : palette().borderStrong,
                  opacity: isHovered() ? 1 : isActive() ? 0.9 : 0.55,
                  transform: isHovered()
                    ? [{ scaleX: 2.0 }, { scaleY: 1.75 }]
                    : isActive()
                      ? [{ scaleX: 1.45 }, { scaleY: 1.25 }]
                      : [{ scaleX: 1 }, { scaleY: 1 }],
                  ...pressTransition(MOTION_DURATION.fast),
                }}
              />
            </View>
          );
        }}
      </Each>
    </View>
  );

  return (
    <If when={visible()}>
      <View
        accessibilityLabel={props.accessibilityLabel ?? "turn-jump-rail"}
        style={{
          position: "absolute",
          left: 8,
          top: space.xl,
          bottom: space.xl,
          justifyContent: "center",
          pointerEvents: "box-none",
        }}
      >
        <View
          style={{
            paddingVertical: space.xs,
            paddingRight: space.xs,
            pointerEvents: "auto",
          }}
        >
          <If when={props.rows().length > 32} else={renderTicks()}>
            <Scroll smoothWheel style={{ maxHeight: 360 }} scrollbar={false}>
              {renderTicks()}
            </Scroll>
          </If>
        </View>

        <If when={Boolean(hoveredEntry() && localHoveredAnchor())}>
          <Overlay
            anchor={localHoveredAnchor()}
            placement="right"
            align="center"
            offset={10}
            margin={12}
          >
            <TurnJumpPreview entry={hoveredEntry} />
          </Overlay>
        </If>
      </View>
    </If>
  );
}

function TurnJumpPreview(props: {
  entry: () => (TurnJumpPreviewData & { key: string; index: number; total: number }) | null;
}) {
  const motion = enterMotion("fadeIn", MOTION_DURATION.fast);
  return (
    <If when={props.entry()}>
      {current => (
        <View
          accessibilityLabel="turn-jump-preview"
          style={[
            {
              width: 312,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderStrong,
              backgroundColor: palette().glassOverlayBg,
              backdropFilter: "blur(16px)",
              boxShadow: palette().shadowOverlay,
              gap: space.xs,
              pointerEvents: "none",
            },
            motion.style,
          ]}
        >
          <If when={current().prompt}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.4),
                fontWeight: "600",
                numberOfLines: 2,
                textOverflow: "ellipsis",
              }}
            >
              {current().prompt}
            </Text>
          </If>
          <If when={current().reply}>
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.45),
                numberOfLines: 3,
                textOverflow: "ellipsis",
              }}
            >
              {current().reply}
            </Text>
          </If>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.sm,
              paddingTop: space.hair,
            }}
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
              }}
            >
              {tr("sessions.turnPosition", { current: current().index + 1, total: current().total })}
            </Text>
            <If when={current().timestamp ? formatTimestamp(current().timestamp) : ""}>
              {formatted => (
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.3),
                  }}
                >
                  {formatted()}
                </Text>
              )}
            </If>
          </View>
        </View>
      )}
    </If>
  );
}

interface SessionTranscriptListProps {
  pane: 0 | 1;
  swapKey: () => string;
  blocks: () => TranscriptBlockProjection;
  visibleTurnRows: () => TurnRow[];
  hasEarlier: () => boolean;
  loadingEarlier: () => boolean;
  onLoadEarlier: () => void;
  /**
   * Until when (epoch ms) a jump is still settling: reaching the start meanwhile
   * loads earlier turns only after it, so the rows jumped to paint first.
   */
  loadEarlierHoldUntil?: () => number;
  onListRef: (ref: ListRef | undefined) => void;
  onScroll: (event: ScrollEvent) => void;
  onViewableItemsChange: (viewableItems: ReadonlyArray<ViewToken<TranscriptBlockRow>>) => void;
  activeRailKey: () => string;
  onJumpTurn: (key: string) => void;
  railAccessibilityLabel: string;
  railTickPrefix: string;
  followLatest: () => boolean;
  onJumpLatest: () => void;
  latestAccessibilityLabel?: string;
  empty?: () => boolean;
  emptyView?: JSX.Element;
  notice: () => string;
  noticeAccessibilityLabel?: string;
  loadingEmpty?: () => boolean;
  loadEarlierAccessibilityLabel: string;
  optimisticUserText: () => string;
  pendingImages: () => UserImage[];
  pendingTurnId: () => string;
  pendingCreatedAt: () => number | undefined;
  liveDisplayBlocks: () => LiveDisplayBlock[];
  liveFallbackItems?: () => TranscriptItem[];
  awaitingResponse?: () => boolean;
  waitingStartedAt?: () => number | undefined;
  cardPrefix?: string;
  turnError: () => string;
  onDismissTurnError: () => void;
  showAuthActionOnError?: boolean;
  sendNotice: () => string;
  sendNoticeAccessibilityLabel?: string;
  onDismissSendNotice: () => void;
}

/**
 * Single virtualized transcript list shared by Primary and Secondary Split panes.
 * Guarantees identical scroll geometry, settled/live rendering, non-text folding,
 * jump rail, latest pill, and notice/error banners across panes.
 */
function SessionTranscriptList(props: SessionTranscriptListProps) {
  const prefix = props.cardPrefix ?? "";
  const fallbackItems = () => props.liveFallbackItems?.() ?? [];
  let deferredEarlierLoad: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (deferredEarlierLoad) clearTimeout(deferredEarlierLoad);
    deferredEarlierLoad = null;
  });
  const requestEarlierTurns = (): void => {
    if (!props.hasEarlier() || props.loadingEarlier()) return;
    const wait = (props.loadEarlierHoldUntil?.() ?? 0) - Date.now();
    if (wait > 0) {
      if (deferredEarlierLoad) return;
      deferredEarlierLoad = setTimeout(() => {
        deferredEarlierLoad = null;
        requestEarlierTurns();
      }, wait);
      return;
    }
    props.onLoadEarlier();
  };

  const renderHeader = () => (
    <If
      when={
        Boolean(props.notice()) ||
        (props.hasEarlier() && props.visibleTurnRows().length > 0) ||
        Boolean(props.loadingEmpty?.())
      }
    >
      <View style={{ width: "100%", alignItems: "center", paddingBottom: space.lg }}>
        <View style={{ width: "100%", maxWidth: contentWidth(), gap: space.md }}>
          <If when={props.notice()}>
            {notice => (
              <InlineBanner
                tone="info"
                accessibilityLabel={props.noticeAccessibilityLabel}
                message={notice()}
              />
            )}
          </If>

          <If when={props.hasEarlier() && props.visibleTurnRows().length > 0}>
            <View style={{ alignSelf: "center" }}>
              <Button
                label={props.loadingEarlier() ? tr("chat.loadingEarlier") : tr("chat.loadEarlier")}
                variant="ghost"
                size="xs"
                leadingIcon="history"
                loading={props.loadingEarlier()}
                accessibilityLabel={props.loadEarlierAccessibilityLabel}
                onPress={props.onLoadEarlier}
              />
            </View>
          </If>

          <If when={Boolean(props.loadingEmpty?.())}>
            <View style={{ alignItems: "center", paddingVertical: space.xxl }}>
              <BrandSpinner size={20} />
            </View>
          </If>
        </View>
      </View>
    </If>
  );

  const renderFooter = () => (
    <If
      when={
        Boolean(props.optimisticUserText()) ||
        props.pendingImages().length > 0 ||
        props.liveDisplayBlocks().length > 0 ||
        fallbackItems().length > 0 ||
        Boolean(props.awaitingResponse?.()) ||
        Boolean(props.turnError()) ||
        Boolean(props.sendNotice())
      }
    >
      <View style={{ width: "100%", alignItems: "center", paddingTop: props.visibleTurnRows().length > 0 ? space.lg : 0 }}>
        <View style={{ width: "100%", maxWidth: contentWidth(), gap: 16 }}>
          <If
            when={
              Boolean(props.optimisticUserText()) ||
              props.pendingImages().length > 0 ||
              props.liveDisplayBlocks().length > 0 ||
              fallbackItems().length > 0 ||
              Boolean(props.awaitingResponse?.())
            }
          >
            {/* Mirrors settled turn spacing and footer height so settling into a persisted turn causes 0px vertical jump. */}
            <View style={{ gap: space.md }}>
              <If when={Boolean(props.optimisticUserText()) || props.pendingImages().length > 0}>
                <UserBubble
                  partKey={`${prefix}pending-${props.pendingTurnId() || props.optimisticUserText() || props.pendingImages().length}`}
                  text={props.optimisticUserText()}
                  images={props.pendingImages()}
                  timestamp={props.pendingCreatedAt()}
                  showCopy={false}
                />
              </If>

              <If when={props.liveDisplayBlocks().length > 0}>
                <LiveTranscriptBlocks blocks={props.liveDisplayBlocks} pane={props.pane} cardPrefix={props.cardPrefix} />
              </If>
              <If when={fallbackItems().length > 0}>
                <TranscriptItems items={fallbackItems()} live={true} pane={props.pane} />
              </If>
              <If
                when={Boolean(props.awaitingResponse?.())}
                else={
                  <If when={props.liveDisplayBlocks().length > 0 || fallbackItems().length > 0}>
                    <View style={{ height: compactLayout() ? layout.touchTarget : controlHeight.sm }} />
                  </If>
                }
              >
                <TurnWaitingIndicator
                  startedAt={props.waitingStartedAt}
                  accessibilityLabel={`${prefix}turn-waiting-indicator`}
                />
              </If>
            </View>
          </If>

          <If when={props.turnError()}>
            {message => (
              <InlineBanner
                tone="danger"
                message={localizeHostError(message())}
                actionLabel={props.showAuthActionOnError && isAuthRequiredError(message()) ? tr("devices.signInCta") : undefined}
                onAction={
                  props.showAuthActionOnError && isAuthRequiredError(message())
                    ? () => openAccountAuthModal({ autoStart: true })
                    : undefined
                }
                onDismiss={props.onDismissTurnError}
              />
            )}
          </If>

          <If when={props.sendNotice()}>
            {message => (
              <InlineBanner
                tone="warning"
                accessibilityLabel={props.sendNoticeAccessibilityLabel}
                message={message()}
                onDismiss={props.onDismissSendNotice}
              />
            )}
          </If>
        </View>
      </View>
    </If>
  );

  const renderList = () => (
    <Each of={[props.swapKey()]} key={k => k}>
      {() => (
        <List<TranscriptBlockRow>
          ref={el => props.onListRef(el)}
          style={{ flex: 1, minHeight: 0 }}
          each={props.blocks().rows}
          keyExtractor={row => row.key}
          estimatedItemSize={props.blocks().estimatedRowHeight}
          initialScrollAtEnd={true}
          maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 24 }}
          loadMoreAtStartThreshold={0.5}
          onLoadMoreAtStart={requestEarlierTurns}
          onScroll={props.onScroll}
          onViewableItemsChange={info => props.onViewableItemsChange(info.viewableItems)}
          contentStyle={{
            paddingLeft: paneTranscriptPadLeft(props.visibleTurnRows().length >= 2),
            paddingRight: sessionsPadX(),
            paddingTop: space.xl,
            paddingBottom: space.x3l,
            gap: 0,
          }}
          header={renderHeader}
          footer={renderFooter}
        >
          {row => <TranscriptBlockCell row={row} pane={props.pane} />}
        </List>
      )}
    </Each>
  );

  return (
    <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <If when={Boolean(props.empty?.()) && Boolean(props.emptyView)} else={renderList()}>
        {props.emptyView}
      </If>

      <TurnJumpRail
        rows={props.visibleTurnRows}
        previewOf={key => turnJumpPreview(props.visibleTurnRows(), key)}
        activeKey={props.activeRailKey}
        onJump={props.onJumpTurn}
        accessibilityLabel={props.railAccessibilityLabel}
        tickPrefix={props.railTickPrefix}
      />

      <If when={!props.followLatest()}>
        <LatestPill
          accessibilityLabel={props.latestAccessibilityLabel}
          onPress={props.onJumpLatest}
        />
      </If>
    </View>
  );
}

function Transcript() {
  resetTranscriptScrollTracking();
  registerTranscriptAutoBackfillGuard(() => followLatest());
  registerTranscriptBeforePrependListener(null);
  cleanup(() => {
    registerTranscriptAutoBackfillGuard(null);
    registerTranscriptBeforePrependListener(null);
    transcriptListRef = undefined;
  });
  let lastSessionId = activeSessionId();
  let lastOptimisticText = optimisticUserText();
  const transcriptSwapKey = () =>
    activeSessionKey() ? `${activeSessionKey()}:${turnsLoading() ? "loading" : "ready"}` : "welcome";

  effect(() => {
    const id = activeSessionId();
    if (id !== lastSessionId) {
      lastSessionId = id;
      resetTranscriptScrollTracking();
      rerunTarget.set(null);
      turnChangesReview.set(null);
      // The previous transcript's rows are disposed with their keys; drop the
      // per-row state they left behind so a long day of sessions does not grow it.
      untracked(() => {
        resetExpandedCards();
        fullReplySignals.clear();
        liveStreamedTurnIds.clear();
        thinkingOverrides.set({});
        expandedUserMessages.set([]);
        questionPages.set({});
      });
    }
    if (isTranscriptEmpty()) {
      transcriptScrolled.set(false);
    }
  });

  // Whenever a new prompt starts (from Composer, Quick Action, Home,
  // Assistants, or Queued "Send now"), re-lock follow mode and snap to bottom.
  effect(() => {
    const pending = optimisticUserText();
    if (pending && pending !== lastOptimisticText) {
      lastOptimisticText = pending;
      jumpToTranscriptEnd();
    } else if (!pending) {
      lastOptimisticText = "";
    }
  });

  // Track ONLY the throttled 60fps `streamScrollTick()` and coarse structural
  // signals — never raw `streamText()`, `thinkingText()`, or full `liveTurn()`.
  effect(() => {
    const live = liveTurn();
    if (live?.turnId && live.sessionId === activeSessionId() && (live.deviceId ?? "") === activeSessionDevice()) {
      liveStreamedTurnIds.add(live.turnId);
    }
    activeSessionId();
    sessionTurns().length;
    optimisticUserText();
    streamScrollTick();
    live?.rounds.length;
    hasLiveContent();
    primaryAwaitingResponse();
    isStreamDraining();
    stickToTranscriptEnd();
  });

  return (
    <SessionTranscriptList
      pane={0}
      swapKey={transcriptSwapKey}
      blocks={primaryTranscriptBlocks}
      visibleTurnRows={visibleTurnRows}
      hasEarlier={() => hasEarlierTurns() && sessionTurns().length > 0}
      loadingEarlier={loadingEarlier}
      onLoadEarlier={() => void showEarlierTurns()}
      loadEarlierHoldUntil={() => suppressAutoFollowUntil}
      onListRef={el => {
        transcriptListRef = el;
      }}
      onScroll={handleTranscriptScroll}
      onViewableItemsChange={syncActiveRailFromViewable}
      activeRailKey={activeRailTurnKey}
      onJumpTurn={jumpToTurn}
      railAccessibilityLabel="turn-jump-rail"
      railTickPrefix="turn-jump-"
      followLatest={followLatest}
      onJumpLatest={jumpToTranscriptEnd}
      empty={isTranscriptEmpty}
      emptyView={
        <Scroll
          smoothWheel
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            paddingLeft: sessionsPadX(),
            paddingRight: sessionsPadX(),
            paddingTop: space.xl,
            paddingBottom: space.x3l,
          }}
        >
          <WelcomeStudio />
        </Scroll>
      }
      notice={transcriptNotice}
      noticeAccessibilityLabel="transcript-host-update"
      loadEarlierAccessibilityLabel="load-earlier-turns"
      optimisticUserText={optimisticUserText}
      pendingImages={pendingTurnImages}
      pendingTurnId={() => pendingTurnState()?.turnId ?? ""}
      pendingCreatedAt={() => pendingTurnState()?.createdAt}
      liveDisplayBlocks={liveDisplayBlocks}
      liveFallbackItems={liveFallbackItems}
      awaitingResponse={primaryAwaitingResponse}
      waitingStartedAt={primaryWaitingStartedAt}
      turnError={turnError}
      onDismissTurnError={() => turnError.set("")}
      showAuthActionOnError={true}
      sendNotice={sendNotice}
      sendNoticeAccessibilityLabel="send-host-update"
      onDismissSendNotice={() => sendNotice.set("")}
    />
  );
}

/** The tool the running turn is in right now, as its row would title it. */
const slashMatches = computed(() => slashCommandsFor(composerText(), Boolean(runningTurnId())));
const slashSkillMatches = computed(() => slashSkillsFor(composerText()));
const slashSelectedIndex = signal(0);
const composerCaretPos = signal(0);

const slashPopoverVisible = computed(
  () =>
    ((slashMatches()?.length ?? 0) > 0 ||
      slashSkillMatches().length > 0 ||
      mcpPromptMatches().length > 0) &&
    !mentionOpen(),
);

async function runUsageSlashCommand(sessionId: string): Promise<void> {
  try {
    const report = await invokeCommand<Record<string, unknown>>("get_session_usage_report", {
      session_id: sessionId,
      ...(activeWorkspaceId() ? { workspace_id: activeWorkspaceId() } : {}),
      workspace_path: activeWorkspaceRoot() || "",
    });
    const summary = (report?.summary ?? report?.totals ?? report) as Record<string, unknown> | undefined;
    const input = Number(
      summary?.total_input_tokens ?? summary?.totalInputTokens ?? summary?.input_tokens ?? summary?.inputTokens ?? 0,
    );
    const output = Number(
      summary?.total_output_tokens ?? summary?.totalOutputTokens ?? summary?.output_tokens ?? summary?.outputTokens ?? 0,
    );
    const total = Number(
      summary?.total_tokens ?? summary?.totalTokens ?? input + output,
    );
    pushToast(
      tr("sessions.usageSummary", {
        total: formatTokens(total),
        input: formatTokens(input),
        output: formatTokens(output),
      }),
      "info",
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/not found|unknown command/i.test(msg)) {
      pushToast(tr("sessions.usageUnavailable"), "warning");
      return;
    }
    pushToast(localizeHostError(msg), "error");
  }
}

/** Resolves `/model [query]`: opens the model picker or switches directly to a unique match. */
async function runModelSlashCommand(arg: string): Promise<void> {
  composerText.set("");
  ensureModelsLoaded();
  const query = arg.trim().toLowerCase();
  if (!query) {
    modelPickerOpen.set(true);
    return;
  }
  const candidates: Array<{ ref: string; label: string; keys: string[] }> = [];
  const groups = fleetModelGroups();
  if (groups && groups.length > 0) {
    for (const device of groups) {
      for (const model of device.models) {
        if (!model.selectable) continue;
        const text = fleetModelText(model);
        const label = device.isThisDevice
          ? text.label
          : tr("models.onDevice", { model: text.label, device: device.name });
        candidates.push({
          ref: model.modelRef,
          label,
          keys: [model.modelRef, model.modelId, model.displayName, model.modelName ?? "", text.label].map(v => v.toLowerCase()),
        });
      }
    }
  } else {
    for (const option of chatModels()) {
      candidates.push({
        ref: option.id,
        label: option.label,
        keys: [option.id, option.configId, option.modelName, option.label].map(v => v.toLowerCase()),
      });
    }
  }
  const exact = candidates.filter(entry => entry.keys.includes(query));
  const matches = exact.length > 0 ? exact : candidates.filter(entry => entry.keys.some(k => k && k.includes(query)));
  if (matches.length === 1) {
    await chooseModel(matches[0]!.ref);
    pushToast(tr("sessions.modelLabel", { name: matches[0]!.label }), "success");
    return;
  }
  modelPickerOpen.set(true);
}

async function executeSlashCommand(command: SlashCommand, arg = ""): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;
  if (command.local) {
    if (command.id === "model") {
      await runModelSlashCommand(arg);
      return;
    }
    if (command.id === "goal") {
      composerText.set("");
      if (!arg || /^edit$/i.test(arg)) openGoalDialog();
      else runExtrasCommand(`/goal ${arg}`);
      return;
    }
    if (command.id === "btw") {
      composerText.set("");
      if (!arg) openSideQuestion();
      else runExtrasCommand(`/btw ${arg}`);
      return;
    }
    if (command.id === "review") {
      composerText.set("");
      if (!arg) openReviewLauncher();
      else await launchReviewFromCommand(`/review ${arg}`);
      return;
    }
    if (command.id === "usage") {
      composerText.set("");
      await runUsageSlashCommand(sessionId);
      return;
    }
  }
  if (command.idleOnly && runningTurnId()) {
    pushToast(tr("sessions.steeringRunning"), "info");
    return;
  }
  composerText.set("");
  const outcome = await runSlashCommand(sessionId, command, arg);
  if (outcome.ok) {
    pushToast(outcome.message, "success");
    if (outcome.outcome === "compaction_started") void loadTurns(sessionId, { silent: true });
    if (outcome.outcome === "reloaded") {
      void loadSlashSkills(agentTypeOf(sessionId), activeWorkspaceId(), activeWorkspaceRoot(), true);
    }
  } else {
    turnError.set(outcome.message);
  }
}

function handleSlashKeyNavigation(key: string): boolean {
  if (!slashPopoverVisible()) return false;
  const cmds = slashMatches() ?? [];
  const skills = slashSkillMatches();
  const total = cmds.length + skills.length;
  if (key === "Escape") {
    composerText.set("");
    return true;
  }
  if (total <= 0) return false;
  if (key === "ArrowDown") {
    slashSelectedIndex.update(idx => (idx + 1) % total);
    return true;
  }
  if (key === "ArrowUp") {
    slashSelectedIndex.update(idx => (idx - 1 + total) % total);
    return true;
  }
  if (key === "Tab") {
    const idx = Math.max(0, Math.min(slashSelectedIndex(), total - 1));
    if (idx < cmds.length) {
      const cmd = cmds[idx]!;
      composerText.set(`${cmd.command} `);
      composerInputRef?.focus();
    } else {
      const skill = skills[idx - cmds.length];
      if (skill) insertSlashSkill(skill, composerInputRef);
    }
    return true;
  }
  return false;
}

function selectHighlightedSlashItem(): boolean {
  if (!slashPopoverVisible()) return false;
  const cmds = slashMatches() ?? [];
  const skills = slashSkillMatches();
  const total = cmds.length + skills.length;
  if (total <= 0) return false;
  const idx = Math.max(0, Math.min(slashSelectedIndex(), total - 1));
  if (idx < cmds.length) {
    const cmd = cmds[idx]!;
    void executeSlashCommand(cmd);
    return true;
  }
  const skill = skills[idx - cmds.length];
  if (skill) {
    insertSlashSkill(skill, composerInputRef);
    return true;
  }
  return false;
}

/** Shown under a typed `/` when the host offers no session commands at all. */
function SlashCommandsUnavailable(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => composerText.set(""));
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 340,
          maxWidth: "92%",
          padding: space.md,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.4),
        }}
      >
        {tr("chat.slash.hostUpdateRequired")}
      </Text>
    </View>
  );
}

function SlashCommandSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => composerText.set(""));
  const cmdCount = () => (slashMatches() ?? []).length;
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 380,
          maxWidth: "92%",
          padding: POPOVER_PADDING,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Scroll smoothWheel style={{ maxHeight: 300, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.hair }}>
          <If when={cmdCount() > 0}>
            <PopoverSectionHeader label={tr("chat.slash.title")} />
            <Each of={slashMatches() ?? []} key={entry => entry.id}>
              {(entry, idx) => (
                <View
                  role="button"
                  accessibilityLabel={`slash-command-${entry().id}`}
                  onPress={() => void executeSlashCommand(entry())}
                  style={popoverRowStyle(idx() === slashSelectedIndex())}
                  hoverStyle={popoverRowHoverStyle()}
                  activeStyle={popoverRowActiveStyle()}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <ListRowContent
                    icon="command"
                    iconColor={palette().textSecondary}
                    title={entry().command}
                    titleWeight="500"
                    subtitle={slashCommandLabel(entry())}
                  />
                </View>
              )}
            </Each>
          </If>

          <If when={slashSkillMatches().length > 0}>
            <PopoverSectionHeader label={tr("sessions.slashSkillsSection")} first={cmdCount() === 0} />
            <Each of={slashSkillMatches()} key={skill => skill.name}>
              {(skill, idx) => {
                const flatIndex = () => cmdCount() + idx();
                return (
                  <View
                    role="button"
                    accessibilityLabel={`slash-skill-${skill().name}`}
                    onPress={() => insertSlashSkill(skill(), composerInputRef)}
                    style={popoverRowStyle(flatIndex() === slashSelectedIndex())}
                    hoverStyle={popoverRowHoverStyle()}
                    activeStyle={popoverRowActiveStyle()}
                    focusVisibleStyle={focusRingStyle(-1)}
                  >
                    <ListRowContent
                      icon="sparkles"
                      iconColor={palette().textSecondary}
                      title={`/${skill().name}`}
                      titleWeight="500"
                      subtitle={skill().description || skill().argumentHint || ""}
                    />
                  </View>
                );
              }}
            </Each>
          </If>

          <McpPromptRows />
          <If when={sessionCommandsUnsupported()}>
            <Text
              style={{
                paddingHorizontal: space.sm,
                paddingTop: space.xs,
                paddingBottom: space.hair,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("chat.slash.hostUpdateRequired")}
            </Text>
          </If>
        </View>
      </Scroll>
    </View>
  );
}

async function submitComposer(sendDuringTurn?: "immediate" | "queue"): Promise<void> {
  if (insertSelectedMention()) return;
  // review launcher (wave 5): `/review …` asks the host to start a Review.
  if (activeSessionId() && isReviewCommand(composerText())) {
    const line = composerText();
    composerText.set("");
    await launchReviewFromCommand(line);
    return;
  }
  const slash = parseSlashCommand(composerText());
  if (slash && activeSessionId()) {
    await executeSlashCommand(slash.command, slash.arg);
    return;
  }
  // Partial `/...` token matching a highlighted slash command or skill selects it on Return.
  if (activeSessionId() && composerText().startsWith("/") && !/\s/.test(composerText())) {
    if (selectHighlightedSlashItem()) return;
  }
  // `/goal [objective|clear|pause|resume|edit]` and `/btw [question]`
  if (activeSessionId()) {
    if (runExtrasCommand(composerText())) {
      composerText.set("");
      return;
    }
  }
  const text = composerText();
  const hasPayload = Boolean(text.trim() || imageAttachments().length > 0 || fileAttachments().length > 0);
  if (hasPayload && !runningTurnId()) jumpToTranscriptEnd();
  // The host decides whether a message written during a turn steers it or
  // waits in its queue; the composer clears immediately and follows the answer.
  const outcome = await sendTurn(text, sendDuringTurn, {
    onQueued: info => {
      recordQueuedFromSubmit(info.sessionId, info.turnId, info.content, info.attachmentCount, info.attachments);
      void loadQueueForSession(info.sessionId, true);
    },
  });
  if (outcome === "steered" && hasPayload) jumpToTranscriptEnd();
}

function insertSelectedMention(): boolean {
  if (!mentionOpen() || !mentionInline()) return false;
  const hits = mentionHits();
  if (hits.length === 0) return false;
  const idx = Math.max(0, Math.min(mentionSelectedIndex(), hits.length - 1));
  const chosen = hits[idx] ?? hits[0];
  if (!chosen) return false;
  mentionSelectedIndex.set(0);
  insertMention(chosen, composerInputRef);
  return true;
}

function handleMentionKeyNavigation(key: string): void {
  if (!mentionOpen()) return;
  const hits = mentionHits();
  const count = hits.length;
  if (key === "Escape") {
    closeMention();
    return;
  }
  if (key === "ArrowLeft" && !mentionQuery().trim() && mentionBrowseDir()) {
    browseMentionParent();
    return;
  }
  if (count <= 0) return;
  if (key === "ArrowDown") {
    mentionSelectedIndex.update(idx => (idx + 1) % count);
  } else if (key === "ArrowUp") {
    mentionSelectedIndex.update(idx => (idx - 1 + count) % count);
  } else if (key === "ArrowRight") {
    const chosen = hits[Math.max(0, Math.min(mentionSelectedIndex(), count - 1))];
    if (chosen?.directory) browseMentionDir(chosen.path);
  }
}

/** Unified Floating 3-Band `ChatInput` dock with paste, file drop, and caret-anchored @ mentions. */
const permissionPillAnchor = signal<ViewRef | null>(null);
const fullAccessTriggerAnchor = signal<ViewRef | null>(null);
const permissionModeAlign = signal<"start" | "end">("start");
const contextRingAnchor = signal<ViewRef | null>(null);
const contextUsageAlign = signal<"start" | "end">("end");
const contextPopoverOpen = signal(false);

const PERMISSION_MODE_ROWS: ReadonlyArray<{
  mode: "ask" | "auto" | "full_access" | null;
  labelKey: MessageKey;
  detailKey: MessageKey;
}> = [
  { mode: null, labelKey: "chat.permissionMode.default", detailKey: "chat.permissionMode.defaultDesc" },
  { mode: "ask", labelKey: "chat.permissionMode.ask", detailKey: "chat.permissionMode.askDesc" },
  { mode: "auto", labelKey: "chat.permissionMode.auto", detailKey: "chat.permissionMode.autoDesc" },
  { mode: "full_access", labelKey: "chat.permissionMode.fullAccess", detailKey: "chat.permissionMode.fullAccessDesc" },
];

function permissionModeLabel(mode: "ask" | "auto" | "full_access"): string {
  return mode === "full_access"
    ? tr("chat.permissionMode.fullAccess")
    : mode === "auto"
      ? tr("chat.permissionMode.auto")
      : tr("chat.permissionMode.ask");
}

/**
 * Shared full-access permission indicator pill rendered in both Primary and Secondary composers.
 */
function ComposerFullAccessShield(props: {
  sessionId: () => string | null;
  compact?: () => boolean;
  accessibilityLabel: string;
  onPress: (anchor: ViewRef | null) => void;
}) {
  let triggerRef: ViewRef | null = null;
  return (
    <If
      when={
        permissionModeSupported() !== false &&
        Boolean(props.sessionId()) &&
        effectivePermissionMode(props.sessionId()!) === "full_access"
      }
    >
      <View
        ref={el => {
          triggerRef = el;
          if (props.accessibilityLabel === "permission-mode-warning") {
            fullAccessTriggerAnchor.set(el);
          }
        }}
        role="button"
        accessibilityLabel={props.accessibilityLabel}
        tooltip={
          <TooltipBubble
            text={`${permissionModeLabel("full_access")} · ${tr("chat.permissionMode.tooltip")}`}
          />
        }
        onPress={() => props.onPress(triggerRef)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: compactLayout() || props.compact?.() ? layout.touchTarget : 28,
          height: compactLayout() || props.compact?.() ? layout.touchTarget : 28,
          borderRadius: radii.pill,
          backgroundColor: permissionModePickerOpen() ? palette().warningSoft : "transparent",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().warningSoft }}
        activeStyle={tactileActiveStyle(0.95)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon name="shield" size={15} color={palette().warning} />
      </View>
    </If>
  );
}

function PermissionModeSurface(props: { placement: Placement; align: "start" | "end" }) {
  const motion = usePopoverMotion(() => props.placement, props.align, () => {
    permissionModePickerOpen.set(false);
    permissionModeTarget.set(null);
    permissionModePlacement.set("top");
  });
  const targetSessionId = () => permissionModeTarget()?.sessionId ?? activeSessionId();
  const permissionRowCurrent = (mode: (typeof PERMISSION_MODE_ROWS)[number]["mode"]) =>
    (mode === null && followsDefaultMode(targetSessionId())) ||
    (mode !== null && !followsDefaultMode(targetSessionId()) && effectivePermissionMode(targetSessionId()) === mode);
  return (
    <View
      testID="permission-mode-surface"
      accessibilityLabel={`permission-mode-popover-${props.align}`}
      style={[
        overlayPopoverStyle(),
        {
          width: 280,
          maxWidth: "92%",
          padding: POPOVER_PADDING,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, props.align),
        },
        motion.style,
      ]}
    >
      <Each of={PERMISSION_MODE_ROWS} key={row => String(row.mode)}>
        {row => (
          <View
            role="button"
            accessibilityLabel={`permission-mode-${row().mode ?? "default"}`}
            onPress={() => {
              const target = permissionModeTarget();
              permissionModeTarget.set(null);
              void chooseSessionPermissionMode(row().mode, target ?? undefined);
            }}
            style={popoverRowStyle()}
            hoverStyle={popoverRowHoverStyle()}
            activeStyle={popoverRowActiveStyle()}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <ListRowContent
              title={
                row().mode === null
                  ? tr("chat.permissionMode.defaultWith", { mode: permissionModeLabel(permissionMode() ?? "ask") })
                  : tr(row().labelKey)
              }
              titleWeight={permissionRowCurrent(row().mode) ? "500" : "400"}
              subtitle={tr(row().detailKey)}
              subtitleLines={2}
              trailing={permissionRowCurrent(row().mode) ? <PopoverCheck /> : undefined}
            />
          </View>
        )}
      </Each>
      <If when={permissionModeNotice()}>
        {notice => (
          <Text style={{ paddingHorizontal: space.sm, color: palette().danger, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
            {notice()}
          </Text>
        )}
      </If>
    </View>
  );
}

const contextTargetSessionId = signal<string | null>(null);
const contextTargetDeviceId = signal<string>("");

function contextUsageFor(sessionId: string | null, deviceId?: string) {
  const usage = sessionId ? contextUsage()[sessionId] : undefined;
  if (!usage) return null;
  const modelId = modelIdForSession(sessionId, deviceId);
  const fallbackMax =
    chatModels().find(model => model.id === modelId)?.contextWindow ??
    fleetChoiceOf(modelId)?.choice.contextWindow ??
    null;
  const max = usage.max ?? fallbackMax;
  return { ...usage, max, ratio: max && max > 0 ? Math.min(1, usage.used / max) : null };
}

const activeContextUsage = computed(() => contextUsageFor(activeSessionId(), activeSessionDevice()));

const popoverContextUsage = computed(() => {
  const targetId = contextTargetSessionId();
  if (targetId) return contextUsageFor(targetId, contextTargetDeviceId() || undefined);
  return activeContextUsage();
});

/** How full the context window is, as a ring with the numbers behind it on press. */
function ContextUsageRing(props: {
  sessionId?: () => string | null;
  deviceId?: () => string;
  accessibilityLabel?: string;
  onFocusPane?: () => void;
} = {}) {
  let triggerRef: ViewRef | null = null;
  const usageForPane = computed(() =>
    props.sessionId
      ? contextUsageFor(props.sessionId(), props.deviceId?.())
      : activeContextUsage(),
  );
  return (
    <If when={usageForPane()}>
      {usage => (
        <View
          ref={el => {
            triggerRef = el;
            if (!props.onFocusPane) contextRingAnchor.set(el);
          }}
          style={{ flexShrink: 0 }}
        >
          <View
            role="button"
            accessibilityLabel={props.accessibilityLabel ?? "context-usage"}
            tooltip={<TooltipBubble text={tr("chat.context.tooltip")} />}
            onPress={() => {
              props.onFocusPane?.();
              contextTargetSessionId.set(props.sessionId ? props.sessionId() : activeSessionId());
              contextTargetDeviceId.set(props.deviceId ? props.deviceId() : activeSessionDevice());
              contextRingAnchor.set(triggerRef);
              contextUsageAlign.set("end");
              const next = !contextPopoverOpen();
              closePickers();
              contextPopoverOpen.set(next);
            }}
            style={{
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radii.pill,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            activeStyle={tactileActiveStyle(0.95)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Canvas
              style={{ width: 16, height: 16, pointerEvents: "none" }}
              draw={(cx, size) => {
                const ratio = usage().ratio ?? 0;
                const r = Math.min(size.width, size.height) / 2 - 1.5;
                const x = size.width / 2;
                const y = size.height / 2;
                cx.lineWidth = 2;
                cx.strokeStyle = palette().borderStrong;
                cx.beginPath();
                cx.arc(x, y, r, 0, Math.PI * 2);
                cx.stroke();
                cx.strokeStyle = ratio > 0.9 ? palette().danger : ratio > 0.75 ? palette().warning : palette().accent;
                cx.beginPath();
                cx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
                cx.stroke();
              }}
            />
          </View>
        </View>
      )}
    </If>
  );
}

function ContextUsageSurface(props: { placement: Placement; align: "start" | "end" }) {
  const motion = usePopoverMotion(() => props.placement, props.align, () => {
    contextPopoverOpen.set(false);
    contextTargetSessionId.set(null);
    contextUsagePlacement.set("top");
  });
  return (
    <If when={popoverContextUsage()}>
      {usage => (
        <View
          style={[
            overlayPopoverStyle(),
            {
              width: 240,
              maxWidth: "92%",
              padding: space.md,
              gap: space.chip,
              transformOrigin: popoverOrigin(props.placement, props.align),
            },
            motion.style,
          ]}
        >
          <Text style={{ color: palette().text, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.35), fontWeight: "600" }}>
            {tr("chat.context.title")}
          </Text>
          <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45), fontVariant: ["tabular-nums"] }}>
            {usage().max
              ? tr("chat.context.usedOf", {
                  used: formatTokens(usage().used),
                  max: formatTokens(usage().max ?? 0),
                  percent: formatPercent(usage().ratio),
                })
              : tr("chat.context.used", { used: formatTokens(usage().used) })}
          </Text>
          <If when={usage().output !== undefined}>
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45), fontVariant: ["tabular-nums"] }}>
              {tr("chat.context.lastOutput", { count: formatTokens(usage().output ?? 0) })}
            </Text>
          </If>
          <If when={usage().cached !== undefined}>
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45), fontVariant: ["tabular-nums"] }}>
              {tr("chat.context.cached", { count: formatTokens(usage().cached ?? 0) })}
            </Text>
          </If>
        </View>
      )}
    </If>
  );
}

function toggleComposerPlus(): void {
  const next = !composerPlusOpen();
  closePickers();
  closeMentionPopover();
  composerPlusOpen.set(next);
}

/**
 * A 44 pt touch target around a 34 pt round control, for the narrow (phone)
 * composer: the whole square takes the press, the circle is only drawn.
 */
function TouchTargetButton(props: {
  icon: IconName;
  tone: "ghost" | "active" | "primary" | "subtle";
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={{
        width: layout.touchTarget,
        height: layout.touchTarget,
        alignItems: "center",
        justifyContent: "center",
        cursor: props.disabled ? "default" : "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={props.disabled ? undefined : tactileActiveStyle(0.97)}
      focusVisibleStyle={focusRingStyle(-4)}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radii.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor:
            props.tone === "primary"
              ? palette().actionPrimaryBg
              : props.tone === "active"
                ? palette().surfaceSubtle
                : props.tone === "subtle"
                  ? palette().surfaceSubtle
                  : "transparent",
          pointerEvents: "none",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <Icon
          name={props.icon}
          size={18}
          color={
            props.tone === "primary"
              ? palette().actionPrimaryFg
              : props.tone === "subtle"
                ? palette().textMuted
                : palette().textSecondary
          }
        />
      </View>
    </View>
  );
}

/**
 * The composer's "+" menu: the rarely used controls (image picker, file
 * reference, quick actions, permission mode). On a narrow column it also holds
 * attach, agent, model, reasoning and context, so the row keeps only "+" and
 * Send. A picker opened from here anchors to the "+" button.
 */
function composerPlusItems(compact: boolean): DropdownMenuItem[] {
  const fromPlus = (open: () => void) => () => {
    composerPlusOpen.set(false);
    open();
  };
  const items: DropdownMenuItem[] = [
    {
      id: "pick-images",
      icon: "image",
      label: tr("chat.attach.pickImages"),
      accessibilityLabel: "attach-image-file",
      onSelect: fromPlus(() => {
        void attachImagesFromPicker();
      }),
    },
    {
      id: "reference",
      icon: "at",
      label: tr("sessions.referenceFile"),
      accessibilityLabel: "Reference",
      onSelect: fromPlus(() => openMention()),
    },
    {
      id: "actions",
      icon: "bolt",
      label: tr("sessions.quickActions"),
      accessibilityLabel: "Actions",
      onSelect: fromPlus(() => {
        quickActionsAnchor.set(composerPlusAnchor());
        closePickers("actions");
        quickActionMenuOpen.set(true);
      }),
    },
  ];
  if (permissionModeSupported() !== false && activeSessionId()) {
    items.push({
      id: "permission",
      icon: "shield",
      label: tr("chat.permissionMode.tooltip"),
      trailingHint: permissionModeLabel(effectivePermissionMode(activeSessionId())),
      accessibilityLabel: "permission-mode-pill",
      onSelect: fromPlus(() => {
        permissionModeTarget.set(null);
        permissionPillAnchor.set(composerPlusAnchor());
        permissionModeAlign.set("start");
        closePickers();
        permissionModePickerOpen.set(true);
      }),
    });
  }
  if (compact) {
    const agentLocked = agentModeLockedToSingle();
    items.push(
      {
        id: "agent",
        icon: "bot",
        label: tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) }),
        separator: true,
        disabled: agentLocked,
        accessibilityLabel: "agent-picker",
        onSelect: agentLocked
          ? undefined
          : fromPlus(() => {
              agentPickerAnchor.set(composerPlusAnchor());
              closePickers("agent");
              agentPickerOpen.set(true);
            }),
      },
      {
        id: "model",
        icon: "cpu",
        label: tr("sessions.modelLabel", { name: activeModelLabel() }),
        accessibilityLabel: "bot-capsule-trigger",
        onSelect: fromPlus(() => {
          modelPickerAnchor.set(composerPlusAnchor());
          closePickers("model");
          modelPickerOpen.set(true);
        }),
      },
    );
    if (activeReasoningChoices().length > 0) {
      items.push({
        id: "reasoning",
        icon: "bulb",
        label: tr("sessions.reasoningLabel", { name: activeReasoningLabel() }),
        accessibilityLabel: "reasoning-picker",
        onSelect: fromPlus(() => {
          reasoningPickerAnchor.set(composerPlusAnchor());
          closePickers("reasoning");
          reasoningPickerOpen.set(true);
        }),
      });
    }
    const usage = activeContextUsage();
    if (usage) {
      items.push({
        id: "context",
        icon: "activity",
        label: tr("chat.context.tooltip"),
        trailingHint: usage.ratio !== null ? formatPercent(usage.ratio) : formatTokens(usage.used),
        accessibilityLabel: "context-usage",
        onSelect: fromPlus(() => {
          contextRingAnchor.set(composerPlusAnchor());
          contextUsageAlign.set("start");
          closePickers();
          contextPopoverOpen.set(true);
        }),
      });
    }
  }
  return items;
}

const DOC_FILE_EXTENSIONS = new Set(["MD", "DOC", "DOCX", "PDF", "RTF", "RST"]);
const CODE_FILE_EXTENSIONS = new Set([
  "TS",
  "TSX",
  "JS",
  "JSX",
  "MJS",
  "CJS",
  "RS",
  "PY",
  "GO",
  "JAVA",
  "KT",
  "SWFT",
  "JSON",
  "YAML",
  "YML",
  "TOML",
  "CSS",
  "SCSS",
  "HTML",
  "XML",
  "SQL",
  "SH",
  "ZSH",
  "BASH",
  "C",
  "CPP",
  "H",
  "HPP",
]);

function fileExtensionBadge(name: string): { label: string; tone: "doc" | "code" | "neutral" } {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const raw = name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (raw.length > 0) {
      const label = raw.length > 4 ? raw.slice(0, 4) : raw;
      if (DOC_FILE_EXTENSIONS.has(label)) return { label, tone: "doc" };
      if (CODE_FILE_EXTENSIONS.has(label)) return { label, tone: "code" };
      return { label, tone: "neutral" };
    }
  }
  return { label: "FILE", tone: "neutral" };
}

function fileChipDisplayName(entry: FileAttachment): string {
  if (entry.isDirectory) return entry.name;
  const dot = entry.name.lastIndexOf(".");
  if (dot > 0 && dot < entry.name.length - 1) {
    const ext = entry.name.slice(dot + 1);
    if (/^[a-zA-Z0-9]{1,4}$/.test(ext)) {
      return entry.name.slice(0, dot);
    }
  }
  return entry.name;
}

/**
 * Unified Antigravity-style attachment strip shared across all session composers.
 * Keeps images (34×34) and file/folder chips (34px height, compact 164px maxWidth)
 * pixel-identical in height with no divider above the editor text.
 */
function ComposerAttachmentStrip(props: {
  images: () => ReadonlyArray<ImageAttachment>;
  files: () => ReadonlyArray<FileAttachment>;
  notice?: () => string;
  onRemoveImage: (id: string) => void;
  onRemoveFile: (id: string) => void;
  idPrefix?: string;
}) {
  const prefix = props.idPrefix ?? "";
  const noticeText = () => props.notice?.() ?? "";
  return (
    <If when={props.images().length > 0 || props.files().length > 0 || noticeText().length > 0}>
      <View
        style={{
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: 0,
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: space.chip,
        }}
      >
        <Each of={props.images()} key={entry => entry.id}>
          {entry => (
            <View
              style={{
                boxSizing: "border-box",
                position: "relative",
                width: 34,
                height: 34,
                minHeight: 34,
                maxHeight: 34,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <If
                when={attachmentPreviewSrc(entry())}
                else={
                  <View
                    style={{
                      width: "100%",
                      height: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="image" size={14} color={palette().textSecondary} />
                  </View>
                }
              >
                {src => (
                  <View
                    role="button"
                    accessibilityLabel={`${prefix}attachment-preview-${entry().id}`}
                    onPress={() => openImageLightbox({ src: src(), title: entry().name })}
                    style={{
                      width: "100%",
                      height: "100%",
                      cursor: "pointer",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ opacity: 0.9 }}
                    activeStyle={tactileActiveStyle(0.96)}
                    focusVisibleStyle={focusRingStyle(-1)}
                  >
                    <Image
                      src={src()}
                      accessibilityLabel={`${prefix}attachment-thumb-${entry().id}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </View>
                )}
              </If>
              <View
                role="button"
                hitSlop={compactLayout() ? 6 : 4}
                accessibilityLabel={`${prefix}remove-attachment-${entry().id}`}
                onPress={() => props.onRemoveImage(entry().id)}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 14,
                  height: 14,
                  borderRadius: radii.pill,
                  backgroundColor: palette().scrimBg,
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().danger }}
                activeStyle={tactileActiveStyle(0.92)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Icon name="close" size={8} color={palette().actionPrimaryFg} />
              </View>
            </View>
          )}
        </Each>

        <Each of={props.files()} key={entry => entry.id}>
          {entry => {
            const badge = () => fileExtensionBadge(entry().name);
            return (
              <View
                accessibilityLabel={`${prefix}file-attachment-${entry().name}`}
                style={{
                  boxSizing: "border-box",
                  flexDirection: "row",
                  alignItems: "center",
                  maxWidth: 164,
                  height: 34,
                  minHeight: 34,
                  maxHeight: 34,
                  gap: space.xs,
                  paddingLeft: space.chip,
                  paddingRight: space.xs,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                  flexShrink: 0,
                }}
              >
                <View
                  role="button"
                  accessibilityLabel={`${prefix}file-attachment-open-${entry().id}`}
                  onPress={() => {
                    if (!entry().isDirectory && entry().path) {
                      openInAuxPane("files", entry().path);
                    } else {
                      openInAuxPane("files");
                    }
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.chip,
                    flexShrink: 1,
                    minWidth: 0,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <If
                    when={Boolean(entry().isDirectory)}
                    else={
                      <View
                        style={{
                          height: 20,
                          minWidth: 26,
                          paddingHorizontal: 5,
                          borderRadius: radii.xs,
                          borderCurve: "continuous",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          backgroundColor:
                            badge().tone === "doc"
                              ? palette().accentSoft
                              : badge().tone === "code"
                                ? palette().successSoft
                                : palette().chip,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: textSize(9.5),
                            lineHeight: textLineHeight(9.5, 1.15),
                            fontWeight: "700",
                            letterSpacing: 0.3,
                            color:
                              badge().tone === "doc"
                                ? palette().accent
                                : badge().tone === "code"
                                  ? palette().success
                                  : palette().textSecondary,
                          }}
                        >
                          {badge().label}
                        </Text>
                      </View>
                    }
                  >
                    <View
                      style={{
                        width: 22,
                        height: 20,
                        borderRadius: radii.xs,
                        borderCurve: "continuous",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        backgroundColor: palette().accentSoft,
                      }}
                    >
                      <Icon name="folder" size={12} color={palette().accent} />
                    </View>
                  </If>
                  <Text
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      color: palette().text,
                      fontSize: textSize(12.5),
                      lineHeight: textLineHeight(12.5, 1.3),
                      fontWeight: "500",
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {fileChipDisplayName(entry())}
                  </Text>
                </View>
                <View
                  role="button"
                  hitSlop={compactLayout() ? 6 : 4}
                  accessibilityLabel={`${prefix}remove-file-attachment-${entry().id}`}
                  onPress={() => props.onRemoveFile(entry().id)}
                  style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    borderRadius: radii.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  activeStyle={tactileActiveStyle(0.92)}
                  focusVisibleStyle={focusRingStyle()}
                >
                  <Icon name="close" size={11} color={palette().textMuted} />
                </View>
              </View>
            );
          }}
        </Each>

        <If when={noticeText().length > 0}>
          <Text
            style={{
              color: palette().warning,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {localizeHostError(noticeText())}
          </Text>
        </If>
      </View>
    </If>
  );
}

/**
 * Shared floating elevated composer container used identically by Primary, Secondary Split, and BTW panes.
 * Guarantees pixel-identical padding, width, radius, border, shadow, hover/focus ring, and drag feedback.
 */
function ComposerCardShell(props: {
  dragActive?: () => boolean;
  cardRef?: (el: ViewRef | null) => void;
  onLayoutWidth?: (width: number) => void;
  onFileDragEnter?: () => void;
  onFileDragLeave?: () => void;
  onFileDrop?: (event: { uris: string[]; mimeTypes: string[] }) => void;
  aboveCard?: JSX.Element;
  belowCard?: JSX.Element;
  children?: JSX.Element;
}) {
  const dragging = () => Boolean(props.dragActive?.());
  return (
    <View
      onLayout={
        props.onLayoutWidth
          ? event => {
              const w = event.bounds.size.width;
              if (w > 0) props.onLayoutWidth!(w);
            }
          : undefined
      }
      onFileDragEnter={props.onFileDragEnter}
      onFileDragLeave={props.onFileDragLeave}
      onFileDrop={props.onFileDrop}
      style={{
        paddingHorizontal: sessionsPadX(),
        paddingTop: space.chip,
        paddingBottom: space.lg,
        gap: space.chip,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: contentWidth(),
          alignSelf: "center",
          gap: space.chip,
        }}
      >
        {props.aboveCard}
        <View
          ref={el => props.cardRef?.(el)}
          style={{
            width: "100%",
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: dragging() ? palette().accent : palette().border,
            backgroundColor: dragging() ? palette().accentSoft : palette().inputBg,
            boxShadow: palette().shadowComposer,
            overflow: "hidden",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            borderColor: dragging() ? palette().accent : palette().borderStrong,
          }}
          focusWithinStyle={{
            borderColor: palette().fieldFocusBorder,
            boxShadow: palette().shadowComposerFocus,
          }}
        >
          {props.children}
        </View>
        {props.belowCard}
      </View>
    </View>
  );
}

/**
 * Shared Send / Stop primary action button used by Primary, Secondary Split, and BTW composers.
 */
function ComposerSubmitAction(props: {
  running: () => boolean;
  canSend: () => boolean;
  disabled?: () => boolean;
  compact?: () => boolean;
  sendLabel?: string;
  stopLabel?: string;
  onSend: () => void;
  onStop: () => void;
}) {
  const showStop = () => props.running() && !props.canSend();
  const isDisabled = () => Boolean(props.disabled?.()) || !props.canSend();
  const useTouch = () => Boolean(props.compact?.()) || compactLayout();
  return (
    <>
      <If when={showStop()}>
        <View style={{ flexShrink: 0, paddingLeft: props.compact?.() ? space.hair : space.xs }}>
          <If
            when={useTouch()}
            else={
              <View
                role="button"
                accessibilityLabel={props.stopLabel ?? "Stop"}
                tooltip={<TooltipBubble text={tr("sessions.stopTurn")} />}
                onPress={props.onStop}
                style={{
                  boxSizing: "border-box",
                  width: 32,
                  height: 32,
                  borderRadius: radii.pill,
                  backgroundColor: palette().actionPrimaryBg,
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().danger }}
                activeStyle={tactileActiveStyle(0.94)}
                focusVisibleStyle={focusRingStyle()}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2.5,
                    backgroundColor: palette().actionPrimaryFg,
                    pointerEvents: "none",
                  }}
                />
              </View>
            }
          >
            <View
              role="button"
              accessibilityLabel={props.stopLabel ?? "Stop"}
              onPress={props.onStop}
              style={{
                width: layout.touchTarget,
                height: layout.touchTarget,
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              activeStyle={tactileActiveStyle(0.94)}
              focusVisibleStyle={focusRingStyle(-4)}
            >
              <View
                style={{
                  boxSizing: "border-box",
                  width: 34,
                  height: 34,
                  borderRadius: radii.pill,
                  backgroundColor: palette().actionPrimaryBg,
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2.5,
                    backgroundColor: palette().actionPrimaryFg,
                  }}
                />
              </View>
            </View>
          </If>
        </View>
      </If>

      <If when={!showStop()}>
        <View style={{ flexShrink: 0, paddingLeft: props.compact?.() ? 0 : space.xs }}>
          <If
            when={Boolean(props.compact?.())}
            else={
              <IconCircleButton
                icon="arrow-up"
                variant={isDisabled() ? "subtle" : "primary"}
                size={32}
                iconSize={16}
                accessibilityLabel={props.sendLabel ?? "Send"}
                tooltip={tr("sessions.sendMessage")}
                disabled={isDisabled()}
                onPress={props.onSend}
              />
            }
          >
            <TouchTargetButton
              icon="arrow-up"
              tone={isDisabled() ? "subtle" : "primary"}
              disabled={isDisabled()}
              accessibilityLabel={props.sendLabel ?? "Send"}
              onPress={props.onSend}
            />
          </If>
        </View>
      </If>
    </>
  );
}

/** Shared file-URI drop handler reused by Primary, Secondary Split, and BTW composers. */
function handlePaneUriDrop(
  uris: string[],
  mimeTypes: string[],
  opts: {
    workspaceRoot: string;
    idPrefix: string;
    onAddImage: (item: ImageAttachment) => void;
    onAddFile: (item: FileAttachment) => void;
  },
): void {
  for (let i = 0; i < uris.length; i += 1) {
    const uri = uris[i];
    if (!uri) continue;
    const mime = mimeTypes[i] ?? "";
    const path = uri.startsWith("file://") ? pathOfFileUrl(uri) : uri;
    const name = basename(path) || `file-${i + 1}`;
    if (isImageMimeOrPath(mime, path)) {
      if (isLocalAttachmentPathAllowed()) {
        opts.onAddImage({
          id: `${opts.idPrefix}img-${++nextDroppedAttachmentId}`,
          name,
          mimeType: mime || mimeFromFilename(path),
          fileSize: 0,
          imagePath: path,
        });
      }
    } else {
      opts.onAddFile({
        id: `${opts.idPrefix}file-${++nextDroppedAttachmentId}`,
        name,
        path,
        relativePath: toRelativeWorkspacePath(path, opts.workspaceRoot),
        isDirectory: false,
        source: "file",
      });
    }
  }
}

/** Shared paste handler (images, files, URIs, and long-text auto-save) for Secondary Split and BTW composers. */
async function handlePanePaste(
  event: PasteEvent,
  opts: {
    workspaceId?: string;
    workspaceRoot: string;
    isRemote: boolean;
    idPrefix: string;
    onAddImage: (item: ImageAttachment) => void;
    onAddFile: (item: FileAttachment) => void;
    onInsertText: (text: string) => void;
    onFocusInput?: () => void;
  },
): Promise<void> {
  let handled = false;
  if (event.files && event.files.length > 0) {
    for (const file of event.files) {
      if (isImageMimeOrPath(file.type, file.name)) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mimeType = file.type || mimeFromFilename(file.name);
          opts.onAddImage({
            id: `${opts.idPrefix}paste-img-${++nextDroppedAttachmentId}`,
            name: file.name || `pasted-image-${nextDroppedAttachmentId}.png`,
            mimeType,
            fileSize: bytes.byteLength,
            dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
          });
          handled = true;
        } catch {
          // Fall through quietly.
        }
      } else if (
        file.type.startsWith("text/") ||
        /\.(md|txt|json|ts|tsx|js|jsx|rs|py|yml|yaml|toml|csv|log)$/i.test(file.name)
      ) {
        try {
          const content = await file.text();
          const saved = await saveLongTextPasteToWorkspace(content, {
            workspaceId: opts.workspaceId,
            workspaceRoot: opts.workspaceRoot,
            isRemote: opts.isRemote,
            fileName: file.name || undefined,
            skipPrimaryStore: true,
          });
          if (saved) {
            opts.onAddFile(saved);
            handled = true;
          }
        } catch {
          // Fall through quietly.
        }
      }
    }
  }
  if (event.uris && event.uris.length > 0) {
    handlePaneUriDrop(event.uris, [], opts);
    handled = true;
  }
  if (handled) return;
  const text = event.text ?? "";
  if (!text) return;
  if (isLongTextPaste(text)) {
    const saved = await saveLongTextPasteToWorkspace(text, {
      workspaceId: opts.workspaceId,
      workspaceRoot: opts.workspaceRoot,
      isRemote: opts.isRemote,
      skipPrimaryStore: true,
    });
    if (saved) {
      opts.onAddFile(saved);
      opts.onFocusInput?.();
      return;
    }
    pushToast(tr("sessions.pastedSaveFailed"), "warning");
  }
  opts.onInsertText(text);
}

interface SessionComposerProps {
  pane: 0 | 1 | "btw";
  sessionId: () => string | null;
  deviceId?: () => string;
  workspaceId?: () => string | null;
  draft: Signal<string>;
  placeholder: () => string;
  disabled?: () => boolean;
  running: () => boolean;
  canSend: () => boolean;
  compact?: () => boolean;
  images: () => ImageAttachment[];
  files: () => FileAttachment[];
  attachmentNotice?: () => string;
  attachmentIdPrefix?: string;
  onRemoveImage: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onFocusPane?: () => void;
  onPaste?: (event: PasteEvent, insertText: (text: string) => void) => void;
  dragActive?: Signal<boolean>;
  onFileDrop?: (event: { uris: string[]; mimeTypes: string[] }) => void;
  cardRef?: (el: ViewRef | null) => void;
  inputRef?: (el: InputRef | undefined) => void;
  autoFocus?: boolean;
  inputAccessibilityLabel: string;
  sendAccessibilityLabel: string;
  stopAccessibilityLabel: string;
  plusAccessibilityLabel: string;
  agentAccessibilityLabel?: string;
  modelAccessibilityLabel?: string;
  reasoningAccessibilityLabel?: string;
  permissionAccessibilityLabel?: string;
  contextAccessibilityLabel?: string;
  plusOpen?: Signal<boolean>;
  plusAnchor?: Signal<ViewRef | null>;
  onTogglePlus?: () => void;
  onPlusAnchorEl?: (el: ViewRef | null) => void;
  plusItems: (compact: boolean, anchor: () => ViewRef | null, close: () => void) => DropdownMenuItem[];
  showAgentPicker?: boolean;
  agentLocked?: () => boolean;
  showReasoning?: boolean;
  showPermissionShield?: boolean;
  onOpenPermissionPicker?: (anchor: ViewRef | null) => void;
  showContextRing?: boolean;
  promptSuggestion?: () => string;
  onAcceptPromptSuggestion?: () => void;
  onInputChange?: (value: string, caret: number) => void;
  onSelectionChange?: (end: number) => void;
  onCaretMove?: (bounds: Bounds) => void;
  onKeyPress?: (key: string) => void;
  onComposingChange?: (composing: boolean) => void;
  aboveCard?: JSX.Element;
  belowCard?: JSX.Element;
}

/**
 * Single unified composer component shared by Primary, Secondary Split, and BTW panes.
 * Every pane renders the exact same card shell, attachment strip,
 * multiline input geometry, toolbar rhythm, model capsule, and send/stop button.
 */
function SessionComposer(props: SessionComposerProps) {
  const paneWidth = signal(0);
  const localDrag = props.dragActive ?? signal(false);
  const localComposing = signal(false);
  const localPlusOpen = props.plusOpen ?? signal(false);
  const localPlusAnchor = props.plusAnchor ?? signal<ViewRef | null>(null);
  const isCompact = () => Boolean(props.compact?.());
  const collapseInline = () => isCompact() || (paneWidth() > 0 && paneWidth() < 420);
  const isDisabled = () => Boolean(props.disabled?.());
  const btwMode = props.pane === "btw";
  let localInputRef: InputRef | undefined;
  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  let lastTrackedText = props.draft();

  const applyDraftValue = (next: string, caret: number) => {
    selectionStart = caret;
    selectionEnd = caret;
    lastTrackedText = next;
    if (props.onInputChange) props.onInputChange(next, caret);
    else props.draft.set(next);
  };

  // Controlled insertion at the tracked selection range + caret restore via `setSelection`.
  // Avoids `InputRef.insertText`, which is unimplemented on NSH macOS and GPUI hosts.
  const insertTextAtSelection = (rawText: string) => {
    if (isDisabled()) return;
    const text = rawText.replace(/\r\n?/g, "\n");
    if (!text) return;
    const cur = props.draft();
    const selectionFresh = cur === lastTrackedText && selectionStart !== null && selectionEnd !== null;
    const start = selectionFresh ? Math.max(0, Math.min(cur.length, selectionStart!)) : cur.length;
    const end = selectionFresh ? Math.max(start, Math.min(cur.length, selectionEnd!)) : cur.length;
    const next = `${cur.slice(0, start)}${text}${cur.slice(end)}`;
    const caret = start + text.length;
    applyDraftValue(next, caret);
    queueMicrotask(() => {
      localInputRef?.focus();
      localInputRef?.setSelection(caret, caret);
    });
  };

  const closePlus = () => localPlusOpen.set(false);
  const togglePlus = () => {
    props.onFocusPane?.();
    if (props.onTogglePlus) {
      props.onTogglePlus();
    } else {
      localPlusOpen.update(v => !v);
    }
  };

  return (
    <View>
      <ComposerCardShell
        dragActive={localDrag}
        cardRef={props.cardRef}
        onLayoutWidth={w => {
          if (Math.abs(w - paneWidth()) > 1) paneWidth.set(w);
        }}
        onFileDragEnter={props.onFileDrop ? () => localDrag.set(true) : undefined}
        onFileDragLeave={props.onFileDrop ? () => localDrag.set(false) : undefined}
        onFileDrop={
          props.onFileDrop
            ? event => {
                localDrag.set(false);
                props.onFocusPane?.();
                props.onFileDrop!(event);
              }
            : undefined
        }
        aboveCard={props.aboveCard}
        belowCard={props.belowCard}
      >
        <ComposerAttachmentStrip
          images={props.images}
          files={props.files}
          notice={props.attachmentNotice}
          idPrefix={props.attachmentIdPrefix}
          onRemoveImage={props.onRemoveImage}
          onRemoveFile={props.onRemoveFile}
        />

        {/* Multiline Editor — identical geometry across Primary, Split, and BTW */}
        <View
          style={{
            paddingLeft: space.lg,
            paddingRight: collapseInline() ? space.sm : space.md,
            paddingTop: space.md,
            paddingBottom: space.xs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
            <Input
              ref={el => {
                localInputRef = el;
                props.inputRef?.(el);
              }}
              value={props.draft()}
              placeholder={props.placeholder()}
              accessibilityLabel={props.inputAccessibilityLabel}
              multiline={true}
              autoFocus={props.autoFocus}
              readonly={isDisabled()}
              submitBehavior="submit"
              pasteBehavior={props.onPaste ? "report" : undefined}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
                maxHeight: 160,
                fontSize: compactLayout() ? Math.max(16, textSize(15)) : textSize(15),
                lineHeight: compactLayout() ? textLineHeight(16, 1.5) : textLineHeight(15, 24 / 15),
                color: palette().text,
                placeholderColor: palette().textMuted,
                caretColor: palette().accent,
              }}
              onFocus={() => props.onFocusPane?.()}
              onChange={event => {
                const prev = props.draft();
                const next = event.value;
                const caret = next === prev ? (selectionEnd ?? next.length) : estimateCaretAfterEdit(prev, next);
                applyDraftValue(next, caret);
              }}
              onCompositionChange={event => {
                localComposing.set(event.composing);
                props.onComposingChange?.(event.composing);
              }}
              onSelectionChange={event => {
                selectionStart = event.start;
                selectionEnd = event.end;
                lastTrackedText = props.draft();
                props.onSelectionChange?.(event.end);
              }}
              onCaretMove={props.onCaretMove ? event => props.onCaretMove!(event.pageBounds) : undefined}
              onPaste={
                props.onPaste
                  ? event => {
                      if (!isDisabled()) props.onPaste!(event, insertTextAtSelection);
                    }
                  : undefined
              }
              onKeyPress={props.onKeyPress ? event => props.onKeyPress!(event.key) : undefined}
              onSubmit={() => {
                if (!localComposing()) props.onSubmit();
              }}
            />
            <If when={props.promptSuggestion?.() ?? ""}>
              <View
                role="button"
                accessibilityLabel="accept-prompt-suggestion"
                tooltip={<TooltipBubble text={tr("sessions.promptSuggestionAcceptTooltip")} />}
                onPress={() => props.onAcceptPromptSuggestion?.()}
                style={{
                  boxSizing: "border-box",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                  width: compactLayout() ? layout.touchTarget : 32,
                  height: compactLayout() ? layout.touchTarget : 22,
                  borderRadius: radii.pill,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceSubtle,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor: palette().panelHover,
                  borderColor: palette().borderStrong,
                }}
                activeStyle={tactileActiveStyle(0.95)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.15),
                    fontWeight: "500",
                    fontFamily: compactLayout() ? undefined : fontMono,
                  }}
                >
                  {compactLayout() ? tr("sessions.promptSuggestionUse") : "Tab"}
                </Text>
              </View>
            </If>
          </View>
        </View>

        {/* Unified Bottom Action Bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: collapseInline() ? space.xs : space.chip,
            paddingHorizontal: collapseInline() ? space.sm : space.md,
            paddingTop: space.xs,
            paddingBottom: space.sm,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              overflow: "hidden",
            }}
          >
            <View
              ref={el => {
                localPlusAnchor.set(el);
                props.onPlusAnchorEl?.(el);
              }}
              style={{ flexShrink: 0 }}
            >
              <If
                when={isCompact()}
                else={
                  <IconButton
                    icon="plus"
                    size="sm"
                    iconSize={15}
                    active={localPlusOpen()}
                    accessibilityLabel={props.plusAccessibilityLabel}
                    tooltip={tr("chat.polish.moreControls")}
                    style={{ borderRadius: radii.pill }}
                    onPress={togglePlus}
                  />
                }
              >
                <TouchTargetButton
                  icon="plus"
                  tone={localPlusOpen() ? "active" : "ghost"}
                  accessibilityLabel={props.plusAccessibilityLabel}
                  onPress={togglePlus}
                />
              </If>
            </View>
            <If when={!collapseInline()}>
              <View
                style={{
                  width: 1,
                  height: 14,
                  marginHorizontal: space.hair,
                  flexShrink: 0,
                  backgroundColor: palette().borderSubtle,
                }}
              />
              <If when={props.showAgentPicker !== false}>
                <AgentPickerTrigger
                  compact={isCompact}
                  sessionId={props.sessionId}
                  locked={props.agentLocked}
                  accessibilityLabel={props.agentAccessibilityLabel}
                  onFocusPane={props.onFocusPane}
                />
              </If>
              <ModelReasoningCapsule
                compact={isCompact}
                sessionId={props.sessionId}
                deviceId={props.deviceId}
                workspaceId={props.workspaceId}
                btwMode={btwMode}
                showReasoning={props.showReasoning}
                modelAccessibilityLabel={props.modelAccessibilityLabel}
                reasoningAccessibilityLabel={props.reasoningAccessibilityLabel}
                onFocusPane={props.onFocusPane}
              />
            </If>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexShrink: 0,
              gap: isCompact() ? space.hair : space.xs,
            }}
          >
            <If when={Boolean(props.showPermissionShield)}>
              <ComposerFullAccessShield
                sessionId={props.sessionId}
                compact={isCompact}
                accessibilityLabel={props.permissionAccessibilityLabel ?? "permission-mode-warning"}
                onPress={anchor => props.onOpenPermissionPicker?.(anchor)}
              />
            </If>
            <If when={Boolean(props.showContextRing) && !isCompact()}>
              <ContextUsageRing
                sessionId={props.sessionId}
                deviceId={props.deviceId}
                accessibilityLabel={props.contextAccessibilityLabel}
                onFocusPane={props.onFocusPane}
              />
            </If>
            <ComposerSubmitAction
              running={props.running}
              canSend={props.canSend}
              disabled={props.disabled}
              compact={isCompact}
              sendLabel={props.sendAccessibilityLabel}
              stopLabel={props.stopAccessibilityLabel}
              onSend={props.onSubmit}
              onStop={props.onStop}
            />
          </View>
        </View>
      </ComposerCardShell>

      <DropdownMenu
        open={localPlusOpen()}
        anchor={localPlusAnchor()}
        items={props.plusItems(collapseInline(), localPlusAnchor, closePlus)}
        placement="top"
        align="start"
        onClose={closePlus}
      />
    </View>
  );
}

/** Shared anchored composer popovers rendered once at scene level for Primary, Split, and BTW panes. */
function ComposerOverlays() {
  return (
    <>
      <If when={mentionOpen()}>
        <Overlay
          anchor={
            mentionInline() &&
            composerCaretBounds() &&
            composerCaretBounds()!.size.height > 0
              ? composerCaretBounds()
              : composerCardAnchor()
          }
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => mentionPlacement.set(pos.placement)}
          onPressOutside={closeMentionPopover}
          onCancel={closeMentionPopover}
        >
          <MentionPopoverSurface placement={mentionPlacement()} />
        </Overlay>
      </If>

      <If when={quickActionMenuOpen()}>
        <Overlay
          anchor={quickActionsAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => quickActionsPlacement.set(pos.placement)}
          onPressOutside={() => closePickers()}
          onCancel={() => closePickers()}
        >
          <QuickActionsSurface placement={quickActionsPlacement()} />
        </Overlay>
      </If>

      <If when={agentPickerOpen() && !agentModeLockedToSingle()}>
        <Overlay
          anchor={agentPickerAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => agentPickerPlacement.set(pos.placement)}
          onPressOutside={() => closePickers()}
          onCancel={() => closePickers()}
        >
          <AgentPickerSurface placement={agentPickerPlacement()} />
        </Overlay>
      </If>

      <If when={modelPickerOpen()}>
        <Overlay
          anchor={modelPickerAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => modelPickerPlacement.set(pos.placement)}
          onPressOutside={() => {
            modelPickerTarget.set(null);
            closePickers();
          }}
          onCancel={() => {
            modelPickerTarget.set(null);
            closePickers();
          }}
        >
          <ModelPickerSurface placement={modelPickerPlacement()} />
        </Overlay>
      </If>

      <If when={slashPopoverVisible()}>
        <Overlay
          anchor={composerCardAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => slashMenuPlacement.set(pos.placement)}
          onPressOutside={() => undefined}
          onCancel={() => composerText.set("")}
        >
          <SlashCommandSurface placement={slashMenuPlacement()} />
        </Overlay>
      </If>

      <If when={sessionCommandsUnsupported() && !slashPopoverVisible() && composerText().startsWith("/") && !/\s/.test(composerText()) && !mentionOpen()}>
        <Overlay
          anchor={composerCardAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => slashMenuPlacement.set(pos.placement)}
          onPressOutside={() => undefined}
          onCancel={() => composerText.set("")}
        >
          <SlashCommandsUnavailable placement={slashMenuPlacement()} />
        </Overlay>
      </If>

      <If when={permissionModePickerOpen()}>
        <Overlay
          anchor={permissionPillAnchor()}
          placement="top"
          align={permissionModeAlign()}
          offset={6}
          margin={8}
          onPosition={pos => permissionModePlacement.set(pos.placement)}
          onPressOutside={() => {
            permissionModePickerOpen.set(false);
            permissionModeTarget.set(null);
            permissionModePlacement.set("top");
          }}
          onCancel={() => {
            permissionModePickerOpen.set(false);
            permissionModeTarget.set(null);
            permissionModePlacement.set("top");
          }}
        >
          <PermissionModeSurface placement={permissionModePlacement()} align={permissionModeAlign()} />
        </Overlay>
      </If>

      <If when={contextPopoverOpen()}>
        <Overlay
          anchor={contextRingAnchor()}
          placement="top"
          align={contextUsageAlign()}
          offset={6}
          margin={8}
          onPosition={pos => contextUsagePlacement.set(pos.placement)}
          onPressOutside={() => {
            contextPopoverOpen.set(false);
            contextTargetSessionId.set(null);
            contextUsagePlacement.set("top");
          }}
          onCancel={() => {
            contextPopoverOpen.set(false);
            contextTargetSessionId.set(null);
            contextUsagePlacement.set("top");
          }}
        >
          <ContextUsageSurface placement={contextUsagePlacement()} align={contextUsageAlign()} />
        </Overlay>
      </If>

      <If when={reasoningPickerOpen()}>
        <Overlay
          anchor={reasoningPickerAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPosition={pos => reasoningPickerPlacement.set(pos.placement)}
          onPressOutside={() => {
            modelPickerTarget.set(null);
            closePickers();
          }}
          onCancel={() => {
            modelPickerTarget.set(null);
            closePickers();
          }}
        >
          <ReasoningPickerSurface placement={reasoningPickerPlacement()} />
        </Overlay>
      </If>
    </>
  );
}

/** Shared outer pane shell reused identically by Primary, Secondary Split, and BTW sessions. */
function SessionPaneShell(props: {
  testID?: string;
  accessibilityLabel?: string;
  style: () => ViewStyle;
  interactive?: () => boolean;
  onInteract?: () => void;
  onPress?: () => (() => void) | undefined;
  header?: JSX.Element;
  banners?: JSX.Element;
  transcript: JSX.Element;
  preComposer?: JSX.Element;
  composer?: JSX.Element;
}) {
  const active = () => (props.interactive ? props.interactive() : true);
  return (
    <View
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      focusable={false}
      onTouchStartCapture={active() ? props.onInteract : undefined}
      onPressDown={active() ? props.onInteract : undefined}
      onPress={active() && props.onPress ? props.onPress() : undefined}
      onMouseUp={active() ? props.onInteract : undefined}
      onKeyDown={active() ? props.onInteract : undefined}
      style={{
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: palette().canvas,
        ...props.style(),
      }}
    >
      {props.header}
      {props.banners}
      {props.transcript}
      {props.preComposer}
      {props.composer}
    </View>
  );
}

function ComposerDock() {
  ensureModelsLoaded();
  ensureQuickActions();
  ensurePromptSuggestionSettingLoaded();
  subscribeContextUsage();
  effect(() => {
    const id = activeSessionId();
    activeWorkspaceId();
    if (id) void loadSessionPermissionMode(id);
  });
  effect(() => {
    const id = activeSessionId();
    if (id) void loadQueueForSession(id);
    void loadSessionCommands(id);
  });
  effect(() => {
    const id = activeSessionId();
    const wsId = activeWorkspaceId();
    const wsRoot = activeWorkspaceRoot();
    const modeId = agentTypeOf(id);
    if (id && composerText().startsWith("/")) void loadSlashSkills(modeId, wsId, wsRoot);
  });
  effect(() => {
    activeSessionId();
    activeWorkspaceId();
    ensureAgentModes();
  });
  effect(() => {
    activeSessionId();
    activeModelId();
    void ensureReasoningLoaded();
  });
  effect(() => {
    composerText();
    slashSelectedIndex.set(0);
  });
  effect(() => {
    mentionQuery();
    mentionBrowseDir();
    mentionOpen();
    mentionSelectedIndex.set(0);
  });

  const hasPayload = () =>
    composerText().trim().length > 0 || imageAttachments().length > 0 || fileAttachments().length > 0;

  return (
    <SessionComposer
      pane={0}
      sessionId={activeSessionId}
      deviceId={activeSessionDevice}
      workspaceId={activeWorkspaceId}
      draft={composerText}
      placeholder={() =>
        composerDisabled()
          ? offlineNoticeText() || tr("sessions.noSessionSelected")
          : runningTurnId()
            ? midTurnSendPolicy() === "queue"
              ? tr("sessions.composerQueuePlaceholder")
              : tr("session.placeholderRunning")
            : activePromptSuggestion() || tr("session.placeholder")
      }
      disabled={composerDisabled}
      running={() => Boolean(runningTurnId())}
      canSend={hasPayload}
      compact={sessionsCompact}
      images={imageAttachments}
      files={fileAttachments}
      attachmentNotice={attachmentNotice}
      onRemoveImage={id => removeAttachment(id)}
      onRemoveFile={id => removeFileAttachment(id)}
      onSubmit={() => void submitComposer()}
      onStop={() => void stopRunningTurn()}
      onFocusPane={() => {
        if (splitPaneOpen()) focusPane(0);
      }}
      onPaste={(event, insertText) => void handleComposerPaste(event, insertText)}
      dragActive={composerFileDragActive}
      onFileDrop={event => handleComposerFileDrop(event)}
      cardRef={el => composerCardAnchor.set(el)}
      inputRef={el => {
        composerInputRef = el;
      }}
      inputAccessibilityLabel="composer"
      sendAccessibilityLabel="Send"
      stopAccessibilityLabel="Stop"
      plusAccessibilityLabel="composer-plus"
      agentAccessibilityLabel="agent-picker"
      modelAccessibilityLabel="bot-capsule-trigger"
      reasoningAccessibilityLabel="reasoning-picker"
      permissionAccessibilityLabel="permission-mode-warning"
      contextAccessibilityLabel="context-usage"
      plusOpen={composerPlusOpen}
      plusAnchor={composerPlusAnchor}
      onTogglePlus={toggleComposerPlus}
      onPlusAnchorEl={el => {
        quickActionsAnchor.set(el);
        permissionPillAnchor.set(el);
      }}
      plusItems={compact => composerPlusItems(compact)}
      showAgentPicker={true}
      showReasoning={true}
      showPermissionShield={true}
      onOpenPermissionPicker={anchor => {
        permissionModeTarget.set(null);
        permissionPillAnchor.set(anchor);
        permissionModeAlign.set("end");
        const next = !permissionModePickerOpen();
        closePickers();
        permissionModePickerOpen.set(next);
      }}
      showContextRing={true}
      promptSuggestion={activePromptSuggestion}
      onAcceptPromptSuggestion={acceptActivePromptSuggestion}
      onInputChange={(next, caret) => {
        composerText.set(next);
        composerCaretPos.set(caret);
        syncInlineMention(next, caret);
      }}
      onComposingChange={composing => composerComposing.set(composing)}
      onSelectionChange={end => {
        composerCaretPos.set(end);
        syncInlineMention(composerText(), end, true);
      }}
      onCaretMove={bounds => composerCaretBounds.set(bounds)}
      onKeyPress={key => {
        if (mentionOpen() && mentionInline()) {
          handleMentionKeyNavigation(key);
          return;
        }
        if (slashPopoverVisible() && handleSlashKeyNavigation(key)) {
          return;
        }
        if (
          !composerComposing() &&
          !composerText() &&
          (key === "Tab" || key === "ArrowRight")
        ) {
          acceptActivePromptSuggestion();
        }
      }}
      aboveCard={
        <>
          <If when={pendingAgentSession()}>
            {mode => (
              <InlineBanner
                tone="info"
                icon="bot"
                message={tr("sessions.switchAgentPrompt", {
                  current: agentLabel(agentTypeOf(activeSessionId())),
                  next: agentLabel(mode()),
                })}
                action={
                  <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.chip }}>
                    <Button
                      label={tr("sessions.startSession")}
                      variant="primary"
                      size="xs"
                      pill={true}
                      style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                      onPress={() => void startSessionAs(mode())}
                    />
                    <Button
                      label={tr("common.cancel")}
                      variant="ghost"
                      size="xs"
                      style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                      onPress={() => pendingAgentSession.set(null)}
                    />
                  </View>
                }
              />
            )}
          </If>
          <QueueHostNotice />
          <QueuedPanel />
        </>
      }
      belowCard={
        <If when={composerDisabled()}>
          <View style={{ paddingHorizontal: space.chip, flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                ...textStyle("caption"),
                flex: 1,
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {offlineNoticeText() || tr("sessions.noSessionSelected")}
            </Text>
          </View>
        </If>
      }
    />
  );
}

/** Compact readable agent selector pill matching Codex / Claude Desktop composer chrome. */
function agentModeIcon(mode: string | null | undefined): IconName {
  const lower = (mode ?? "").toLowerCase();
  if (lower.includes("minimal") || lower.includes("fast")) return "zap";
  if (lower.includes("creative")) return "sparkles";
  if (lower.includes("ultimate") || lower.includes("plan")) return "layers";
  return "bot";
}

function AgentPickerTrigger(props: {
  compact: () => boolean;
  sessionId?: () => string | null;
  locked?: () => boolean;
  accessibilityLabel?: string;
  onFocusPane?: () => void;
}) {
  let triggerRef: ViewRef | null = null;
  const locked = () => (props.locked ? props.locked() : agentModeLockedToSingle());
  const modeType = () => agentTypeOf((props.sessionId ?? activeSessionId)());
  const label = props.accessibilityLabel ?? "agent-picker";
  return (
    <If
      when={locked()}
      else={
        <View
          ref={el => {
            triggerRef = el;
            if (!props.onFocusPane) agentPickerAnchor.set(el);
          }}
          role="button"
          accessibilityLabel={label}
          tooltip={
            <TooltipBubble
              text={tr("sessions.agentLabel", { name: agentLabel(modeType()) })}
            />
          }
          onPress={() => {
            props.onFocusPane?.();
            agentPickerAnchor.set(triggerRef);
            const next = !agentPickerOpen();
            closePickers(next ? "agent" : undefined);
            agentPickerOpen.set(next);
          }}
          style={{
            height: 28,
            minWidth: 0,
            flexShrink: 1,
            maxWidth: props.compact() ? 120 : 148,
            paddingHorizontal: space.sm,
            borderRadius: radii.pill,
            borderWidth: 1,
            borderColor: agentPickerOpen() ? palette().border : "transparent",
            backgroundColor: agentPickerOpen() ? palette().surfaceSubtle : "transparent",
            flexDirection: "row",
            alignItems: "center",
            gap: space.chip,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            backgroundColor: palette().surfaceSubtle,
            borderColor: palette().borderSubtle,
          }}
          activeStyle={tactileActiveStyle(0.96)}
          focusVisibleStyle={focusRingStyle(-1)}
        >
          <Icon name={agentModeIcon(modeType())} size={13} color={palette().textMuted} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
              fontWeight: "500",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {agentLabel(modeType())}
          </Text>
        </View>
      }
    >
      <View
        accessibilityLabel={label}
        tooltip={
          <TooltipBubble
            text={tr("sessions.agentLabel", { name: agentLabel(modeType()) })}
          />
        }
        style={{
          height: 28,
          minWidth: 0,
          flexShrink: 1,
          maxWidth: props.compact() ? 120 : 148,
          paddingHorizontal: space.sm,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: space.chip,
          userSelect: "none",
        }}
      >
        <Icon name={agentModeIcon(modeType())} size={13} color={palette().textMuted} />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {agentLabel(modeType())}
        </Text>
      </View>
    </If>
  );
}

type ComposerModelTarget =
  | { kind: "session"; sessionId: string | null; deviceId?: string; workspaceId?: string | null }
  | { kind: "btw" };

const modelPickerTarget = signal<ComposerModelTarget | null>(null);

function pickerTargetModelId(): string | null {
  const target = modelPickerTarget();
  if (target?.kind === "btw") {
    return sideQuestionModelOverride() ?? modelIdForSession(activeSessionId(), activeSessionDevice());
  }
  if (target?.kind === "session") {
    return modelIdForSession(target.sessionId, target.deviceId);
  }
  return activeModelId();
}

function pickerTargetReasoningId(): string | null {
  const target = modelPickerTarget();
  if (target?.kind === "session") {
    return reasoningIdForSession(target.sessionId, target.deviceId);
  }
  return activeReasoningId();
}

function pickerTargetReasoningChoices() {
  const target = modelPickerTarget();
  if (target?.kind === "session") {
    return reasoningChoicesForSession(target.sessionId, target.deviceId);
  }
  return activeReasoningChoices();
}

function selectModelForPickerTarget(modelId: string): void {
  const target = modelPickerTarget();
  if (target?.kind === "btw") {
    sideQuestionModelOverride.set(modelId);
    modelPickerOpen.set(false);
    modelPickerTarget.set(null);
    return;
  }
  const sessionTarget: SessionModelTarget | undefined =
    target?.kind === "session"
      ? { sessionId: target.sessionId, deviceId: target.deviceId, workspaceId: target.workspaceId }
      : undefined;
  modelPickerTarget.set(null);
  void chooseModel(modelId, sessionTarget);
}

function selectReasoningForPickerTarget(presetId: string | null): void {
  const target = modelPickerTarget();
  const sessionTarget: SessionModelTarget | undefined =
    target?.kind === "session"
      ? { sessionId: target.sessionId, deviceId: target.deviceId, workspaceId: target.workspaceId }
      : undefined;
  modelPickerTarget.set(null);
  void chooseReasoning(presetId, sessionTarget);
}

/** Compact icon-anchored Model pill paired with a quiet icon-first Reasoning toggle. */
function ModelReasoningCapsule(props: {
  compact: () => boolean;
  sessionId?: () => string | null;
  deviceId?: () => string;
  workspaceId?: () => string | null;
  btwMode?: boolean;
  showReasoning?: boolean;
  modelAccessibilityLabel?: string;
  reasoningAccessibilityLabel?: string;
  onFocusPane?: () => void;
}) {
  let modelTriggerRef: ViewRef | null = null;
  let reasoningTriggerRef: ViewRef | null = null;
  const resolvedText = computed(() => {
    if (props.btwMode) {
      const override = sideQuestionModelOverride();
      if (override) {
        const remote = fleetChoiceOf(override);
        if (remote) {
          const text = fleetModelText(remote.choice);
          return remote.device.isThisDevice ? text : { label: `${text.label} · ${remote.device.name}`, detail: text.detail };
        }
        const match = chatModels().find(option => option.id === override || option.modelName === override);
        if (match) return { label: match.label, detail: match.detail };
        return { label: override, detail: "" };
      }
      return modelTextForSession(activeSessionId(), activeSessionDevice());
    }
    return props.sessionId
      ? modelTextForSession(props.sessionId(), props.deviceId?.())
      : { label: activeModelLabel(), detail: activeModelDetail() };
  });
  const choices = computed(() =>
    props.showReasoning === false
      ? []
      : props.sessionId
        ? reasoningChoicesForSession(props.sessionId(), props.deviceId?.())
        : activeReasoningChoices(),
  );
  const reasoningId = computed(() =>
    props.sessionId ? reasoningIdForSession(props.sessionId(), props.deviceId?.()) : activeReasoningId(),
  );
  const reasoningLabel = computed(() =>
    props.sessionId ? reasoningLabelForSession(props.sessionId(), props.deviceId?.()) : activeReasoningLabel(),
  );
  const reasoningElevated = computed(() => {
    const id = reasoningId();
    return Boolean(id && id !== "default");
  });
  const currentTarget = (): ComposerModelTarget =>
    props.btwMode
      ? { kind: "btw" }
      : {
          kind: "session",
          sessionId: props.sessionId ? props.sessionId() : activeSessionId(),
          deviceId: props.deviceId ? props.deviceId() : activeSessionDevice(),
          workspaceId: props.workspaceId ? props.workspaceId() : activeWorkspaceId(),
        };
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: props.compact() ? 56 : 72,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
      }}
    >
      <View
        ref={el => {
          modelTriggerRef = el;
          if (!props.onFocusPane && !props.btwMode) modelPickerAnchor.set(el);
        }}
        role="button"
        accessibilityLabel={props.modelAccessibilityLabel ?? "bot-capsule-trigger"}
        tooltip={
          <TooltipBubble
            text={tr("sessions.modelLabel", {
              name: resolvedText().detail ? `${resolvedText().label} · ${resolvedText().detail}` : resolvedText().label,
            })}
          />
        }
        onPress={() => {
          props.onFocusPane?.();
          modelPickerTarget.set(currentTarget());
          modelPickerAnchor.set(modelTriggerRef);
          const next = !modelPickerOpen();
          closePickers(next ? "model" : undefined);
          modelPickerOpen.set(next);
          // Other devices' models may have come or gone since the last read.
          if (next) void refreshFleetModels();
        }}
        style={{
          height: 28,
          minWidth: props.compact() ? 52 : 64,
          flexShrink: 1,
          maxWidth: props.compact() ? 172 : 216,
          paddingHorizontal: space.sm,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: modelPickerOpen() ? palette().border : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: space.chip,
          backgroundColor: modelPickerOpen() ? palette().surfaceSubtle : "transparent",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor: palette().surfaceSubtle,
          borderColor: palette().borderSubtle,
        }}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <Icon name="cpu" size={13} color={palette().textMuted} />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().text,
            fontSize: textSize(12.5),
            lineHeight: textLineHeight(12.5, 1.35),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {resolvedText().label}
        </Text>
        <Icon
          name={modelPickerOpen() ? "chevron-up" : "chevron-down"}
          size={10}
          color={palette().textMuted}
        />
      </View>

      <If when={choices().length > 0}>
        <View
          ref={el => {
            reasoningTriggerRef = el;
            if (!props.onFocusPane && !props.btwMode) reasoningPickerAnchor.set(el);
          }}
          role="button"
          accessibilityLabel={props.reasoningAccessibilityLabel ?? "reasoning-picker"}
          tooltip={
            <TooltipBubble
              text={tr("sessions.reasoningLabel", { name: reasoningLabel() })}
            />
          }
          onPress={() => {
            props.onFocusPane?.();
            modelPickerTarget.set(currentTarget());
            reasoningPickerAnchor.set(reasoningTriggerRef);
            const next = !reasoningPickerOpen();
            closePickers(next ? "reasoning" : undefined);
            reasoningPickerOpen.set(next);
          }}
          style={{
            height: 28,
            width: reasoningElevated() ? undefined : 28,
            minWidth: 28,
            flexShrink: 0,
            maxWidth: 100,
            paddingHorizontal: reasoningElevated() ? space.sm : 0,
            borderRadius: radii.pill,
            borderWidth: 1,
            borderColor: reasoningPickerOpen()
              ? palette().border
              : reasoningElevated()
                ? palette().accentBorder
                : "transparent",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.xs,
            backgroundColor: reasoningPickerOpen()
              ? palette().surfaceSubtle
              : reasoningElevated()
                ? palette().accentSoft
                : "transparent",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            backgroundColor: reasoningElevated() ? palette().accentSoft : palette().surfaceSubtle,
            borderColor: reasoningElevated() ? palette().accent : palette().borderSubtle,
          }}
          activeStyle={tactileActiveStyle(0.95)}
          focusVisibleStyle={focusRingStyle(-1)}
        >
          <Icon
            name="bulb"
            size={reasoningElevated() ? 12 : 14}
            color={reasoningElevated() ? palette().accent : palette().textMuted}
          />
          <If when={reasoningElevated()}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().accent,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.3),
                fontWeight: "600",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {reasoningLabel()}
            </Text>
          </If>
        </View>
      </If>
    </View>
  );
}

function MentionPopoverSurface(props: { placement: Placement }) {
  // Inline `@` mention is keyboard-triggered (100+/day) -> zero animation (Raycast/autocomplete bar).
  const isInline = mentionInline();
  let motion: Motion | null = null;
  if (isInline) {
    cleanup(registerEscapeDismiss(closeMentionPopover));
  } else {
    motion = usePopoverMotion(() => props.placement, "start", closeMentionPopover);
  }
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 440,
          maxWidth: "92%",
          gap: space.sm,
          padding: space.sm,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion ? motion.style : undefined,
      ]}
    >
      <If when={!mentionInline()}>
        <InputBox
          value={mentionQuery()}
          autoFocus={true}
          size="sm"
          leadingIcon="search"
          placeholder={tr("sessions.searchFilesPlaceholder")}
          accessibilityLabel="mention-query"
          onChange={value => setMentionQuery(value)}
          onKeyPress={event => handleMentionKeyNavigation(event.key)}
          onSubmit={() => {
            const hits = mentionHits();
            if (hits.length === 0) return;
            const idx = Math.max(0, Math.min(mentionSelectedIndex(), hits.length - 1));
            const chosen = hits[idx] ?? hits[0];
            if (chosen) insertMention(chosen, composerInputRef);
          }}
        />
      </If>
      <If when={!mentionQuery().trim()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
          }}
        >
          <If when={mentionBrowseDir().length > 0}>
            <IconButton
              icon="arrow-left"
              size="xs"
              accessibilityLabel="mention-browse-up"
              tooltip={tr("common.back")}
              onPress={browseMentionParent}
            />
          </If>
          <Icon name="folder" size={12} color={palette().textElevatedMuted} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().textElevatedMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
              fontWeight: "500",
              numberOfLines: 1,
              textOverflow: "ellipsis-middle",
            }}
          >
            {mentionBrowseDir()
              ? toRelativeWorkspacePath(mentionBrowseDir(), activeWorkspaceRoot()) || mentionBrowseDir()
              : activeWorkspace()?.name || tr("sessions.mentionRootLabel")}
          </Text>
        </View>
      </If>
      <If when={mentionLoading()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <BrandSpinner size={12} color={palette().accent} variant="matrix" />
          <Text
            style={{
              color: palette().textElevatedMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {tr("sessions.searchingFiles")}
          </Text>
        </View>
      </If>
      <If when={mentionNotice().length > 0}>
        <Text
          style={{
            color: palette().warning,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
          }}
        >
          {localizeHostError(mentionNotice())}
        </Text>
      </If>
      <If
        when={
          !mentionLoading() &&
          !mentionNotice() &&
          mentionSearched() &&
          mentionQuery().trim().length > 0 &&
          mentionHits().length === 0
        }
      >
        <Text
          style={{
            color: palette().textElevatedMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
          }}
        >
          {tr("sessions.mentionNoMatch", { query: mentionQuery().trim() })}
        </Text>
      </If>
      <If
        when={
          !mentionLoading() &&
          !mentionNotice() &&
          !mentionQuery().trim() &&
          mentionHits().length === 0
        }
      >
        <Text
          style={{
            color: palette().textElevatedMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
          }}
        >
          {tr("sessions.mentionEmptyDir")}
        </Text>
      </If>
      <If when={mentionTruncated()}>
        <Text
          style={{
            color: palette().textElevatedMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
          }}
        >
          {tr("sessions.moreMatchesHint")}
        </Text>
      </If>
      <If when={mentionHits().length > 0}>
        <Scroll smoothWheel style={{ maxHeight: 240, minHeight: 0 }} scrollbar={true}>
          <View style={{ gap: space.hair }}>
            <Each of={mentionHits()} key={hit => hit.path}>
              {(hit, idx) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.hair,
                    borderRadius: radii.xs,
                    borderCurve: "continuous",
                    backgroundColor: idx() === mentionSelectedIndex() ? listRowHoverBg() : "transparent",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: listRowHoverBg() }}
                >
                  <View
                    role="button"
                    accessibilityLabel={`mention-option-${hit().name}`}
                    onPress={() => insertMention(hit(), composerInputRef)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      minHeight: compactLayout() ? layout.touchTarget : controlHeight.md,
                      paddingHorizontal: space.sm,
                      paddingVertical: 7,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    activeStyle={{ opacity: 0.9 }}
                    focusVisibleStyle={focusRingStyle(-1)}
                  >
                    <ListRowContent
                      icon={hit().directory ? "folder" : "file-code"}
                      iconColor={palette().textSecondary}
                      title={hit().name}
                      titleWeight="500"
                      subtitle={hit().relativePath || hit().path}
                      subtitleOverflow="ellipsis-middle"
                    />
                  </View>
                  <If when={hit().directory}>
                    <View
                      style={{
                        paddingTop: Math.max(0, 7 + listRowTitleLineHeight() / 2 - controlHeight.xs / 2),
                        paddingRight: space.xs,
                      }}
                    >
                      <IconButton
                        icon="chevron-right"
                        size="xs"
                        accessibilityLabel={`mention-browse-${hit().name}`}
                        tooltip={tr("sessions.mentionBrowseDir")}
                        onPress={() => browseMentionDir(hit().path)}
                      />
                    </View>
                  </If>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
      </If>
    </View>
  );
}

function QuickActionsSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => closePickers());
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 248,
          maxWidth: 320,
          gap: space.sm,
          padding: space.md,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "500",
        }}
      >
        {tr("sessions.quickActions")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.chip }}>
        <Each of={enabledQuickActions()} key={action => action.id}>
          {action => (
            <Button
              label={action().label}
              variant="secondary"
              size="xs"
              pill={true}
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => void runQuickAction(action().id)}
            />
          )}
        </Each>
      </View>
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
        }}
      >
        {runningTurnId()
          ? tr("sessions.quickActionWaitHint")
          : tr("sessions.quickActionHint")}
      </Text>
    </View>
  );
}

function agentDescriptionFor(choice: AgentChoice): string {
  const normalized = choice.id.trim().toLowerCase();
  const useLocalizedBuiltin = currentLocale() !== "en-US" || !choice.description;
  if (normalized === "minimal") {
    return useLocalizedBuiltin ? tr("agents.modeMinimalDesc") : choice.description;
  }
  if (normalized === "standard" || normalized === "agentic" || normalized === "balanced") {
    return useLocalizedBuiltin ? tr("agents.modeStandardDesc") : choice.description;
  }
  if (normalized === "ultimate" || normalized === "ultra") {
    return useLocalizedBuiltin ? tr("agents.modeUltimateDesc") : choice.description;
  }
  if (normalized === "creative") {
    return useLocalizedBuiltin ? tr("agents.modeCreativeDesc") : choice.description;
  }
  return choice.description;
}

function AgentRow(props: { choice: AgentChoice }) {
  const current = () => agentIdsMatch(agentTypeOf(activeSessionId()), props.choice.id);
  const desc = () => agentDescriptionFor(props.choice);
  return (
    <View
      role="button"
      accessibilityLabel={`agent-option-${props.choice.id}`}
      accessibilityState={{ selected: current() }}
      onPress={() => void chooseAgentMode(props.choice.id)}
      style={popoverRowStyle()}
      hoverStyle={popoverRowHoverStyle()}
      activeStyle={popoverRowActiveStyle()}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <ListRowContent
        title={props.choice.label}
        titleWeight={current() ? "500" : "400"}
        subtitle={desc()}
        trailing={
          current() ? (
            <View accessibilityLabel={`✓ ${props.choice.label}`} style={{ flexShrink: 0 }}>
              <PopoverCheck />
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

function AgentPickerSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => closePickers());
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 320,
          maxWidth: "92%",
          gap: space.xs,
          padding: POPOVER_PADDING,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Scroll smoothWheel style={{ maxHeight: 332, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.xs }}>
          <If when={agentProfiles().length > 0}>
            <View style={{ gap: space.hair }}>
              <PopoverSectionHeader label={tr("sessions.profiles")} />
              <Each of={agentProfiles()} key={choice => choice.id}>
                {choice => <AgentRow choice={choice()} />}
              </Each>
            </View>
          </If>
          <If when={agentAgents().length > 0}>
            <View
              style={{
                gap: space.hair,
                ...(agentProfiles().length > 0
                  ? {
                      paddingTop: space.xs,
                      borderTopWidth: 1,
                      borderColor: palette().borderSubtle,
                    }
                  : {}),
              }}
            >
              <PopoverSectionHeader label={tr("sessions.agents")} />
              <Each of={agentAgents()} key={choice => choice.id}>
                {choice => <AgentRow choice={choice()} />}
              </Each>
            </View>
          </If>
        </View>
      </Scroll>
      <View
        style={{
          paddingHorizontal: space.sm,
          paddingTop: space.sm,
          paddingBottom: space.xs,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
          gap: space.chip,
        }}
      >
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.38),
          }}
        >
          {activeSessionStarted()
            ? tr("sessions.agentPickerStartedHint")
            : tr("sessions.agentPickerNewHint")}
        </Text>
        <If when={agentCatalogNotice().length > 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().warning,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
              }}
            >
              {localizeHostError(agentCatalogNotice())}
            </Text>
            <Button
              label={tr("common.reload")}
              variant="secondary"
              size="xs"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => reloadAgentModes()}
            />
          </View>
        </If>
        <If when={agentNotice().length > 0}>
          <Text
            style={{
              color: palette().danger,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {localizeHostError(agentNotice())}
          </Text>
        </If>
      </View>
    </View>
  );
}

function ModelPickerSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => closePickers());
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 344,
          maxWidth: "92%",
          padding: POPOVER_PADDING,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <PopoverSectionHeader label={tr("sessions.model")} />
      <If when={fleetModelGroups()}>
        {groups => <FleetModelList groups={groups()} />}
      </If>
      <If when={!fleetModelGroups()}>
        <Scroll smoothWheel style={{ maxHeight: 240, minHeight: 0 }} scrollbar={true}>
          <View style={{ gap: space.hair }}>
            <Each of={chatModels()} key="index">
              {option => (
                <View
                  role="button"
                  accessibilityLabel={`model-option-${option().id}`}
                  onPress={() => selectModelForPickerTarget(option().id)}
                  style={popoverRowStyle()}
                  hoverStyle={popoverRowHoverStyle()}
                  activeStyle={popoverRowActiveStyle()}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <ModelRowText
                    active={option().id === pickerTargetModelId()}
                    label={option().label}
                    detail={option().detail}
                  />
                </View>
              )}
            </Each>
          </View>
        </Scroll>
      </If>
    </View>
  );
}

/** Why a device's models cannot be picked, as the backend said (`unavailableReason`). */
function deviceModelsNote(device: FleetModelsDevice): string {
  switch (device.unavailableReason) {
    case "device_offline":
      return tr("models.deviceOffline");
    case "device_requires_update":
      return tr("models.deviceRequiresUpdate");
    case "no_model":
      return tr("models.deviceNoModel");
    default:
      return "";
  }
}

/** Every device's models in the entry's order, one header per device. */
function FleetModelList(props: { groups: FleetModelsDevice[] }) {
  return (
    <Scroll smoothWheel style={{ maxHeight: 320, minHeight: 0 }} scrollbar={true}>
      <View style={{ gap: space.hair }}>
        <Each of={props.groups} key="index">
          {(device, idx) => (
            <View testID={`model-device-${device().deviceId}`} style={{ gap: space.hair }}>
              <If when={idx() > 0}>
                <PopoverSeparator />
              </If>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.sm,
                  paddingTop: space.xs,
                  paddingBottom: space.xs,
                }}
              >
                <Text
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.3),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {device().isThisDevice ? `${device().name} · ${tr("models.thisDevice")}` : device().name}
                </Text>
                <If when={deviceModelsNote(device())}>
                  <Text
                    testID={`model-device-note-${device().deviceId}`}
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      marginLeft: "auto",
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.3),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {deviceModelsNote(device())}
                  </Text>
                </If>
              </View>
              <Each of={device().models} key="index">
                {choice => <FleetModelRow choice={choice()} />}
              </Each>
            </View>
          )}
        </Each>
      </View>
    </Scroll>
  );
}

/**
 * A model row's text: the model on the title line, its provider under it in the
 * muted subtitle style, both as the host labelled them. The current model carries
 * a check and medium weight on the title line; `trailing` adds marks before it.
 */
function ModelRowText(props: { active: boolean; label: string; detail: string; trailing?: JSX.Element }) {
  return (
    <ListRowContent
      title={props.label}
      titleWeight={props.active ? "500" : "400"}
      subtitle={props.detail}
      trailing={
        props.active || props.trailing ? (
          <>
            {props.trailing}
            <If when={props.active}>
              <PopoverCheck />
            </If>
          </>
        ) : undefined
      }
    />
  );
}

function FleetModelRow(props: { choice: FleetModelChoice }) {
  const active = () => props.choice.modelRef === pickerTargetModelId();
  return (
    <View
      role="button"
      accessibilityLabel={`model-option-${props.choice.modelRef}`}
      disabled={!props.choice.selectable}
      accessibilityState={{ disabled: !props.choice.selectable, selected: active() }}
      onPress={() => {
        if (props.choice.selectable) selectModelForPickerTarget(props.choice.modelRef);
      }}
      style={popoverRowStyle(false, !props.choice.selectable)}
      hoverStyle={popoverRowHoverStyle(!props.choice.selectable)}
      activeStyle={props.choice.selectable ? popoverRowActiveStyle() : {}}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <ModelRowText
        active={active()}
        label={fleetModelText(props.choice).label}
        detail={fleetModelText(props.choice).detail}
        trailing={
          props.choice.primary ? (
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
              {tr("models.primary")}
            </Text>
          ) : undefined
        }
      />
    </View>
  );
}

function ReasoningPickerSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => closePickers());
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 228,
          maxWidth: 300,
          padding: POPOVER_PADDING,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <PopoverSectionHeader label={tr("sessions.reasoning")} />
      <Scroll smoothWheel style={{ maxHeight: 208, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.hair }}>
          <View
            role="button"
            accessibilityLabel="reasoning-option-default"
            onPress={() => selectReasoningForPickerTarget(null)}
            style={popoverRowStyle()}
            hoverStyle={popoverRowHoverStyle()}
            activeStyle={popoverRowActiveStyle()}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <ListRowContent
              title={tr("common.default")}
              titleWeight={pickerTargetReasoningId() === null ? "500" : "400"}
              trailing={pickerTargetReasoningId() === null ? <PopoverCheck /> : undefined}
            />
          </View>
          <Each of={pickerTargetReasoningChoices()} key={choice => choice.id}>
            {choice => (
              <View
                role="button"
                accessibilityLabel={`reasoning-option-${choice().id}`}
                onPress={() => selectReasoningForPickerTarget(choice().id)}
                style={popoverRowStyle()}
                hoverStyle={popoverRowHoverStyle()}
                activeStyle={popoverRowActiveStyle()}
                focusVisibleStyle={focusRingStyle(-1)}
              >
                <ListRowContent
                  title={choice().label}
                  titleWeight={choice().id === pickerTargetReasoningId() ? "500" : "400"}
                  trailing={choice().id === pickerTargetReasoningId() ? <PopoverCheck /> : undefined}
                />
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}


const rejectingPermission = signal<string | null>(null);
const rejectFeedback = signal("");

/** A pending request as the prompt the attention atoms draw (the session's own store keeps it). */
function permissionAsPrompt(request: PermissionRequestView): FleetPrompt {
  return {
    deviceId: request.deviceId,
    workspaceId: activeWorkspaceId() ?? "",
    sessionId: request.sessionId,
    kind: "permission",
    promptId: request.requestId,
    revision: 0,
    title: request.action,
    payload: { action: request.action, resources: request.resources },
    payloadTruncated: false,
    answerable: true,
  };
}

/** Answers through `permissionStore`, which drops the request from its list. */
async function sendSessionPermission(prompt: FleetPrompt, answer: PromptAnswer): Promise<void> {
  if (answer.kind !== "permission") return;
  await answerPermission(prompt.promptId, answer.reply);
}

/**
 * The session's blocked prompts, above the composer: one `PromptAttention`
 * per request in a radius-12 hairline box (spec §3 AttentionItem, composer
 * placement). The reason field and "Allow all" stay for this session's own
 * requests.
 */
function PermissionCard(props: { requests?: () => PermissionRequestView[] } = {}) {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  const items = () => (props.requests ? props.requests() : activePermissions());
  return (
    <View
      style={[
        { width: "100%", maxWidth: contentWidth(), alignSelf: "center", gap: space.sm },
        motion.style,
      ]}
    >
      <Each of={items()} key={request => `${request.deviceId}/${request.requestId}`}>
        {(request, idx) => (
          <PromptAttention
            prompt={permissionAsPrompt(request())}
            placement="composer"
            source=""
            device={sessionDeviceLabel()}
            send={sendSessionPermission}
            testID={`session-prompt-${request().requestId}`}
            extraActions={
              <>
                <Button
                  label={tr("chat.permission.rejectWithReason")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`reject-with-reason-${request().requestId}`}
                  onPress={() => {
                    rejectFeedback.set("");
                    rejectingPermission.set(rejectingPermission() === request().requestId ? null : request().requestId);
                  }}
                />
                <If when={idx() === 0 && items().length > 1}>
                  <Button
                    label={tr("chat.permission.allowAll", { count: items().length })}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel="allow-all-permissions"
                    loading={answeringPermission()?.reply === "batch-once"}
                    disabled={Boolean(answeringPermission())}
                    onPress={() => void answerPermissionBatch(request().requestId, "once")}
                  />
                </If>
              </>
            }
          >
            <If when={rejectingPermission() === request().requestId}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <InputBox
                  value={rejectFeedback()}
                  placeholder={tr("chat.permission.reasonPlaceholder")}
                  size="sm"
                  autoFocus={true}
                  accessibilityLabel={`reject-reason-${request().requestId}`}
                  style={{ flex: 1, minWidth: 0 }}
                  onChange={value => rejectFeedback.set(value)}
                  onSubmit={() => {
                    const id = request().requestId;
                    const reason = rejectFeedback().trim();
                    rejectingPermission.set(null);
                    rejectFeedback.set("");
                    void answerPermission(id, "reject", reason || undefined);
                  }}
                />
                <Button
                  label={tr("chat.permission.sendReject")}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    const id = request().requestId;
                    const reason = rejectFeedback().trim();
                    rejectingPermission.set(null);
                    rejectFeedback.set("");
                    void answerPermission(id, "reject", reason || undefined);
                  }}
                />
              </View>
            </If>
          </PromptAttention>
        )}
      </Each>
    </View>
  );
}

/** A transcript notice (spec §3 Notice): `info` 14 + 13 `textMuted`, no rail. */
function SessionOfflineNotice() {
  return (
    <If when={offlineNoticeText()}>
      {text => (
        <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.sm }}>
          <View
            accessibilityLabel="session-offline-notice"
            style={{ width: "100%", maxWidth: contentWidth(), alignSelf: "center", flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <Icon name="info" size={14} color={palette().textMuted} />
            <Text style={{ ...textStyle("label", { color: palette().textMuted }), fontWeight: "400", flex: 1, minWidth: 0 }}>{text()}</Text>
          </View>
        </View>
      )}
    </If>
  );
}

/** "{count} notes · Send to agent" above the composer while this session has review notes. */
function SessionReviewNotes() {
  const notes = computed(() => reviewNotesFor(activeSessionKey()).filter(note => note.text.trim()));
  return (
    <If when={notes().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.sm }}>
        <View style={{ width: "100%", maxWidth: contentWidth(), alignSelf: "center" }}>
          <ReviewNotesBar
            count={notes().length}
            sending={sendingReviewNotes()}
            onSend={() => {
              const key = activeSessionKey();
              if (key) void sendReviewNotes(key, text => sendTurn(text));
            }}
          />
        </View>
      </View>
    </If>
  );
}

function PermissionPrompts(props: { sessionId?: () => string | null } = {}) {
  const items = () => (props.sessionId ? permissionsForSession(props.sessionId()) : activePermissions());
  return (
    <If when={items().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.sm }}>
        <PermissionCard requests={items} />
      </View>
    </If>
  );
}


function QuestionPrompts(props: { sessionId?: () => string | null } = {}) {
  const items = () => (props.sessionId ? questionsForSession(props.sessionId()) : activeQuestions());
  return (
    <If when={items().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.chip }}>
        <View
          style={{
            width: "100%",
            maxWidth: contentWidth(),
            alignSelf: "center",
            gap: space.sm,
          }}
        >
          <Each of={items()} key={prompt => prompt.toolId}>
            {prompt => <QuestionCard prompt={prompt} />}
          </Each>
        </View>
      </View>
    </If>
  );
}

function formatQuestionCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function QuestionCard(props: { prompt: () => QuestionPrompt }) {
  const prompt = props.prompt;
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  const nowMs = signal(Date.now());
  let expiredTriggered = false;

  // Live 1s countdown ticker while an unattended host deadline is active.
  effect(() => {
    const deadline = prompt().localDeadlineMs;
    const started = prompt().interactionStarted;
    if (!deadline || started) return;
    nowMs.set(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      nowMs.set(current);
      if (current >= deadline && !expiredTriggered) {
        expiredTriggered = true;
        const p = prompt();
        void loadQuestionMailbox(p.sessionId, p.deviceId);
      }
    }, 1000);
    cleanup(() => clearInterval(timer));
  });

  const remainingSeconds = computed(() => {
    const p = prompt();
    if (!p.localDeadlineMs || p.interactionStarted) return null;
    return Math.max(0, Math.ceil((p.localDeadlineMs - nowMs()) / 1000));
  });

  const isUrgent = computed(() => {
    const rem = remainingSeconds();
    return rem !== null && rem <= 30;
  });

  return (
    <View
      accessibilityLabel={`question-card-${prompt().toolId}`}
      style={[
        {
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surfaceElevated,
          boxShadow: `${elevationShadow(2)}, ${palette().innerHighlight}`,
          overflow: "hidden",
        },
        motion.style,
      ]}
    >
      {/* Compact Header Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <StateMark state="needs_you" />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <If when={sessionDeviceLabel()}>
            {device => (
              <>
                <DeviceBadge
                  name={device().name}
                  kind={device().kind}
                  exception={device().exception}
                  onPress={compactLayout() ? undefined : device().onPress}
                />
                <Text style={textStyle("caption")}>·</Text>
              </>
            )}
          </If>
          <Text
            style={{
              ...textStyle("label", { color: palette().text }),
              fontWeight: "600",
              flexShrink: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("sessions.questionTitle")}
          </Text>
        </View>
        <If when={remainingSeconds() !== null}>
          <View
            accessibilityLabel={`question-countdown-${prompt().toolId}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingHorizontal: space.sm,
              paddingVertical: 3,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: isUrgent() ? palette().warningBorder : palette().borderSubtle,
              backgroundColor: isUrgent() ? palette().warningSoft : palette().surfaceSubtle,
              flexShrink: 0,
            }}
          >
            <Icon
              name="clock"
              size={11}
              color={isUrgent() ? palette().warning : palette().textMuted}
            />
            <Text
              style={{
                color: isUrgent() ? palette().warning : palette().textSecondary,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.2),
                fontWeight: "500",
                fontFamily: fontMono,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatQuestionCountdown(remainingSeconds() ?? 0)}
            </Text>
          </View>
        </If>
        <If when={prompt().questions.length > 1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair, flexShrink: 0 }}>
            <IconButton
              icon="chevron-left"
              size="xs"
              accessibilityLabel={`question-prev-${prompt().toolId}`}
              tooltip={tr("chat.question.previous")}
              disabled={questionPageOf(prompt().toolId, prompt().questions.length) === 0}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepQuestionPage(prompt().toolId, -1, prompt().questions.length)}
            />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.3),
                fontVariant: ["tabular-nums"],
                paddingHorizontal: space.hair,
              }}
            >
              {`${questionPageOf(prompt().toolId, prompt().questions.length) + 1}/${prompt().questions.length}`}
            </Text>
            <IconButton
              icon="chevron-right"
              size="xs"
              accessibilityLabel={`question-next-${prompt().toolId}`}
              tooltip={tr("chat.question.next")}
              disabled={questionPageOf(prompt().toolId, prompt().questions.length) >= prompt().questions.length - 1}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepQuestionPage(prompt().toolId, 1, prompt().questions.length)}
            />
          </View>
        </If>
      </View>

      {/* Question & Clean Grouped Option Menu */}
      <Scroll smoothWheel style={{ maxHeight: 420, minHeight: 0 }} scrollbar={true}>
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
          <Each of={prompt().questions} key="index">
            {(question, index) => (
              <If when={prompt().questions.length <= 1 || index() === questionPageOf(prompt().toolId, prompt().questions.length)}>
                <QuestionBlock prompt={prompt} question={question} index={index()} />
              </If>
            )}
          </Each>
        </View>
      </Scroll>

      {/* Footer Action Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm + 2,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().surfaceSubtle,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <If
            when={prompt().error}
            else={
              <If when={remainingSeconds() !== null}>
                <Text
                  style={{
                    color: isUrgent() ? palette().warning : palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    fontVariant: ["tabular-nums"],
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {tr("sessions.questionAutoProceed", {
                    remaining: formatQuestionCountdown(remainingSeconds() ?? 0),
                  })}
                </Text>
              </If>
            }
          >
            {message => (
              <Text style={textStyle("caption", { color: palette().danger })}>
                {localizeHostError(message())}
              </Text>
            )}
          </If>
        </View>
        <Button
          label={prompt().submitting ? tr("common.sending") : tr("sessions.sendAnswer")}
          variant="primary"
          size="sm"
          loading={prompt().submitting}
          disabled={prompt().submitting}
          style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
          onPress={() => void submitQuestion(prompt().toolId)}
        />
      </View>
    </View>
  );
}

/** Which question of a multi-question prompt is on screen, per tool call. */
const questionPages = signal<Record<string, number>>({});

function questionPageOf(toolId: string, total: number): number {
  return Math.max(0, Math.min(total - 1, questionPages()[toolId] ?? 0));
}

function stepQuestionPage(toolId: string, direction: -1 | 1, total: number): void {
  const next = Math.max(0, Math.min(total - 1, questionPageOf(toolId, total) + direction));
  questionPages.update(current => ({ ...current, [toolId]: next }));
}

function QuestionMenuRow(props: {
  label: string;
  detail?: string;
  selected: boolean;
  multiSelect: boolean;
  first?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <View
      role={props.multiSelect ? "checkbox" : "radio"}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.selected, checked: props.selected }}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        minHeight: compactLayout() ? layout.touchTarget : 38,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 1,
        borderTopWidth: props.first ? 0 : 1,
        borderColor: palette().borderSubtle,
        backgroundColor: props.selected ? palette().accentSoft : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
      }}
      activeStyle={tactileActiveStyle(0.99)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      {/* Crisp Radio circle or Checkbox square */}
      <View
        style={{
          width: 15,
          height: 15,
          marginTop: 2,
          flexShrink: 0,
          borderRadius: props.multiSelect ? 4 : radii.pill,
          borderWidth: 1.5,
          borderColor: props.selected ? palette().accent : palette().borderStrong,
          backgroundColor: props.selected ? palette().accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <If when={props.selected}>
          <If
            when={props.multiSelect}
            else={
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: radii.pill,
                  backgroundColor: palette().actionSolidFg,
                }}
              />
            }
          >
            <Icon name="check" size={10} color={palette().actionSolidFg} />
          </If>
        </If>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.38),
            fontWeight: props.selected ? "600" : "500",
          }}
        >
          {props.label}
        </Text>
        <If when={props.detail ?? ""}>
          {desc => (
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {desc()}
            </Text>
          )}
        </If>
      </View>
    </View>
  );
}

function QuestionBlock(props: {
  prompt: () => QuestionPrompt;
  question: () => QuestionView;
  index: number;
}) {
  const prompt = props.prompt;
  const question = props.question;
  const chosen = (): string[] => {
    const answer = prompt().answers[String(props.index)];
    return Array.isArray(answer) ? answer : answer ? [answer] : [];
  };
  const typingOther = () =>
    chosen().includes("Other") || Boolean((prompt().others[String(props.index)] ?? "").length);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 3 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.45),
            fontWeight: "500",
          }}
        >
          {question().header ? `${question().header}: ${question().question}` : question().question}
        </Text>
        <Text style={textStyle("caption", { color: palette().textElevatedMuted })}>
          {question().multiSelect
            ? tr("sessions.questionChooseMulti")
            : tr("sessions.questionChooseOne")}
        </Text>
      </View>
      <View
        style={{
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().panelRaised,
          overflow: "hidden",
        }}
      >
        <Each of={question().options} key={option => option.label}>
          {(option, optIdx) => (
            <QuestionMenuRow
              first={optIdx() === 0}
              label={option().label}
              detail={option().description}
              selected={chosen().includes(option().label)}
              multiSelect={question().multiSelect}
              accessibilityLabel={`question-${prompt().toolId}-${props.index}-${option().label}`}
              onPress={() =>
                toggleQuestionOption(prompt().toolId, props.index, option().label)
              }
            />
          )}
        </Each>
        <QuestionMenuRow
          first={question().options.length === 0}
          label={tr("sessions.questionOther")}
          detail={typingOther() ? undefined : tr("sessions.questionOtherDetail")}
          selected={typingOther()}
          multiSelect={question().multiSelect}
          accessibilityLabel={`question-${prompt().toolId}-${props.index}-other`}
          onPress={() =>
            toggleQuestionOption(prompt().toolId, props.index, "Other")
          }
        />
        <If when={typingOther()}>
          <View
            style={{
              paddingHorizontal: space.md,
              paddingBottom: space.md,
              paddingTop: space.xs,
              backgroundColor: palette().accentSoft,
            }}
          >
            <InputBox
              autoFocus
              size="sm"
              accessibilityLabel={`question-${prompt().toolId}-${props.index}-text`}
              value={prompt().others[String(props.index)] ?? ""}
              placeholder={tr("sessions.questionPlaceholder")}
              onChange={value => setQuestionOther(prompt().toolId, props.index, value)}
              onSubmit={() => void submitQuestion(prompt().toolId)}
            />
          </View>
        </If>
      </View>
    </View>
  );
}

const queuedForActive = computed(() => queueForSession(activeSessionId()));

async function runQuickAction(id: string): Promise<void> {
  if (!activeSessionId() || runningTurnId()) return;
  const action = quickActions().find(entry => entry.id === id);
  if (!action) return;
  closePickers();
  jumpToTranscriptEnd();
  await sendTurn(action.prompt);
}

function queuedStatusLabel(status: string): string {
  if (status === "steering_pending") return tr("sessions.steeringStatus");
  if (status === "blocked") return tr("sessions.queuedBlocked");
  return status;
}

function canReorder(source: "host" | "local"): boolean {
  return source === "local" || hostQueueReorderSupported() === true;
}

/** A host without the queue: said while a turn runs, which is when queueing matters. */
function QueueHostNotice() {
  return (
    <If when={queuedForActive().length === 0 && Boolean(runningTurnId()) && queueFallbackReason().length > 0}>
      <Text
        accessibilityLabel="queue-host-update"
        style={{
          paddingHorizontal: space.md,
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
        }}
      >
        {localizeHostError(queueFallbackReason())}
      </Text>
    </If>
  );
}

function QueuedPanel() {
  return (
    <If when={queuedForActive().length > 0}>
      <View
        accessibilityLabel="queued-panel"
        style={{
          marginHorizontal: space.xs,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().surfaceSubtle,
          overflow: "hidden",
        }}
      >
        <View
          role="button"
          accessibilityLabel="queued-panel-toggle"
          onPress={() => {
            queueCollapsed.update(v => !v);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: compactLayout() ? layout.touchTarget : 30,
            gap: space.xs,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            cursor: "pointer",
            userSelect: "none",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().panelHover }}
          focusVisibleStyle={focusRingStyle(-1)}
        >
          <Icon name="clock" size={12} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              fontWeight: "500",
              fontVariant: ["tabular-nums"],
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("sessions.queuedSummary", { count: formatCount(queuedForActive().length) })}
          </Text>
          <View style={{ flexShrink: 0, ...rotatingChevronStyle(!queueCollapsed()) }}>
            <Icon name="chevron-right" size={12} color={palette().textMuted} />
          </View>
        </View>
        <If when={!queueCollapsed()}>
          <Scroll smoothWheel style={{ maxHeight: 168, minHeight: 0 }} scrollbar={true}>
            <View>
              <Each of={queuedForActive()} key={item => item.id}>
                {(item, index) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      paddingHorizontal: space.md,
                      paddingVertical: space.xs + 2,
                      borderTopWidth: 1,
                      borderColor: palette().borderSubtle,
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().panelHover }}
                  >
                    <If when={queuedForActive().length > 1}>
                      <Text
                        style={{
                          width: 14,
                          flexShrink: 0,
                          color: palette().textMuted,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.3),
                          fontVariant: ["tabular-nums"],
                          textAlign: "center",
                        }}
                      >
                        {String(index() + 1)}
                      </Text>
                    </If>
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: item().content ? palette().text : palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.4),
                        numberOfLines: 2,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item().content ||
                        formatPlural(
                          item().attachments?.length ?? item().attachmentCount ?? 1,
                          "format.imageOne",
                          "format.imageOther",
                        )}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexShrink: 0,
                        gap: space.hair,
                      }}
                    >
                      <If when={(item().attachments?.length ?? item().attachmentCount ?? 0) > 0}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                            paddingHorizontal: space.chip,
                            paddingVertical: 2,
                            borderRadius: radii.xs,
                            backgroundColor: palette().surfaceTertiary,
                            borderWidth: 1,
                            borderColor: palette().borderSubtle,
                          }}
                        >
                          <Icon name="image" size={11} color={palette().textMuted} />
                          <Text
                            style={{
                              color: palette().textMuted,
                              fontSize: textSize(11),
                              lineHeight: textLineHeight(11, 1.2),
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {String(item().attachments?.length ?? item().attachmentCount ?? 0)}
                          </Text>
                        </View>
                      </If>
                      <If when={item().status !== "queued"}>
                        <Badge label={queuedStatusLabel(item().status)} tone="warning" />
                      </If>
                      <If when={canReorder(item().source) && queuedForActive().length > 1}>
                        <IconButton
                          icon="chevron-up"
                          size="xs"
                          iconSize={13}
                          disabled={index() === 0}
                          tooltip={tr("common.up")}
                          accessibilityLabel={tr("common.up")}
                          style={{ borderRadius: radii.pill }}
                          onPress={() => void moveQueued(item().id, -1)}
                        />
                        <IconButton
                          icon="chevron-down"
                          size="xs"
                          iconSize={13}
                          disabled={index() === queuedForActive().length - 1}
                          tooltip={tr("common.down")}
                          accessibilityLabel={tr("common.down")}
                          style={{ borderRadius: radii.pill }}
                          onPress={() => void moveQueued(item().id, 1)}
                        />
                      </If>
                      <IconButton
                        icon="arrow-up"
                        size="xs"
                        iconSize={13}
                        tooltip={tr("sessions.sendNow")}
                        accessibilityLabel={tr("sessions.sendNow")}
                        style={{ borderRadius: radii.pill }}
                        onPress={() => void sendQueuedNow(item().id)}
                      />
                      <IconButton
                        icon="edit"
                        size="xs"
                        iconSize={13}
                        tooltip={tr("common.edit")}
                        accessibilityLabel={tr("common.edit")}
                        style={{ borderRadius: radii.pill }}
                        onPress={() => {
                          const content = item().content;
                          const queuedAttachments = [...(item().attachments ?? [])];
                          const prevDraft = composerText();
                          const prevAttachments = [...imageAttachments()];
                          const nextDraft = prevDraft.trim()
                            ? content
                              ? `${prevDraft.trimEnd()}\n${content}`
                              : prevDraft
                            : content;
                          composerText.set(nextDraft);
                          if (queuedAttachments.length > 0) {
                            imageAttachments.set([...prevAttachments, ...queuedAttachments]);
                          }
                          composerInputRef?.focus();
                          void takeQueuedEntry(item().id).then(taken => {
                            if (!taken) {
                              if (composerText() === nextDraft) composerText.set(prevDraft);
                              if (queuedAttachments.length > 0) imageAttachments.set(prevAttachments);
                            }
                          });
                        }}
                      />
                      <IconButton
                        icon="trash"
                        size="xs"
                        iconSize={13}
                        tone="danger"
                        tooltip={tr("common.delete")}
                        accessibilityLabel={tr("common.delete")}
                        style={{ borderRadius: radii.pill }}
                        onPress={() => void removeQueued(item().id)}
                      />
                    </View>
                  </View>
                )}
              </Each>
              <Each of={queuedForActive().filter(item => item.reason.length > 0)} key={item => `reason-${item.id}`}>
                {item => (
                  <View
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: space.xs,
                      borderTopWidth: 1,
                      borderColor: palette().borderSubtle,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().warning,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      {tr("sessions.queuedWaiting", { reason: localizeHostError(item().reason) })}
                    </Text>
                  </View>
                )}
              </Each>
              <If when={queueFallbackReason().length > 0}>
                <View
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                    borderTopWidth: 1,
                    borderColor: palette().borderSubtle,
                  }}
                >
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.35),
                    }}
                  >
                    {localizeHostError(queueFallbackReason())}
                  </Text>
                </View>
              </If>
              <If when={queueNotice().length > 0}>
                <View
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                    borderTopWidth: 1,
                    borderColor: palette().borderSubtle,
                  }}
                >
                  <Text
                    style={{
                      color: palette().danger,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.35),
                    }}
                  >
                    {localizeHostError(queueNotice())}
                  </Text>
                </View>
              </If>
            </View>
          </Scroll>
        </If>
      </View>
    </If>
  );
}

/**
 * Global search publishes the turn a message hit belongs to; once that session
 * is open and the turn is rendered, scroll it into view and clear the request.
 */
function followSearchRevealRequests(): void {
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  });
  effect(() => {
    const request = searchRevealTurn();
    if (!request || activeSessionId() !== request.sessionId) return;
    const loaded = sessionTurns().some(turn => turnKeyOf(turn) === request.turnId);
    if (!loaded) return;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = null;
      const index = primaryTranscriptBlocks().firstIndexByTurnId.get(request.turnId);
      if (index === undefined) return;
      followLatest.set(false);
      cancelScheduledTranscriptScroll();
      transcriptListRef?.scrollToIndex({ index, viewPosition: 0, animated: false });
      searchRevealTurn.set(null);
    }, 0);
  });
}

// ── Secondary Split Session Pane (Pane 1) ───────────────────────────────────

const secondaryPermissions = computed(() => permissionsForSession(secondarySessionId()));
const secondaryQuestions = computed(() => questionsForSession(secondarySessionId()));

const secondaryHeaderState = computed<MarkState | null>(() => {
  if (secondaryRunningTurnId()) return "working";
  if (secondaryPermissions().length > 0 || secondaryQuestions().length > 0) return "needs_you";
  const pending = secondaryPendingTurnState();
  const id = secondarySessionId();
  if (pending && id && pending.sessionId === id && !secondaryTurnError()) return "working";
  const row = id ? fleetSessionRow(secondarySessionDevice(), id) : null;
  if (row?.status === "waiting" || row?.needsAttention) return row.status === "error" ? "failed" : "needs_you";
  if (row?.status === "error") return "failed";
  if (row?.status === "running") return "working";
  return null;
});

const secondaryLiveRounds = computed<LiveModelRound[]>(() => secondaryLiveTurn()?.rounds ?? []);
const secondaryLiveDisplayBlocks = computed<LiveDisplayBlock[]>(() =>
  buildLiveDisplayBlocks(secondaryLiveRounds(), 1),
);

const secondaryOptimisticUserText = computed<string>(() => {
  const pending = secondaryPendingTurnState();
  const id = secondarySessionId();
  if (!pending || !id || pending.sessionId !== id) return "";
  return pending.userText;
});

const secondaryPendingImages = computed<UserImage[]>(() => {
  const pending = secondaryPendingTurnState();
  const id = secondarySessionId();
  if (!pending || !id || pending.sessionId !== id || !pending.images?.length) return [];
  return pending.images.map((img, idx) => ({
    id: img.id || `sec-pending-img-${idx}`,
    name: img.name,
    ...(img.dataUrl ? { dataUrl: img.dataUrl } : {}),
    ...(img.imagePath ? { imagePath: img.imagePath } : {}),
  }));
});

const secondaryAwaitingResponse = computed<boolean>(() => {
  if (secondaryTurnError()) return false;
  if (secondaryPermissions().length > 0 || secondaryQuestions().length > 0) return false;
  const live = secondaryLiveTurn();
  if (live?.settling) return false;
  const hasPending = Boolean(secondaryOptimisticUserText() || secondaryPendingImages().length > 0);
  const hasRunning = Boolean(secondaryRunningTurnId());
  if (!hasPending && !hasRunning) return false;
  return !liveBlocksHaveActiveMotion(secondaryLiveDisplayBlocks(), secondaryLiveRounds(), 1);
});

const secondaryWaitingStartedAt = computed<number | undefined>(() => {
  const sid = secondarySessionId();
  return secondaryPendingTurnState()?.createdAt ?? (sid ? turnStartedAt(sid) : undefined);
});

const secondaryVisibleTurnRows = computed(() => {
  const list = secondaryTurns();
  const live = secondaryLiveTurn();
  const activeTurnId = live?.turnId || secondaryPendingTurnState()?.turnId || "";
  const filtered = activeTurnId ? list.filter(turn => turn.turnId !== activeTurnId || turn.settled) : list;
  return filtered.map((turn, idx) => ({
    key: turnKeyOf(turn) || `sec-turn-${idx}`,
    turn,
  }));
});

const secondaryDeviceLabel = computed<AttentionDevice | null>(() => {
  const device = fleetDeviceById(secondarySessionDevice());
  if (!device) return null;
  return {
    name: device.name,
    kind: device.hostKind,
    exception: deviceException(device.state),
    onPress: () => showDevice(device.deviceId),
  };
});

function SecondaryHeader() {
  const menuOpen = signal(false);
  const menuAnchor = signal<ViewRef | null>(null);
  const menuItems = computed<DropdownMenuItem[]>(() => {
    const id = secondarySessionId();
    const items: DropdownMenuItem[] = [];
    if (id && activeSessionId()) {
      items.push({
        id: "secondary-swap-panes",
        label: tr("sessions.splitSwap"),
        icon: "arrow-left-right",
        accessibilityLabel: "secondary-swap-panes",
        onSelect: () => swapSplitPanes(),
      });
    }
    items.push({
      id: "secondary-close-split",
      label: tr("sessions.splitClose"),
      icon: "close",
      accessibilityLabel: "secondary-close-split",
      onSelect: () => closeSplitPane(1),
    });
    if (id) {
      const target = {
        sessionId: id,
        deviceId: secondarySessionDevice(),
        workspaceId: secondaryWorkspaceId() ?? "",
        title: secondarySessionTitle(),
      };
      items.push(...sessionMenuItems(target, { omit: ["split"] }));
    }
    return items;
  });

  return (
    <SessionHeaderBar
      testID="secondary-session-header"
      titleTestID="secondary-session-title"
      title={secondarySessionTitle}
      focused={() => focusedPane() === 1}
      bordered={() => true}
      focusAccessibilityLabel="secondary-pane-focus"
      focusIndicatorTestID="secondary-pane-active-indicator"
      onFocus={() => focusPane(1)}
      breadcrumb={
        <SessionBreadcrumb
          device={secondaryDeviceLabel}
          workspaceName={() => {
            const name = secondaryWorkspaceName();
            if (!name) return "";
            const alias = remoteWorkspaceAliasOf(secondaryWorkspaceRecord());
            return alias ? `${name} · ${alias}` : name;
          }}
        />
      }
      deviation={
        <DeviationChip
          sessionId={secondarySessionId}
          accessibilityLabel="secondary-session-permission-deviation"
        />
      }
      statusState={secondaryHeaderState}
      statusLabelPrefix="secondary-session-status-"
      showTools={() => !compactLayout() && !sessionsCompact()}
      toolLabelPrefix="secondary-"
      onToolPress={() => focusPane(1)}
      actions={
        <>
          <View ref={el => menuAnchor.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={menuOpen()}
              accessibilityLabel="secondary-thread-actions-trigger"
              tooltip={tr("nav.threadActions")}
              onPress={() => {
                focusPane(1);
                menuOpen.update(v => !v);
              }}
            />
            <If when={menuOpen()}>
              <DropdownMenu
                open={true}
                anchor={menuAnchor()}
                align="end"
                minWidth={210}
                items={menuItems()}
                onClose={() => menuOpen.set(false)}
              />
            </If>
          </View>
          <IconButton
            icon="close"
            size="sm"
            accessibilityLabel="session-pane-close-1"
            tooltip={tr("sessions.splitClosePane")}
            onPress={() => closeSplitPane(1)}
          />
        </>
      }
    />
  );
}

function SecondaryEmptyPicker() {
  const candidates = computed(() => {
    const primaryKey = activeSessionKey();
    return sessions()
      .filter(row => !isSessionArchived(row) && `${row.deviceId ?? ""}/${row.sessionId}` !== primaryKey)
      .slice(0, 8);
  });
  return (
    <Scroll
      smoothWheel
      style={{ flex: 1, minHeight: 0 }}
      contentStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: space.xxl,
      }}
    >
      <View
        accessibilityLabel="secondary-split-picker"
        style={{
          width: "100%",
          maxWidth: 380,
          alignItems: "center",
          gap: space.md,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette().surfaceTertiary,
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="columns" size={18} color={palette().textSecondary} />
        </View>
        <View style={{ alignItems: "center", gap: space.xs }}>
          <Text style={textStyle("sectionTitle")}>{tr("sessions.splitPickTitle")}</Text>
          <Text style={{ ...textStyle("caption", { color: palette().textMuted }), textAlign: "center" }}>
            {tr("sessions.splitPickEmpty")}
          </Text>
        </View>
        <Button
          label={tr("nav.newSession")}
          variant="primary"
          size="sm"
          leadingIcon="plus"
          accessibilityLabel="secondary-new-session"
          onPress={() => void createSecondarySession()}
        />
        <If when={candidates().length > 0}>
          <View
            style={{
              width: "100%",
              marginTop: space.sm,
              gap: space.hair,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
              paddingTop: space.sm,
            }}
          >
            <Each of={candidates()} key={row => row.sessionId}>
              {row => (
                <View
                  role="button"
                  accessibilityLabel={`secondary-pick-session-${row().sessionId}`}
                  onPress={() =>
                    selectSecondarySession(
                      row().sessionId,
                      row().deviceId,
                      row().workspaceId || activeWorkspaceId(),
                    )
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  activeStyle={tactileActiveStyle(0.99)}
                >
                  <Icon name="chat" size={13} color={palette().textMuted} />
                  <Text
                    style={{
                      ...textStyle("label"),
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {sessionTitle(row())}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </If>
      </View>
    </Scroll>
  );
}

const secondaryTranscriptBlocks = computed<TranscriptBlockProjection>(() =>
  buildTranscriptBlockProjection(secondaryVisibleTurnRows(), true),
);

function SecondaryTranscript() {
  let listRef: ListRef | undefined;
  let lastSession = secondarySessionId();
  let secSuppressAutoFollowUntil = 0;
  let secPeakFollowScrollY = 0;
  let secLastEventContentHeight = 0;
  let secLastEventViewportHeight = 0;
  const secFollowLatest = signal(true);
  const loadingEarlierSec = signal(false);
  const secActiveRailKey = signal("");
  let secFirstViewableIndex = -1;
  let secViewableCount = 0;

  const syncSecRailForLatest = () => {
    const rows = secondaryVisibleTurnRows();
    if (rows.length === 0) {
      if (secActiveRailKey() !== "") secActiveRailKey.set("");
      return;
    }
    if (secFollowLatest()) {
      const last = rows[rows.length - 1]!.key;
      if (secActiveRailKey() !== last) secActiveRailKey.set(last);
    }
  };

  const syncSecRailFromViewable = (viewableItems: ReadonlyArray<ViewToken<TranscriptBlockRow>>) => {
    secFirstViewableIndex = viewableItems[0]?.index ?? -1;
    secViewableCount = viewableItems.length;
    const rows = secondaryVisibleTurnRows();
    if (rows.length === 0) {
      if (secActiveRailKey() !== "") secActiveRailKey.set("");
      return;
    }
    if (secFollowLatest()) {
      const last = rows[rows.length - 1]!.key;
      if (secActiveRailKey() !== last) secActiveRailKey.set(last);
      return;
    }
    const firstTurnKey = viewableItems[0]?.item?.turnKey;
    if (firstTurnKey && secActiveRailKey() !== firstTurnKey) {
      secActiveRailKey.set(firstTurnKey);
    }
  };

  const jumpToSecTurn = (rowKey: string) => {
    const index = rowKey ? secondaryTranscriptBlocks().firstIndexByTurnKey.get(rowKey) : undefined;
    if (index === undefined) return;
    secFollowLatest.set(false);
    secSuppressAutoFollowUntil = Date.now() + 500;
    secActiveRailKey.set(rowKey);
    listRef?.scrollToIndex({
      index,
      viewPosition: 0,
      animated: isShortHop(index, secFirstViewableIndex, secViewableCount),
    });
  };

  registerSecondaryAutoBackfillGuard(() => secFollowLatest());
  registerSecondaryBeforePrependListener(null);
  cleanup(() => {
    registerSecondaryAutoBackfillGuard(null);
    registerSecondaryBeforePrependListener(null);
    listRef = undefined;
  });

  const showEarlierSecTurns = async (): Promise<void> => {
    if (loadingEarlierSec() || !secondaryHasEarlierTurns()) return;
    loadingEarlierSec.set(true);
    secFollowLatest.set(false);
    try {
      await loadSecondaryEarlierTurns();
    } finally {
      loadingEarlierSec.set(false);
    }
  };

  const secSwapKey = () =>
    secondarySessionKey() ? `${secondarySessionKey()}:${secondaryTurnsLoading() ? "loading" : "ready"}` : "empty";

  effect(() => {
    const id = secondarySessionId();
    if (id !== lastSession) {
      lastSession = id;
      hoveredSecondaryTurnKey.set("");
      secActiveRailKey.set("");
      secFollowLatest.set(true);
      secPeakFollowScrollY = 0;
      secLastEventContentHeight = 0;
      secLastEventViewportHeight = 0;
    }
    secondaryTurns().length;
    secondaryOptimisticUserText();
    secondaryStreamScrollTick();
    secondaryLiveRounds().length;
    secondaryAwaitingResponse();
    if (secFollowLatest()) {
      listRef?.scrollToEnd({ animated: false });
      syncSecRailForLatest();
    }
  });

  const handleScroll = (event: ScrollEvent) => {
    const y = event.offset.y;
    const contentHeight = event.contentSize.height;
    const viewportHeight = event.size.height;
    const viewportGrow =
      secLastEventViewportHeight > 0 ? Math.max(0, viewportHeight - secLastEventViewportHeight) : 0;
    const contentShrink =
      secLastEventContentHeight > 0 ? Math.max(0, secLastEventContentHeight - contentHeight) : 0;
    secLastEventContentHeight = contentHeight;
    secLastEventViewportHeight = viewportHeight;

    const max = Math.max(0, contentHeight - viewportHeight);
    const atBottom = y >= max - 24;
    if (atBottom) {
      if (!secFollowLatest() && Date.now() >= secSuppressAutoFollowUntil) {
        secFollowLatest.set(true);
      }
      if (secFollowLatest()) secPeakFollowScrollY = y;
      syncSecRailForLatest();
    } else if (secFollowLatest()) {
      if (viewportGrow > 0 || contentShrink > 0) {
        secPeakFollowScrollY = Math.max(0, secPeakFollowScrollY - viewportGrow - contentShrink);
      }
      if (y < secPeakFollowScrollY - 4) {
        secFollowLatest.set(false);
      } else if (y > secPeakFollowScrollY) {
        secPeakFollowScrollY = y;
      }
    }
  };

  return (
    <SessionTranscriptList
      pane={1}
      swapKey={secSwapKey}
      blocks={secondaryTranscriptBlocks}
      visibleTurnRows={secondaryVisibleTurnRows}
      hasEarlier={() => secondaryHasEarlierTurns() && secondaryTurns().length > 0}
      loadingEarlier={loadingEarlierSec}
      onLoadEarlier={() => void showEarlierSecTurns()}
      loadEarlierHoldUntil={() => secSuppressAutoFollowUntil}
      onListRef={el => {
        listRef = el;
      }}
      onScroll={handleScroll}
      onViewableItemsChange={syncSecRailFromViewable}
      activeRailKey={secActiveRailKey}
      onJumpTurn={jumpToSecTurn}
      railAccessibilityLabel="secondary-turn-jump-rail"
      railTickPrefix="secondary-turn-jump-"
      followLatest={secFollowLatest}
      onJumpLatest={() => {
        secSuppressAutoFollowUntil = 0;
        secFollowLatest.set(true);
        listRef?.scrollToEnd({ animated: true });
      }}
      latestAccessibilityLabel="secondary-jump-latest"
      notice={secondaryTranscriptNotice}
      loadingEmpty={() => secondaryTurnsLoading() && secondaryTurns().length === 0}
      loadEarlierAccessibilityLabel="secondary-load-earlier"
      optimisticUserText={secondaryOptimisticUserText}
      pendingImages={secondaryPendingImages}
      pendingTurnId={() => secondaryPendingTurnState()?.turnId ?? ""}
      pendingCreatedAt={() => secondaryPendingTurnState()?.createdAt}
      liveDisplayBlocks={secondaryLiveDisplayBlocks}
      awaitingResponse={secondaryAwaitingResponse}
      waitingStartedAt={secondaryWaitingStartedAt}
      cardPrefix="sec-"
      turnError={secondaryTurnError}
      onDismissTurnError={() => secondaryTurnError.set("")}
      sendNotice={secondarySendNotice}
      onDismissSendNotice={() => secondarySendNotice.set("")}
    />
  );
}

function SecondaryComposerDock() {
  let inputRef: InputRef | undefined;
  ensureModelsLoaded();
  subscribeContextUsage();

  const secondaryModelTarget = (): SessionModelTarget => ({
    sessionId: secondarySessionId(),
    deviceId: secondarySessionDevice(),
    workspaceId: secondaryWorkspaceId(),
  });

  effect(() => {
    const id = secondarySessionId();
    const wsId = secondaryWorkspaceId();
    const wsRoot = secondaryWorkspaceRoot();
    if (id) {
      void loadSessionPermissionMode(id, {
        workspaceId: wsId,
        workspacePath: wsRoot,
        turnId: secondaryRunningTurnId(),
      });
    }
  });

  effect(() => {
    const target = secondaryModelTarget();
    if (!target.sessionId) return;
    modelIdForSession(target.sessionId, target.deviceId);
    void ensureReasoningLoaded(target);
  });

  const openSecondaryPermissionPicker = (anchor: ViewRef | null, align: "start" | "end") => {
    const id = secondarySessionId();
    if (!id) return;
    focusPane(1);
    permissionModeTarget.set({
      sessionId: id,
      workspaceId: secondaryWorkspaceId(),
      workspacePath: secondaryWorkspaceRoot(),
      turnId: secondaryRunningTurnId(),
    });
    permissionPillAnchor.set(anchor);
    permissionModeAlign.set(align);
    const next = !permissionModePickerOpen();
    closePickers();
    permissionModePickerOpen.set(next);
  };

  const secondaryDropOpts = () => ({
    workspaceRoot: secondaryWorkspaceRoot() || activeWorkspaceRoot() || "",
    idPrefix: "sec-",
    onAddImage: addSecondaryImageAttachment,
    onAddFile: addSecondaryFileAttachment,
  });

  const handleSecondaryPaste = async (event: PasteEvent, insertText: (text: string) => void) => {
    focusPane(1);
    const ws = secondaryWorkspaceRecord();
    const isRemote = isRemoteWorkspace(ws);
    await handlePanePaste(event, {
      ...secondaryDropOpts(),
      workspaceId: secondaryWorkspaceId() || activeWorkspaceId() || undefined,
      isRemote,
      onInsertText: insertText,
      onFocusInput: () => inputRef?.focus(),
    });
  };

  const canSend = computed(
    () =>
      Boolean(secondarySessionId()) &&
      (secondaryComposerText().trim().length > 0 ||
        secondaryImageAttachments().length > 0 ||
        secondaryFileAttachments().length > 0),
  );

  const submitSecondary = () => {
    if (!canSend()) return;
    const text = secondaryComposerText().trim();
    if (text && secondaryImageAttachments().length === 0 && secondaryFileAttachments().length === 0) {
      if (isReviewCommand(text)) {
        secondaryComposerText.set("");
        void launchReviewFromCommand(text);
        return;
      }
      if (runExtrasCommand(text)) {
        secondaryComposerText.set("");
        return;
      }
    }
    void sendSecondaryTurn(secondaryComposerText());
  };

  return (
    <SessionComposer
      pane={1}
      sessionId={secondarySessionId}
      deviceId={secondarySessionDevice}
      workspaceId={secondaryWorkspaceId}
      draft={secondaryComposerText}
      placeholder={() =>
        secondaryRunningTurnId()
          ? tr("session.placeholderRunning")
          : tr("session.placeholder")
      }
      running={() => Boolean(secondaryRunningTurnId())}
      canSend={canSend}
      images={secondaryImageAttachments}
      files={secondaryFileAttachments}
      attachmentIdPrefix="secondary-"
      onRemoveImage={id => removeSecondaryImageAttachment(id)}
      onRemoveFile={id => removeSecondaryFileAttachment(id)}
      onSubmit={submitSecondary}
      onStop={() => void stopSecondaryTurn()}
      onFocusPane={() => focusPane(1)}
      onPaste={(event, insertText) => void handleSecondaryPaste(event, insertText)}
      onFileDrop={event => {
        if (event.uris?.length) handlePaneUriDrop(event.uris, event.mimeTypes ?? [], secondaryDropOpts());
      }}
      inputRef={el => {
        inputRef = el;
      }}
      inputAccessibilityLabel="secondary-composer"
      sendAccessibilityLabel="secondary-send-turn"
      stopAccessibilityLabel="secondary-stop-turn"
      plusAccessibilityLabel="secondary-composer-plus"
      agentAccessibilityLabel="secondary-agent-picker"
      modelAccessibilityLabel="secondary-bot-capsule-trigger"
      reasoningAccessibilityLabel="secondary-reasoning-picker"
      permissionAccessibilityLabel="secondary-permission-mode-warning"
      contextAccessibilityLabel="secondary-context-usage"
      showAgentPicker={true}
      agentLocked={() => true}
      showReasoning={true}
      showPermissionShield={true}
      onOpenPermissionPicker={anchor => openSecondaryPermissionPicker(anchor, "end")}
      showContextRing={true}
      plusItems={(compact, anchor, close) => {
        const fromPlus = (action: () => void) => () => {
          close();
          action();
        };
        const items: DropdownMenuItem[] = [
          {
            id: "sec-pick-images",
            icon: "image",
            label: tr("chat.attach.pickImages"),
            accessibilityLabel: "secondary-attach-image-file",
            onSelect: fromPlus(() => {
              focusPane(1);
              void attachImagesFromPicker(addSecondaryImageAttachment);
            }),
          },
        ];
        if (permissionModeSupported() !== false && secondarySessionId()) {
          items.push({
            id: "sec-permission",
            icon: "shield",
            label: tr("chat.permissionMode.tooltip"),
            trailingHint: permissionModeLabel(effectivePermissionMode(secondarySessionId())),
            accessibilityLabel: "secondary-permission-mode-pill",
            onSelect: fromPlus(() => openSecondaryPermissionPicker(anchor(), "start")),
          });
        }
        if (compact) {
          const secModelText = modelTextForSession(secondarySessionId(), secondarySessionDevice());
          const secReasoningChoices = reasoningChoicesForSession(secondarySessionId(), secondarySessionDevice());
          items.push({
            id: "sec-model",
            icon: "cpu",
            label: tr("sessions.modelLabel", { name: secModelText.label }),
            separator: true,
            accessibilityLabel: "secondary-bot-capsule-trigger",
            onSelect: fromPlus(() => {
              focusPane(1);
              modelPickerTarget.set({ kind: "session", ...secondaryModelTarget() });
              modelPickerAnchor.set(anchor());
              closePickers("model");
              modelPickerOpen.set(true);
              void refreshFleetModels();
            }),
          });
          if (secReasoningChoices.length > 0) {
            items.push({
              id: "sec-reasoning",
              icon: "bulb",
              label: tr("sessions.reasoningLabel", {
                name: reasoningLabelForSession(secondarySessionId(), secondarySessionDevice()),
              }),
              accessibilityLabel: "secondary-reasoning-picker",
              onSelect: fromPlus(() => {
                focusPane(1);
                modelPickerTarget.set({ kind: "session", ...secondaryModelTarget() });
                reasoningPickerAnchor.set(anchor());
                closePickers("reasoning");
                reasoningPickerOpen.set(true);
              }),
            });
          }
        }
        return items;
      }}
    />
  );
}

function SecondarySessionPane() {
  const activateSecondary = () => {
    if (splitPaneOpen()) focusPane(1);
  };
  return (
    <SessionPaneShell
      testID="secondary-session-pane"
      onInteract={activateSecondary}
      onPress={() => (splitPaneOpen() && focusedPane() !== 1 ? activateSecondary : undefined)}
      style={() => ({
        flexGrow: 1 - sessionSplitRatio(),
        flexBasis: 0,
        minWidth: 260,
      })}
      header={<SecondaryHeader />}
      banners={<RemoteWorkspaceStatusBanner compact={true} workspace={secondaryWorkspaceRecord} />}
      transcript={
        <If when={Boolean(secondarySessionId())} else={<SecondaryEmptyPicker />}>
          <SecondaryTranscript />
        </If>
      }
      preComposer={
        <If when={Boolean(secondarySessionId())}>
          <>
            <PermissionPrompts sessionId={secondarySessionId} />
            <QuestionPrompts sessionId={secondarySessionId} />
          </>
        </If>
      }
      composer={
        <If when={Boolean(secondarySessionId())}>
          <SecondaryComposerDock />
        </If>
      }
    />
  );
}

/**
 * Unified ephemeral `/btw` side-question pane reusing Primary's exact
 * `SessionPaneShell`, `SessionHeaderBar`, `UserBubble`, `MarkdownBody`,
 * `CopyChip`, `TurnJumpRail`, `LatestPill`, and `SessionComposer`.
 */
function BtwSessionPane(props?: { compact?: boolean }) {
  let scrollRef: ScrollRef | undefined;
  let inputRef: InputRef | undefined;
  let btwSuppressAutoFollowUntil = 0;
  const btwFollowLatest = signal(true);
  const btwActiveRailKey = signal("");
  const btwTurnRowRefs = new Map<string, ViewRef>();
  const btwTurnOffsets = new Map<string, number>();

  ensureModelsLoaded();

  const current = () => sideQuestion();
  const history = () => sideQuestionHistory();
  const running = computed(() => current()?.state === "running");
  const canSend = computed(
    () =>
      !running() &&
      (Boolean(sideQuestionDraft().trim()) ||
        sideQuestionImageAttachments().length > 0 ||
        sideQuestionFileAttachments().length > 0) &&
      Boolean(activeSessionId()) &&
      !sideQuestionUnsupported(),
  );
  const firstSubtitle = computed(() => {
    const first = history()[0]?.question ?? "";
    return first ? collapsedExcerpt(first, 40) : "";
  });
  const btwJumpRows = computed(() => history().map(item => ({ key: item.requestId })));
  const btwPreviewOf = (key: string): TurnJumpPreviewData | null => {
    const item = history().find(entry => entry.requestId === key);
    if (!item) return null;
    return {
      prompt: collapsedExcerpt(item.question, 140),
      reply: collapsedExcerpt(item.answer, 220),
    };
  };

  const syncBtwRail = (scrollY: number) => {
    const rows = btwJumpRows();
    if (rows.length === 0) {
      if (btwActiveRailKey() !== "") btwActiveRailKey.set("");
      return;
    }
    if (btwFollowLatest()) {
      const last = rows[rows.length - 1]!.key;
      if (btwActiveRailKey() !== last) btwActiveRailKey.set(last);
      return;
    }
    const threshold = scrollY + 96;
    let active = rows[0]!.key;
    for (const row of rows) {
      const offset = btwTurnOffsets.get(row.key);
      if (offset !== undefined && offset <= threshold) active = row.key;
    }
    if (btwActiveRailKey() !== active) btwActiveRailKey.set(active);
  };

  const jumpToBtwTurn = (rowKey: string) => {
    const ref = rowKey ? btwTurnRowRefs.get(rowKey) : undefined;
    if (!ref) return;
    btwFollowLatest.set(false);
    btwSuppressAutoFollowUntil = Date.now() + 500;
    btwActiveRailKey.set(rowKey);
    ref.reveal({ vertical: "start", animated: true });
  };

  effect(() => {
    const list = history();
    list.length;
    current()?.answer.length;
    if (btwFollowLatest()) {
      scrollRef?.scrollToEnd({ animated: false });
      syncBtwRail(0);
    }
  });

  const btwDropOpts = () => ({
    workspaceRoot: activeWorkspaceRoot() || "",
    idPrefix: "btw-",
    onAddImage: addSideQuestionImageAttachment,
    onAddFile: addSideQuestionFileAttachment,
  });

  const handleBtwPaste = async (event: PasteEvent, insertText: (text: string) => void) => {
    const isRemote = isRemoteWorkspace(activeWorkspace());
    await handlePanePaste(event, {
      ...btwDropOpts(),
      workspaceId: activeWorkspaceId() || undefined,
      isRemote,
      onInsertText: insertText,
      onFocusInput: () => inputRef?.focus(),
    });
  };

  const submit = () => {
    const sid = activeSessionId();
    if (!canSend() || !sid) return;
    btwFollowLatest.set(true);
    void askSideQuestion(
      {
        sessionId: sid,
        deviceId: activeSessionDevice(),
        workspaceId: activeWorkspaceId(),
        workspacePath: activeWorkspaceRoot() || null,
        modelId: sideQuestionModelOverride(),
      },
      sideQuestionDraft(),
    );
  };

  const handleScroll = (event: ScrollEvent) => {
    const max = Math.max(0, event.contentSize.height - event.size.height);
    const atBottom = event.offset.y >= max - 24;
    if (atBottom && !btwFollowLatest() && Date.now() >= btwSuppressAutoFollowUntil) {
      btwFollowLatest.set(true);
    } else if (!atBottom && btwFollowLatest() && event.offset.y < max - 48) {
      btwFollowLatest.set(false);
    }
    syncBtwRail(event.offset.y);
  };

  const isCompact = Boolean(props?.compact);

  return (
    <SessionPaneShell
      testID={isCompact ? undefined : "side-question-pane"}
      accessibilityLabel="side-question-sheet"
      style={() =>
        isCompact
          ? { flex: 1 }
          : {
              flexGrow: 1 - sessionSplitRatio(),
              flexBasis: 0,
              minWidth: 260,
            }
      }
      header={
        <If when={!isCompact}>
          <SessionHeaderBar
            testID="side-question-header"
            title={() => tr("btw.title")}
            subtitle={firstSubtitle}
            leadingIcon="sparkles"
            bordered={() => true}
            actions={
              <>
                <If when={history().length > 0}>
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
              </>
            }
          />
        </If>
      }
      transcript={
        <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <Scroll
            smoothWheel
            ref={el => {
              scrollRef = el;
            }}
            style={{ flex: 1, minHeight: 0 }}
            contentStyle={{
              flexGrow: 1,
              paddingLeft: isCompact ? space.lg : paneTranscriptPadLeft(history().length >= 2),
              paddingRight: isCompact ? space.lg : sessionsPadX(),
              paddingTop: space.xl,
              paddingBottom: space.x3l,
            }}
            onScroll={handleScroll}
          >
            <View
              style={{
                width: "100%",
                maxWidth: contentWidth(),
                alignSelf: "center",
                flexGrow: history().length === 0 ? 1 : 0,
                gap: 16,
              }}
            >
              <If when={sideQuestionUnsupported()}>
                <InlineBanner
                  tone="warning"
                  accessibilityLabel="side-question-unsupported"
                  message={tr("btw.hostUpdate")}
                />
              </If>

              <If when={history().length === 0 && !sideQuestionUnsupported()}>
                <View
                  style={{
                    flexGrow: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingVertical: space.xxl,
                    gap: space.md,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      backgroundColor: palette().surfaceTertiary,
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="sparkles" size={18} color={palette().accent} />
                  </View>
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

              <Each of={history()} key={item => item.requestId}>
                {entry => (
                  <View
                    ref={el => {
                      const key = entry().requestId;
                      if (el) btwTurnRowRefs.set(key, el);
                      else {
                        btwTurnRowRefs.delete(key);
                        btwTurnOffsets.delete(key);
                      }
                    }}
                    onLayout={event => {
                      const y = event.bounds.origin.y;
                      if (Number.isFinite(y)) btwTurnOffsets.set(entry().requestId, y);
                    }}
                    style={{ gap: space.md }}
                  >
                    <UserBubble
                      partKey={`btw-${entry().requestId}`}
                      text={entry().question}
                      images={entry().images?.map(img => ({
                        id: img.id,
                        name: img.name,
                        ...(img.dataUrl ? { dataUrl: img.dataUrl } : {}),
                        ...(img.imagePath ? { imagePath: img.imagePath } : {}),
                      }))}
                      showCopy={true}
                    />

                    <If when={entry().answer.length > 0}>
                      <View accessibilityLabel="side-question-answer" style={{ width: "100%", gap: space.xs }}>
                        <MarkdownBody text={entry().answer} live={entry().state === "running"} />
                        <If when={entry().state !== "running"}>
                          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: space.hair }}>
                            <CopyChip partKey={`btw-ans-${entry().requestId}`} text={entry().answer} />
                          </View>
                        </If>
                      </View>
                    </If>

                    <If when={entry().state === "running"}>
                      <View
                        accessibilityLabel="side-question-state"
                        style={transcriptRowStyle(false)}
                      >
                        <TranscriptRowIconSlot>
                          <BrandSpinner size={12} variant="matrix" />
                        </TranscriptRowIconSlot>
                        <Text style={textStyle("label", { color: palette().textMuted })}>
                          {tr("btw.thinking")}
                        </Text>
                      </View>
                    </If>

                    <If when={entry().state === "cancelled"}>
                      <View
                        accessibilityLabel="side-question-state"
                        style={transcriptRowStyle(false)}
                      >
                        <TranscriptRowIconSlot>
                          <Icon name="info" size={14} color={palette().textMuted} />
                        </TranscriptRowIconSlot>
                        <Text style={textStyle("label", { color: palette().textMuted })}>
                          {tr("btw.stopped")}
                        </Text>
                      </View>
                    </If>

                    <If when={entry().state === "failed"}>
                      <View
                        accessibilityLabel="side-question-state"
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: space.sm,
                          paddingLeft: space.md,
                          borderLeftWidth: 2,
                          borderColor: palette().danger,
                        }}
                      >
                        <TranscriptRowIconSlot style={{ marginTop: 2 }}>
                          <Icon name="close" size={14} color={palette().danger} />
                        </TranscriptRowIconSlot>
                        <Text style={{ ...textStyle("body", { color: palette().text }), flex: 1, minWidth: 0 }}>
                          {tr("btw.failed", { error: entry().error ? localizeHostError(entry().error!) : "" })}
                        </Text>
                      </View>
                    </If>
                  </View>
                )}
              </Each>
            </View>
          </Scroll>

          <If when={!isCompact}>
            <TurnJumpRail
              rows={btwJumpRows}
              previewOf={btwPreviewOf}
              activeKey={btwActiveRailKey}
              onJump={jumpToBtwTurn}
              accessibilityLabel="btw-turn-jump-rail"
              tickPrefix="btw-turn-jump-"
            />
          </If>

          <If when={!btwFollowLatest()}>
            <LatestPill
              accessibilityLabel="btw-jump-latest"
              onPress={() => {
                btwSuppressAutoFollowUntil = 0;
                btwFollowLatest.set(true);
                scrollRef?.scrollToEnd({ animated: true });
              }}
            />
          </If>
        </View>
      }
      composer={
        <SessionComposer
          pane="btw"
          sessionId={activeSessionId}
          deviceId={activeSessionDevice}
          workspaceId={activeWorkspaceId}
          draft={sideQuestionDraft}
          placeholder={() => tr("btw.placeholder")}
          disabled={() => !activeSessionId() || sideQuestionUnsupported()}
          running={running}
          canSend={canSend}
          compact={() => isCompact}
          images={sideQuestionImageAttachments}
          files={sideQuestionFileAttachments}
          attachmentIdPrefix="btw-"
          onRemoveImage={id => removeSideQuestionImageAttachment(id)}
          onRemoveFile={id => removeSideQuestionFileAttachment(id)}
          onSubmit={submit}
          onStop={() => void cancelSideQuestion()}
          onPaste={(event, insertText) => void handleBtwPaste(event, insertText)}
          onFileDrop={event => {
            if (event.uris?.length) handlePaneUriDrop(event.uris, event.mimeTypes ?? [], btwDropOpts());
          }}
          inputRef={el => {
            inputRef = el;
          }}
          autoFocus={true}
          inputAccessibilityLabel="side-question-input"
          sendAccessibilityLabel="side-question-ask"
          stopAccessibilityLabel="side-question-stop"
          plusAccessibilityLabel="btw-composer-plus"
          modelAccessibilityLabel="btw-bot-capsule-trigger"
          showAgentPicker={false}
          showReasoning={false}
          showPermissionShield={false}
          showContextRing={false}
          plusItems={(compact, anchor, close) => {
            const fromPlus = (action: () => void) => () => {
              close();
              action();
            };
            const items: DropdownMenuItem[] = [
              {
                id: "btw-pick-images",
                icon: "image",
                label: tr("chat.attach.pickImages"),
                accessibilityLabel: "btw-attach-image-file",
                onSelect: fromPlus(() => {
                  void attachImagesFromPicker(addSideQuestionImageAttachment);
                }),
              },
            ];
            if (compact) {
              const btwModelLabel =
                sideQuestionModelOverride() ||
                modelTextForSession(activeSessionId(), activeSessionDevice()).label;
              items.push({
                id: "btw-model",
                icon: "cpu",
                label: tr("sessions.modelLabel", { name: btwModelLabel }),
                separator: true,
                accessibilityLabel: "btw-bot-capsule-trigger",
                onSelect: fromPlus(() => {
                  modelPickerTarget.set({ kind: "btw" });
                  modelPickerAnchor.set(anchor());
                  closePickers("model");
                  modelPickerOpen.set(true);
                  void refreshFleetModels();
                }),
              });
            }
            return items;
          }}
        />
      }
    />
  );
}

export function SessionsScene() {
  followSearchRevealRequests();
  useSessionExtras(); // wave22-p5
  effect(() => {
    if (sideQuestionOpen() && splitPaneOpen()) {
      closeSplitPane(1);
    }
  });
  const showSecondarySplit = () => splitPaneOpen() && !compactLayout();
  const showBtwSplit = () => !showSecondarySplit() && sideQuestionOpen() && !compactLayout();
  const showSplit = () => showSecondarySplit() || showBtwSplit();
  const dividerNear = signal(false);
  let dividerLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  const enterDividerNear = () => {
    if (dividerLeaveTimer) {
      clearTimeout(dividerLeaveTimer);
      dividerLeaveTimer = null;
    }
    dividerNear.set(true);
  };
  const leaveDividerNear = () => {
    if (dividerLeaveTimer) clearTimeout(dividerLeaveTimer);
    dividerLeaveTimer = setTimeout(() => {
      dividerLeaveTimer = null;
      dividerNear.set(false);
    }, 120);
  };
  cleanup(() => {
    if (dividerLeaveTimer) {
      clearTimeout(dividerLeaveTimer);
      dividerLeaveTimer = null;
    }
  });
  effect(() => {
    if (splitDragging() || !showSecondarySplit()) {
      if (dividerLeaveTimer) {
        clearTimeout(dividerLeaveTimer);
        dividerLeaveTimer = null;
      }
      dividerNear.set(false);
    }
  });
  const canSwapSplit = () =>
    showSecondarySplit() && Boolean(activeSessionId()) && Boolean(secondarySessionId()) && !splitDragging();
  let splitDragStartRatio: number | null = null;
  let splitDragAccumPx = 0;

  return (
    <View
      onLayout={event => {
        const width = event.bounds.size.width;
        if (width > 0 && Math.abs(width - sessionsPaneWidth()) > 1) {
          sessionsPaneWidth.set(width);
        }
      }}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: showSplit() ? "row" : "column",
        backgroundColor: palette().canvas,
      }}
    >
      <SessionPaneShell
        testID="primary-session-pane"
        interactive={() => splitPaneOpen()}
        onInteract={() => {
          if (splitPaneOpen()) focusPane(0);
        }}
        onPress={() => (splitPaneOpen() && focusedPane() !== 0 ? () => focusPane(0) : undefined)}
        style={() => ({
          flex: showSplit() ? undefined : 1,
          flexGrow: showSplit() ? sessionSplitRatio() : 1,
          flexBasis: showSplit() ? 0 : undefined,
          minWidth: showSplit() ? 260 : 0,
        })}
        header={<ConversationHeader paneToRight={showSplit} />}
        banners={
          <>
            <RemoteWorkspaceStatusBanner />
            <GoalStrip />
          </>
        }
        transcript={<Transcript />}
        preComposer={
          <>
            <SessionOfflineNotice />
            <PermissionPrompts />
            <QuestionPrompts />
            <SessionReviewNotes />
            <ReviewLauncherDialog />
            <BackgroundCommandsStrip />
          </>
        }
        composer={
          <If when={Boolean(activeSessionId())}>
            <ComposerDock />
          </If>
        }
      />

      <If when={showSplit()}>
        <View
          onMouseEnter={enterDividerNear}
          onMouseLeave={leaveDividerNear}
          style={{
            position: "relative",
            width: 9,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 4,
          }}
        >
          <If when={canSwapSplit()}>
            <View
              testID="split-divider-proximity-left"
              onMouseEnter={enterDividerNear}
              onMouseLeave={leaveDividerNear}
              onPress={() => focusPane(0)}
              style={{
                position: "absolute",
                left: -18,
                width: 18,
                height: 120,
                backgroundColor: "transparent",
                zIndex: 1,
              }}
            />
            <View
              testID="split-divider-proximity-right"
              onMouseEnter={enterDividerNear}
              onMouseLeave={leaveDividerNear}
              onPress={() => focusPane(1)}
              style={{
                position: "absolute",
                right: -18,
                width: 18,
                height: 120,
                backgroundColor: "transparent",
                zIndex: 1,
              }}
            />
          </If>
          <SplitHandle
            surface="canvas"
            accessibilityLabel="session-split-handle"
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 2 }}
            onDragStateChange={dragging => {
              if (dragging) {
                splitDragStartRatio = sessionSplitRatio();
                splitDragAccumPx = 0;
              } else {
                splitDragStartRatio = null;
                splitDragAccumPx = 0;
              }
            }}
            onDelta={delta => {
              splitDragAccumPx += delta;
              const total = Math.max(400, sessionsPaneWidth());
              const base = splitDragStartRatio ?? sessionSplitRatio();
              setSessionSplitRatio(base + splitDragAccumPx / total);
            }}
            onReset={() => setSessionSplitRatio(SESSION_SPLIT_DEFAULT_RATIO)}
          />
          <If when={canSwapSplit() && dividerNear()}>
            <View
              role="button"
              tooltip={tr("sessions.splitSwap")}
              accessibilityLabel="split-divider-swap"
              onMouseEnter={enterDividerNear}
              onMouseLeave={leaveDividerNear}
              onPress={() => swapSplitPanes()}
              style={{
                position: "absolute",
                left: -8,
                width: 24,
                height: 24,
                zIndex: 3,
                borderRadius: radii.pill,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceElevated,
                boxShadow: elevationShadow(1),
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{
                backgroundColor: palette().panelHover,
                borderColor: palette().borderStrong,
              }}
              activeStyle={tactileActiveStyle(0.94)}
              focusVisibleStyle={baseFocusRingStyle()}
            >
              <Icon name="arrow-left-right" size={12} color={palette().textSecondary} />
            </View>
          </If>
        </View>
        <If when={showSecondarySplit()} else={<BtwSessionPane />}>
          <SecondarySessionPane />
        </If>
      </If>

      <ModalDialog
        open={sideQuestionOpen() && compactLayout()}
        title={tr("btw.title")}
        size="lg"
        accessibilityLabel="side-question-compact-sheet"
        onClose={() => closeSideQuestion()}
      >
        <View style={{ minHeight: 340, maxHeight: 560 }}>
          <BtwSessionPane compact={true} />
        </View>
      </ModalDialog>

      <ComposerOverlays />
      <SessionExtrasDialogs />
      <TurnChangesDiffModal
        review={turnChangesReview}
        onSelectFile={filePath => {
          const current = turnChangesReview();
          if (current) turnChangesReview.set({ ...current, selectedPath: filePath });
        }}
        onOpenFile={filePath => openInAuxPane("files", filePath)}
        onClose={() => turnChangesReview.set(null)}
      />
    </View>
  );
}

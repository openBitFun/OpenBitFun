/**
 * Sessions conversation viewport — combines OpenBitFun Tauri's `FlowChat` Muse
 * progressive-disclosure transcript and 3-band `ChatInput` dock with the calm,
 * borderless editorial craft of Codex, Antigravity, and Claude Desktop.
 * Navigation across workspaces and sessions is owned by `App.tsx`'s `NavPanel`.
 */

import { Buffer } from "buffer";
import { Canvas, cleanup, Clipboard, computed, effect, Image, openUrl, Overlay, reduceMotion, Scroll, signal, Text, untracked, View } from "nsh";
import type {
  Align,
  Bounds,
  InputRef,
  JSX,
  Motion,
  PasteEvent,
  Placement,
  ScrollEvent,
  ScrollRef,
  Signal,
  ViewRef,
  ViewStyle,
} from "nsh";
import { DiffView, Input, TextView } from "nsh/base";
import { invokeCommand } from "../bridge";
import {
  getLiveRoundText,
  getLiveRoundThinking,
  getSecondaryLiveRoundText,
  getSecondaryLiveRoundThinking,
  hasLiveContent,
  hasLiveRoundText,
  hasLiveRoundThinking,
  hasLiveText,
  hasLiveThinking,
  hasLiveTools,
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
import {
  ExploreGroupCard,
  persistedToolState,
  resetExpandedCards,
  ToolCard,
  toolTargetOf,
  toolTitleOf,
} from "../ui/toolCards";
import {
  addFileAttachment,
  attachmentNotice,
  attachmentPreviewSrc,
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
  groupExploreItems,
  isExploreTool,
  pathOf,
  todosOf,
  toolCallsOf,
  turnDurationMs,
  turnEffectiveModel,
  turnFailureOf,
  turnItems,
  turnParts,
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
  refreshFleetModels,
  type FleetModelChoice,
  type FleetModelsDevice,
  ensureReasoningLoaded,
  modelPickerOpen,
  reasoningPickerOpen,
} from "../modelStore";
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
  openAllSessions,
  openDevicePage,
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
import { DropdownMenu, ModalDialog, pushToast, registerEscapeDismiss, type DropdownMenuItem } from "../ui/overlays";
import {
  askSideQuestion,
  cancelSideQuestion,
  closeSideQuestion,
  resetSideQuestionThread,
  sideQuestion,
  sideQuestionDraft,
  sideQuestionHistory,
  sideQuestionUnsupported,
  type SideQuestion,
} from "../btwStore";
import { sessionMenuItems } from "../ui/sessionActions";
import { ReviewLauncherDialog } from "../ui/ReviewLauncher";
import { VoiceDictationBar, VoiceInputButtons, type VoiceComposerActions } from "../ui/VoiceInput";
import {
  TurnChangesDiffModal,
  TurnFileChangesCard,
  type TurnChangesReviewState,
} from "../ui/TurnFileChanges";
import { GenUIToolItem } from "../genui/GenUIView";
import { isGenUICall } from "../genui/genuiSource";
import { ensureVoiceSettings } from "../voiceInputStore";
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

/** Shared frosted surface styling for anchored composer & thread menus. */
function overlayPopoverStyle(): ViewStyle {
  return {
    borderRadius: radii.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: palette().border,
    backgroundColor: palette().glassOverlayBg,
    backdropFilter: "blur(16px)",
    boxShadow: palette().shadowOverlay,
  };
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

function turnMatchesSearch(turn: unknown, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return turnParts(turn).some(part => part.text.toLowerCase().includes(needle));
}

const transcriptMatchKeys = computed(() => {
  const query = transcriptSearchQuery().trim();
  if (!query) return [] as string[];
  return sessionTurns()
    .filter(turn => turnMatchesSearch(turn, query))
    .map((turn, index) => turnKeyOf(turn) || `index-${index}`);
});
const transcriptMatchCount = computed(() => transcriptMatchKeys().length);
const searchMatchIndex = signal(0);
const activeSearchTurnKey = computed(() => {
  const keys = transcriptMatchKeys();
  if (!keys.length) return "";
  return keys[Math.min(searchMatchIndex(), keys.length - 1)] ?? "";
});

/** The rendered view of each persisted turn, keyed by `turnKeyOf`, for search and external turn jumps. */
const turnRefs = new Map<string, ViewRef>();
/** The rendered view of each persisted turn, keyed by `TurnRow.key`, for the left-edge jump rail. */
const turnRowRefs = new Map<string, ViewRef>();
/** Y-offset of each rendered turn inside the transcript column (keyed by `TurnRow.key`), for rail tracking. */
const turnOffsets = new Map<string, number>();
const activeRailTurnKey = signal("");
/** Briefly prevents an upward animated rail jump from re-locking `followLatest` on its first frames near the bottom. */
let suppressAutoFollowUntil = 0;

function registerTurnRef(key: string, el: ViewRef | null | undefined): void {
  if (!key) return;
  if (el) turnRefs.set(key, el);
  else turnRefs.delete(key);
}

function registerTurnRowRef(rowKey: string, el: ViewRef | null | undefined): void {
  if (!rowKey) return;
  if (el) turnRowRefs.set(rowKey, el);
  else {
    turnRowRefs.delete(rowKey);
    turnOffsets.delete(rowKey);
  }
}

function recordTurnOffset(rowKey: string, y: number): void {
  if (!rowKey || !Number.isFinite(y)) return;
  turnOffsets.set(rowKey, y);
}

function syncActiveRailTurn(scrollY: number): void {
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
  const threshold = scrollY + 96;
  let current = rows[0]!.key;
  for (const row of rows) {
    const offset = turnOffsets.get(row.key);
    if (offset !== undefined && offset <= threshold) {
      current = row.key;
    }
  }
  if (activeRailTurnKey() !== current) activeRailTurnKey.set(current);
}

function jumpToTurn(rowKey: string): void {
  const ref = rowKey ? turnRowRefs.get(rowKey) : undefined;
  if (!ref) return;
  followLatest.set(false);
  suppressAutoFollowUntil = Date.now() + 500;
  cancelScheduledTranscriptScroll();
  activeRailTurnKey.set(rowKey);
  ref.reveal({ vertical: "start", animated: true });
}

function revealSearchMatch(): void {
  const key = activeSearchTurnKey();
  const ref = key ? turnRefs.get(key) : undefined;
  if (!ref) return;
  followLatest.set(false);
  ref.reveal({ vertical: "start" });
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

function insertTextIntoComposer(text: string): void {
  if (!text) return;
  if (composerInputRef && typeof composerInputRef.insertText === "function") {
    composerInputRef.insertText(text);
    return;
  }
  composerText.set(`${composerText()}${text}`);
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

async function handleComposerPaste(event: PasteEvent): Promise<void> {
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
  insertTextIntoComposer(text);
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
    onPress: () => openDevicePage(device.deviceId),
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
function ToolToggle(props: { id: ToolPaneId; icon: IconName; label: string }) {
  return (
    <View
      role="button"
      accessibilityLabel={`session-tool-${props.id}`}
      accessibilityState={{ selected: toolActive(props.id) }}
      tooltip={compactLayout() ? undefined : <TooltipBubble text={props.label} />}
      onPress={() => toggleTool(props.id)}
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
  return workspace?.name ?? activeWorkspace()?.name ?? "";
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
              onPress={() => openAllSessions("by-device")}
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
  testID?: string;
  titleTestID?: string;
  title: () => string;
  subtitle?: () => string;
  dimmed?: () => boolean;
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
  focusAccessibilityLabel?: string | (() => string | undefined);
  focusIndicatorTestID?: string;
  onFocus?: () => void;
  actions?: JSX.Element;
  subline?: JSX.Element;
}) {
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
        paddingHorizontal: sessionsPadX(),
        justifyContent: "center",
        gap: space.hair,
        backgroundColor: props.dimmed?.() ? palette().canvasSubtle : palette().canvas,
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
          opacity: props.dimmed?.() ? 0.76 : 1,
          ...paintTransition(MOTION_DURATION.fast),
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
            ...(focusActive() ? { cursor: "pointer", userSelect: "none" } : {}),
          }}
        >
          <If when={Boolean(props.focused?.())}>
            <View
              testID={props.focusIndicatorTestID}
              style={{
                width: 6,
                height: 6,
                borderRadius: radii.pill,
                backgroundColor: palette().accent,
                flexShrink: 0,
                pointerEvents: "none",
              }}
            />
          </If>
          <If when={Boolean(props.leadingIcon)}>
            <Icon
              name={props.leadingIcon!}
              size={14}
              color={props.leadingIconColor ? props.leadingIconColor() : palette().accent}
            />
          </If>
          <Text
            testID={props.titleTestID}
            style={{
              ...textStyle("sectionTitle", {
                color: props.dimmed?.() ? palette().textMuted : palette().text,
              }),
              minWidth: 0,
              flexShrink: props.subtitle ? 0 : 1,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title()}
          </Text>
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
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.xs }}>
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
              {tool => <ToolToggle id={tool().id} icon={tool().icon} label={tr(tool().label)} />}
            </Each>
          </If>
          {props.actions}
        </View>
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
function ConversationHeader() {
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
            titleTestID="session-title"
            title={headerTitle}
            dimmed={() => splitPaneOpen() && focusedPane() !== 0}
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
            showTools={() => !sessionsCompact() && !splitPaneOpen()}
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
                transcriptSearchQuery.set(value);
                searchMatchIndex.set(0);
                if (searchRevealTimer) clearTimeout(searchRevealTimer);
                searchRevealTimer = setTimeout(() => {
                  searchRevealTimer = null;
                  revealSearchMatch();
                }, 0);
              }}
              onSubmit={() => stepSearchMatch(1)}
              trailing={
                transcriptSearchQuery().trim().length > 0 ? (
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
                transcriptSearchQuery.set("");
              }}
            />
          </View>
        </View>
      </If>
    </View>
  );
}

function ThreadMenuDivider() {
  return (
    <View
      style={{
        height: 1,
        marginVertical: space.xs,
        marginHorizontal: space.xs,
        backgroundColor: palette().borderSubtle,
      }}
    />
  );
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
          padding: space.chip,
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
                renameValue.set("");
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
                  if (!next) transcriptSearchQuery.set("");
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
                  minHeight: compactLayout() || sessionsCompact() ? layout.touchTarget : 30,
                  paddingHorizontal: space.xs,
                  gap: space.xs,
                  borderRadius: radii.xs,
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
                  hoverStyle={{ backgroundColor: palette().panelHover }}
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
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: compactLayout() || sessionsCompact() ? layout.touchTarget : 30,
        opacity: props.disabled ? 0.45 : 1,
        paddingHorizontal: space.sm,
        paddingVertical: space.chip,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.danger ? palette().dangerSoft : palette().panelHover }}
      activeStyle={{
        backgroundColor: props.danger ? palette().dangerSoft : palette().panelHover,
        opacity: 0.88,
      }}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <Icon
        name={props.icon}
        size={13}
        color={props.danger ? palette().danger : palette().textSecondary}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: props.danger ? palette().danger : palette().text,
          fontSize: textSize(12.5),
          lineHeight: textLineHeight(12.5, 1.35),
          fontWeight: "500",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.hint ?? ""}>
        {hintText => (
          <Text
            style={{
              flexShrink: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
            }}
          >
            {hintText()}
          </Text>
        )}
      </If>
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
  text: string;
  kind?: "reasoning" | "summary";
  live?: boolean;
}) {
  let tailRef: ScrollRef | undefined;
  const expanded = computed(() => thinkingOverrides()[props.partKey] === true);
  effect(() => {
    // Tail-follow while the reasoning streams into a block the reader opened.
    props.text;
    if (props.live && expanded()) tailRef?.scrollToEnd({ animated: false });
  });
  return (
    <View style={{ gap: 6 }}>
      <View
        role="button"
        accessibilityLabel={`thinking-${props.partKey}`}
        onPress={() => {
          thinkingOverrides.update(current => ({ ...current, [props.partKey]: !expanded() }));
        }}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: space.chip,
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.xs,
          paddingHorizontal: space.chip,
          marginLeft: -space.chip,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        activeStyle={tactileActiveStyle(0.98)}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <If when={Boolean(props.live)} else={<Icon name="bulb" size={14} color={palette().textMuted} />}>
          <BrandSpinner size={12} color={palette().accent} variant="matrix" />
        </If>
        <Text style={textStyle("label", { color: palette().textMuted })}>
          {props.live
            ? tr("state.thinking")
            : props.kind === "summary"
              ? tr("chat.thinkingSummary")
              : tr("chat.thinking")}
        </Text>
        <View style={{ flexShrink: 0, ...rotatingChevronStyle(expanded()) }}>
          <Icon name="chevron-right" size={12} color={palette().textMuted} />
        </View>
      </View>
      <If when={expanded()}>
        {() => {
          const reveal = subtleCrossfadeMotion();
          return (
            <View
              style={[
                {
                  marginLeft: 6,
                  paddingLeft: 12,
                  borderLeftWidth: 2,
                  borderColor: props.live ? palette().accentBorder : palette().borderSubtle,
                },
                reveal.style,
              ]}
            >
              <Scroll ref={tailRef} style={{ maxHeight: 300, minHeight: 0 }} scrollbar={true}>
                <TextView
                  markdown={props.text}
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
  const ws = activeWorkspace() as
    | ({ workspaceKind?: string; sshHost?: string; remoteConnectionId?: string } | null | undefined);
  if (!ws) return false;
  const kind = (ws.workspaceKind ?? "").toLowerCase();
  return kind === "remote" || kind === "remote_ssh" || kind === "docker" || kind === "wsl" || Boolean(ws.sshHost) || Boolean(ws.remoteConnectionId);
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
      openImageLightbox({ src: `file://${resolved.path}`, title: title || resolved.path.split("/").pop() });
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
        <MarkdownBody text={props.text.slice(0, cut())} />
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

/**
 * One ordered transcript item, drawn the same way whether it is live or
 * persisted. A key always names the same kind (the key carries it), so the
 * branch is chosen once; the fields are read through `props` so a streamed
 * item updates in place.
 */
function TranscriptItemView(props: { item: TranscriptItem; live?: boolean; preserveFullReply?: boolean }) {
  switch (props.item.kind) {
    case "text":
      return (
        <AnswerMarkdown
          text={(props.item as ItemOf<"text">).text}
          live={props.live}
          itemKey={props.item.key}
          preserveFullReply={props.preserveFullReply}
        />
      );
    case "thinking":
      return (
        <ThinkingBlock
          partKey={props.item.key}
          text={(props.item as ItemOf<"thinking">).text}
          kind={(props.item as ItemOf<"thinking">).reasoningKind}
          live={(props.item as ItemOf<"thinking">).live}
        />
      );
    case "tool":
      if (isGenUICall((props.item as ItemOf<"tool">).call)) {
        // A GenerativeUI answer is drawn as the interface it describes.
        return (
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
        );
      }
      return (
        <ToolCard
          call={(props.item as ItemOf<"tool">).call}
          cardId={props.item.key}
          status={persistedToolState((props.item as ItemOf<"tool">).call)}
        />
      );
    case "explore":
      return (
        <ExploreGroupCard
          calls={(props.item as ItemOf<"explore">).calls}
          cardId={props.item.key}
          stateOf={persistedToolState}
          live={props.live}
        />
      );
  }
}

/** Renders an ordered item list; rows are kept by the item's key. */
function TranscriptItems(props: { items: TranscriptItem[]; live?: boolean; preserveFullReply?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Each of={props.items} key={item => item.key}>
        {item => <TranscriptItemView item={item()} live={props.live} preserveFullReply={props.preserveFullReply} />}
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

/**
 * A live round as the same ordered items a persisted round becomes: its
 * reasoning, then its answer cut at every tool call (each tool remembers how much
 * text had streamed when it appeared), with explore runs folded like history.
 */
function liveRoundItems(round: LiveModelRound, singleRound: boolean, pane: 0 | 1 = 0): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const thinking = pane === 1 ? getSecondaryLiveRoundThinking(round.roundId) : getLiveRoundThinking(round.roundId);
  const text = pane === 1 ? getSecondaryLiveRoundText(round.roundId) : getLiveRoundText(round.roundId);
  if (thinking.trim()) {
    items.push({
      kind: "thinking",
      key: round.roundId === "__default__" || singleRound ? "live-thinking" : `live-thinking-${round.roundId}`,
      text: thinking,
      ...(round.reasoningKind ? { reasoningKind: round.reasoningKind } : {}),
      live: !round.completed && !text,
    });
  }
  let cursor = 0;
  let segment = 0;
  for (const tool of round.tools) {
    const offset = Math.min(text.length, Math.max(cursor, tool.textOffset ?? cursor));
    const before = text.slice(cursor, offset);
    if (before.trim()) {
      items.push({ kind: "text", key: `live-text-${round.roundId}-${segment}`, text: before });
    }
    segment += 1;
    cursor = offset;
    items.push({ kind: "tool", key: `tool:${tool.toolId}`, call: liveToolToCallView(tool) });
  }
  const rest = text.slice(cursor);
  if (rest.trim()) items.push({ kind: "text", key: `live-text-${round.roundId}-${segment}`, text: rest });
  return groupExploreItems(items);
}

const liveRounds = computed<LiveModelRound[]>(() => liveTurn()?.rounds ?? []);

type LiveDisplayBlock =
  | { kind: "round"; key: string; round: LiveModelRound }
  | { kind: "explore"; key: string; calls: ToolCallView[] };

function isPureExploreLiveRound(round: LiveModelRound, pane: 0 | 1 = 0): boolean {
  if (round.tools.length === 0) return false;
  const hasThinking = pane === 1 ? hasSecondaryLiveRoundThinking(round.roundId) : hasLiveRoundThinking(round.roundId);
  const hasText = pane === 1 ? hasSecondaryLiveRoundText(round.roundId) : hasLiveRoundText(round.roundId);
  if (hasThinking || hasText) return false;
  return round.tools.every(tool => {
    const name = tool.effectiveToolName || tool.toolName;
    const status = (tool.status ?? "").toLowerCase();
    return isExploreTool(name) && !tool.error && status !== "failed" && status !== "error";
  });
}

function buildLiveDisplayBlocks(rounds: LiveModelRound[], pane: 0 | 1 = 0): LiveDisplayBlock[] {
  const blocks: LiveDisplayBlock[] = [];
  let exploreRun: LiveModelRound[] = [];
  const flushExplore = () => {
    if (exploreRun.length === 0) return;
    const calls = exploreRun.flatMap(round => round.tools.map(liveToolToCallView));
    if (calls.length >= 2) {
      blocks.push({ kind: "explore", key: `explore:tool:${calls[0]!.id}`, calls });
    } else {
      for (const round of exploreRun) {
        blocks.push({ kind: "round", key: round.roundId, round });
      }
    }
    exploreRun = [];
  };
  for (const round of rounds) {
    if (isPureExploreLiveRound(round, pane)) {
      exploreRun.push(round);
      continue;
    }
    flushExplore();
    blocks.push({ kind: "round", key: round.roundId, round });
  }
  flushExplore();
  return blocks;
}

/**
 * Live rounds grouped like settled history: consecutive explore-only rounds
 * fold immediately into one collapsed `ExploreGroupCard` instead of rendering
 * separate rows live and collapsing when the turn settles.
 */
const liveDisplayBlocks = computed<LiveDisplayBlock[]>(() => buildLiveDisplayBlocks(liveRounds(), 0));

/**
 * Per-round live view: each round owns its own `computed`, so when round N
 * streams text or thinking, completed rounds 0..N-1 never re-slice text or
 * rebuild their item lists.
 */
function LiveRoundView(props: { round: () => LiveModelRound; singleRound: () => boolean; pane?: 0 | 1 }) {
  const items = computed<TranscriptItem[]>(() => liveRoundItems(props.round(), props.singleRound(), props.pane ?? 0));
  return (
    <If when={items().length > 0}>
      <TranscriptItems items={items()} live={true} />
    </If>
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
          <Icon name={cancelled() ? "info" : "close"} size={14} color={cancelled() ? palette().textMuted : palette().danger} />
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
let transcriptScrollRef: ScrollRef | undefined;
let transcriptScrollRafId: number | null = null;
let peakFollowScrollY = 0;
let lastObservedScrollY = 0;
let lastContentHeight = 0;
let lastViewportHeight = 0;
let lastEventContentHeight = 0;
let lastEventViewportHeight = 0;
let pendingSyncBottomSnap = false;
let pendingPrependScrollAnchor: { prevHeight: number; prevScrollY: number; anchorKey: string } | null = null;

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
  lastContentHeight = 0;
  lastViewportHeight = 0;
  lastEventContentHeight = 0;
  lastEventViewportHeight = 0;
  pendingSyncBottomSnap = false;
  pendingPrependScrollAnchor = null;
  turnOffsets.clear();
  suppressAutoFollowUntil = 0;
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
      transcriptScrollRef?.scrollToEnd({ animated: false });
    });
    return;
  }
  transcriptScrollRef?.scrollToEnd({ animated: false });
}

function jumpToTranscriptEnd(): void {
  suppressAutoFollowUntil = 0;
  followLatest.set(true);
  peakFollowScrollY = lastObservedScrollY;
  cancelScheduledTranscriptScroll();
  transcriptScrollRef?.scrollToEnd({ animated: false });
  stickToTranscriptEnd();
  syncActiveRailTurn(lastObservedScrollY);
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
    syncActiveRailTurn(y);
    return;
  }

  if (followLatest()) {
    // Adjust the high-water mark for browser scrollTop clamping when the
    // viewport grows (e.g. composer shrinks on submit / ambient strip unmounts)
    // or content shrinks (e.g. live thinking collapses), so layout clamping is
    // never mistaken for a manual upward scroll.
    if (viewportGrow > 0 || contentShrink > 0) {
      peakFollowScrollY = Math.max(0, peakFollowScrollY - viewportGrow - contentShrink);
    }
    // Only unlock when the user genuinely scrolls upward away from the
    // bottom-following offset — never when streamed content grows
    // `contentSize.height` or the ambient strip/composer shrinks the viewport
    // under a stationary scroll position.
    if (y < peakFollowScrollY - 4) {
      followLatest.set(false);
      cancelScheduledTranscriptScroll();
    } else if (y > peakFollowScrollY) {
      peakFollowScrollY = y;
    }
  }
  syncActiveRailTurn(y);
  // Proactively lazy-load earlier turns as the reader nears the top of a windowed
  // history, keeping scrollback smooth without slamming into the top boundary.
  if (y <= 140 && !followLatest() && contentHeight > viewportHeight && hasEarlierTurns() && !loadingEarlier()) {
    void showEarlierTurns();
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
const visibleTurnRows = computed<TurnRow[]>(() => {
  const rows = stableTurnRows();
  const live = liveTurn();
  if (!live?.turnId) return rows;
  return rows.filter(row => turnKeyOf(row.turn) !== live.turnId);
});

/** The persisted turns the transcript draws, in order. */
const visibleTurns = computed(() => visibleTurnRows().map(row => row.turn));

const loadingEarlier = signal(false);
let earlierRevealTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Widens the history window and keeps the turn that was first on screen where
 * the reader left it, so older turns appear above instead of jumping the view.
 */
async function showEarlierTurns(): Promise<void> {
  if (loadingEarlier() || !hasEarlierTurns()) return;
  const anchorKey = turnKeyOf(visibleTurns()[0]);
  loadingEarlier.set(true);
  followLatest.set(false);
  pendingPrependScrollAnchor = {
    prevHeight: lastContentHeight,
    prevScrollY: lastObservedScrollY,
    anchorKey,
  };
  try {
    await loadEarlierTurns();
  } finally {
    loadingEarlier.set(false);
  }
  // Fallback reveal only if `onLayout` has not already restored the exact offset.
  if (anchorKey && pendingPrependScrollAnchor?.anchorKey === anchorKey) {
    if (earlierRevealTimer) clearTimeout(earlierRevealTimer);
    earlierRevealTimer = setTimeout(() => {
      earlierRevealTimer = null;
      if (pendingPrependScrollAnchor?.anchorKey === anchorKey) {
        pendingPrependScrollAnchor = null;
        turnRefs.get(anchorKey)?.reveal({ vertical: "start", animated: false });
      }
    }, 32);
  }
}

/**
 * One settled turn. Its row is kept by the turn's id and its record keeps its
 * identity while unchanged (`stableTurnRows`), so a streaming chunk, a reload or
 * "Load earlier" never evaluates this subtree again.
 */
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

function TranscriptTurn(props: {
  turn: () => unknown;
  rowKey: string;
  pane?: 0 | 1;
  onRegisterRef?: (turnId: string, rowKey: string, el: ViewRef | null) => void;
  onLayoutOffset?: (rowKey: string, y: number) => void;
}) {
  const isSecondary = props.pane === 1;
  const key = computed(() => turnKeyOf(props.turn()));
  const matches = computed(() =>
    isSecondary ? false : turnMatchesSearch(props.turn(), transcriptSearchQuery()),
  );
  const items = computed(() => turnItems(props.turn()));
  const hovered = signal(false);
  return (
    <View
      ref={el => {
        if (props.onRegisterRef) {
          props.onRegisterRef(key(), props.rowKey, el);
        } else {
          registerTurnRef(key(), el);
          registerTurnRowRef(props.rowKey, el);
        }
      }}
      onLayout={event => {
        if (props.onLayoutOffset) props.onLayoutOffset(props.rowKey, event.bounds.origin.y);
        else recordTurnOffset(props.rowKey, event.bounds.origin.y);
      }}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        gap: space.md,
        marginHorizontal: matches() ? -space.sm : 0,
        paddingHorizontal: matches() ? space.sm : 0,
        paddingVertical: matches() ? space.sm : 0,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: matches() ? 1 : 0,
        borderColor: activeSearchTurnKey() === key() ? palette().accent : palette().accentBorder,
        backgroundColor: matches() ? palette().accentSoft : "transparent",
      }}
    >
      <Each of={userPartsOf(props.turn())} key="index">
        {part => (
          <UserBubble
            partKey={`${isSecondary ? "sec-" : ""}${turnPartKey(props.turn(), part())}`}
            text={part().text}
            timestamp={turnTimestampOf(props.turn())}
            turnId={key()}
            images={userImagesOf(props.turn())}
          />
        )}
      </Each>

      <If when={!isSecondary && Boolean(rerunTarget() && rerunTarget()!.turnId === key())}>
        <RerunEditor />
      </If>

      <TranscriptItems items={items()} preserveFullReply={!isSecondary && liveStreamedTurnIds.has(key())} />

      <If when={publishedFiguresOf(props.turn()).length > 0}>
        <View style={{ gap: space.xs }}>
          <Each of={publishedFiguresOf(props.turn())} key={fig => fig.path}>
            {fig => <InlineFigureCard figure={fig()} />}
          </Each>
        </View>
      </If>

      <If when={turnFailureOf(props.turn())}>
        {failure => <TurnFailureNotice turn={props.turn()} failure={failure()} pane={props.pane} />}
      </If>

      <If when={turnFileChangesOf(props.turn()).length > 0}>
        <TurnFileChangesCard
          turnId={key()}
          changes={turnFileChangesOf(props.turn())}
          onReview={filePath =>
            openTurnChangesReview(
              key(),
              turnFileChangesOf(props.turn()),
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

      <If when={items().length > 0}>
        <TurnFooter turn={props.turn()} visible={hovered() || compactLayout()} />
      </If>
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
            <Scroll style={{ maxHeight: 360 }} scrollbar={false}>
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

function Transcript() {
  resetTranscriptScrollTracking();
  registerTranscriptAutoBackfillGuard(() => followLatest());
  registerTranscriptBeforePrependListener(() => {
    if (followLatest()) {
      pendingSyncBottomSnap = true;
    } else if (!pendingPrependScrollAnchor && lastContentHeight > 0) {
      pendingPrependScrollAnchor = {
        prevHeight: lastContentHeight,
        prevScrollY: lastObservedScrollY,
        anchorKey: turnKeyOf(visibleTurns()[0]),
      };
    }
  });
  cleanup(() => {
    registerTranscriptAutoBackfillGuard(null);
    registerTranscriptBeforePrependListener(null);
  });
  let lastSessionId = activeSessionId();
  let lastOptimisticText = optimisticUserText();
  let pendingInitialBottomSnap = Boolean(lastSessionId);
  let transcriptSwapMounts = 0;
  const transcriptSwapKey = () =>
    activeSessionKey() ? `${activeSessionKey()}:${turnsLoading() ? "loading" : "ready"}` : "welcome";

  effect(() => {
    const id = activeSessionId();
    if (id !== lastSessionId) {
      lastSessionId = id;
      pendingInitialBottomSnap = Boolean(id);
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
    isStreamDraining();
    stickToTranscriptEnd();
  });

  return (
    <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <Scroll
        ref={transcriptScrollRef}
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{
          flexGrow: 1,
          paddingLeft: paneTranscriptPadLeft(visibleTurnRows().length >= 2),
          paddingRight: sessionsPadX(),
          paddingTop: space.xl,
          paddingBottom: space.x3l,
        }}
        onScroll={handleTranscriptScroll}
        onLayout={event => {
          const height = event.bounds.size.height;
          if (height > 0 && Math.abs(height - lastViewportHeight) > 1) {
            lastViewportHeight = height;
            if (followLatest()) stickToTranscriptEnd();
          }
        }}
      >
        <Each of={[transcriptSwapKey()]} key={k => k}>
          {() => {
            const shouldAnimate = transcriptSwapMounts > 0;
            transcriptSwapMounts += 1;
            const swapMotion = shouldAnimate ? subtleCrossfadeMotion() : null;
            return (
              <View
                onLayout={event => {
                  const height = event.bounds.size.height;
                  if (height > 0 && Math.abs(height - lastContentHeight) > 1) {
                    const prevHeight = lastContentHeight;
                    lastContentHeight = height;
                    if (followLatest()) {
                      if ((pendingInitialBottomSnap || pendingSyncBottomSnap) && sessionTurns().length > 0) {
                        pendingInitialBottomSnap = false;
                        pendingSyncBottomSnap = false;
                        cancelScheduledTranscriptScroll();
                        transcriptScrollRef?.scrollToEnd({ animated: false });
                      } else {
                        stickToTranscriptEnd();
                      }
                    } else if (pendingPrependScrollAnchor && height > prevHeight && prevHeight > 0) {
                      const anchor = pendingPrependScrollAnchor;
                      pendingPrependScrollAnchor = null;
                      const delta = height - anchor.prevHeight;
                      if (delta > 0) {
                        const targetY = Math.max(0, anchor.prevScrollY + delta);
                        lastObservedScrollY = targetY;
                        transcriptScrollRef?.scrollTo({ y: targetY, animated: false });
                      }
                    }
                  }
                }}
                style={[
                  {
                    width: "100%",
                    maxWidth: contentWidth(),
                    alignSelf: "center",
                    flexGrow: isTranscriptEmpty() ? 1 : 0,
                    gap: 16,
                  },
                  swapMotion?.style,
                ]}
              >
          <If when={isTranscriptEmpty()}>
            <WelcomeStudio />
          </If>

          <If when={transcriptNotice()}>
            {notice => (
              <View
                accessibilityLabel="transcript-host-update"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 12,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Icon name="info" size={14} color={palette().textSecondary} />
                <Text style={{ flex: 1, color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>
                  {notice()}
                </Text>
              </View>
            )}
          </If>

          <If when={hasEarlierTurns() && sessionTurns().length > 0}>
            <View style={{ alignSelf: "center" }}>
              <Button
                label={loadingEarlier() ? tr("chat.loadingEarlier") : tr("chat.loadEarlier")}
                variant="ghost"
                size="xs"
                leadingIcon="history"
                loading={loadingEarlier()}
                accessibilityLabel="load-earlier-turns"
                onPress={() => void showEarlierTurns()}
              />
            </View>
          </If>

          <Each of={visibleTurnRows()} key={row => row.key}>
            {row => <TranscriptTurn turn={() => row().turn} rowKey={row().key} />}
          </Each>

          <If when={Boolean(optimisticUserText()) || pendingTurnImages().length > 0 || liveDisplayBlocks().length > 0 || liveFallbackItems().length > 0}>
            {/* Mirrors `TranscriptTurn`'s exact `gap: space.md` and `TurnFooter` height so settling into a persisted turn causes 0px vertical jump. */}
            <View style={{ gap: space.md }}>
              <If when={Boolean(optimisticUserText()) || pendingTurnImages().length > 0}>
                <UserBubble
                  partKey={`pending-${pendingTurnState()?.turnId || optimisticUserText() || pendingTurnImages().length}`}
                  text={optimisticUserText()}
                  images={pendingTurnImages()}
                  timestamp={pendingTurnState()?.createdAt}
                  showCopy={false}
                />
              </If>

              <If when={liveDisplayBlocks().length > 0}>
                <View style={{ gap: 8 }}>
                  <Each of={liveDisplayBlocks()} key={block => block.key}>
                    {block => (
                      <If
                        when={block().kind === "explore"}
                        else={
                          <LiveRoundView
                            round={() => (block() as Extract<LiveDisplayBlock, { kind: "round" }>).round}
                            singleRound={() => liveRounds().length === 1}
                          />
                        }
                      >
                        <ExploreGroupCard
                          calls={(block() as Extract<LiveDisplayBlock, { kind: "explore" }>).calls}
                          cardId={block().key}
                          stateOf={persistedToolState}
                          live={true}
                        />
                      </If>
                    )}
                  </Each>
                </View>
              </If>
              <If when={liveFallbackItems().length > 0}>
                <TranscriptItems items={liveFallbackItems()} live={true} />
              </If>
              <If when={liveDisplayBlocks().length > 0 || liveFallbackItems().length > 0}>
                <View style={{ height: compactLayout() ? layout.touchTarget : controlHeight.sm }} />
              </If>
            </View>
          </If>

          <If when={turnError()}>
            {message => (
              <InlineBanner
                tone="danger"
                message={localizeHostError(message())}
                actionLabel={isAuthRequiredError(message()) ? tr("devices.signInCta") : undefined}
                onAction={
                  isAuthRequiredError(message())
                    ? () => openAccountAuthModal({ autoStart: true })
                    : undefined
                }
                onDismiss={() => turnError.set("")}
              />
            )}
          </If>

          <If when={sendNotice()}>
            {message => (
              <InlineBanner
                tone="warning"
                accessibilityLabel="send-host-update"
                message={message()}
                onDismiss={() => sendNotice.set("")}
              />
            )}
          </If>
              </View>
            );
          }}
        </Each>
      </Scroll>

      <TurnJumpRail
        rows={visibleTurnRows}
        previewOf={key => turnJumpPreview(visibleTurnRows(), key)}
        activeKey={activeRailTurnKey}
        onJump={jumpToTurn}
        accessibilityLabel="turn-jump-rail"
        tickPrefix="turn-jump-"
      />

      <If when={!followLatest()}>
        <LatestPill />
      </If>
    </View>
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
          padding: space.chip,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Scroll style={{ maxHeight: 300, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.hair }}>
          <If when={cmdCount() > 0}>
            <Text
              style={{
                paddingHorizontal: space.sm,
                paddingTop: space.hair,
                paddingBottom: space.xs,
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.3),
                fontWeight: "600",
              }}
            >
              {tr("chat.slash.title")}
            </Text>
            <Each of={slashMatches() ?? []} key={entry => entry.id}>
              {(entry, idx) => (
                <View
                  role="button"
                  accessibilityLabel={`slash-command-${entry().id}`}
                  onPress={() => void executeSlashCommand(entry())}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: compactLayout() ? layout.touchTarget : 30,
                    gap: space.sm,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.chip,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    backgroundColor: idx() === slashSelectedIndex() ? palette().accentSoft : "transparent",
                    cursor: "pointer",
                    userSelect: "none",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <Text
                    style={{
                      color: idx() === slashSelectedIndex() ? palette().accent : palette().text,
                      fontFamily: fontMono,
                      fontSize: textSize(12.5),
                      lineHeight: textLineHeight(12.5, 1.35),
                      fontWeight: "500",
                      flexShrink: 0,
                    }}
                  >
                    {entry().command}
                  </Text>
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {slashCommandLabel(entry())}
                  </Text>
                </View>
              )}
            </Each>
          </If>

          <If when={slashSkillMatches().length > 0}>
            <Text
              style={{
                paddingHorizontal: space.sm,
                paddingTop: cmdCount() > 0 ? space.sm : space.hair,
                paddingBottom: space.xs,
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.3),
                fontWeight: "600",
              }}
            >
              {tr("sessions.slashSkillsSection")}
            </Text>
            <Each of={slashSkillMatches()} key={skill => skill.name}>
              {(skill, idx) => {
                const flatIndex = () => cmdCount() + idx();
                return (
                  <View
                    role="button"
                    accessibilityLabel={`slash-skill-${skill().name}`}
                    onPress={() => insertSlashSkill(skill(), composerInputRef)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      minHeight: compactLayout() ? layout.touchTarget : 30,
                      gap: space.sm,
                      paddingHorizontal: space.sm,
                      paddingVertical: space.chip,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      backgroundColor: flatIndex() === slashSelectedIndex() ? palette().accentSoft : "transparent",
                      cursor: "pointer",
                      userSelect: "none",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().panelHover }}
                    focusVisibleStyle={focusRingStyle(-1)}
                  >
                    <Icon
                      name="sparkles"
                      size={12}
                      color={flatIndex() === slashSelectedIndex() ? palette().accent : palette().textMuted}
                    />
                    <Text
                      style={{
                        color: flatIndex() === slashSelectedIndex() ? palette().accent : palette().text,
                        fontFamily: fontMono,
                        fontSize: textSize(12.5),
                        lineHeight: textLineHeight(12.5, 1.35),
                        fontWeight: "500",
                        flexShrink: 0,
                      }}
                    >
                      {`/${skill().name}`}
                    </Text>
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.35),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {skill().description || skill().argumentHint || ""}
                    </Text>
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
  return (
    <View
      testID="permission-mode-surface"
      accessibilityLabel={`permission-mode-popover-${props.align}`}
      style={[
        overlayPopoverStyle(),
        {
          width: 280,
          maxWidth: "92%",
          padding: space.chip,
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
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              minHeight: compactLayout() ? layout.touchTarget : undefined,
              gap: space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.chip,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              cursor: "pointer",
              userSelect: "none",
              backgroundColor:
                (row().mode === null && followsDefaultMode(targetSessionId())) ||
                (row().mode !== null &&
                  !followsDefaultMode(targetSessionId()) &&
                  effectivePermissionMode(targetSessionId()) === row().mode)
                  ? palette().surfaceSubtle
                  : "transparent",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
              <Text style={{ color: palette().text, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.35), fontWeight: "500" }}>
                {row().mode === null
                  ? tr("chat.permissionMode.defaultWith", { mode: permissionModeLabel(permissionMode() ?? "ask") })
                  : tr(row().labelKey)}
              </Text>
              <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
                {tr(row().detailKey)}
              </Text>
            </View>
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

const activeContextUsage = computed(() => {
  const sessionId = activeSessionId();
  const usage = sessionId ? contextUsage()[sessionId] : undefined;
  if (!usage) return null;
  const fallbackMax =
    chatModels().find(model => model.id === activeModelId())?.contextWindow ??
    fleetChoiceOf(activeModelId())?.choice.contextWindow ??
    null;
  const max = usage.max ?? fallbackMax;
  return { ...usage, max, ratio: max && max > 0 ? Math.min(1, usage.used / max) : null };
});

/** How full the context window is, as a ring with the numbers behind it on press. */
function ContextUsageRing() {
  let triggerRef: ViewRef | null = null;
  return (
    <If when={activeContextUsage()}>
      {usage => (
        <View
          ref={el => {
            triggerRef = el;
            contextRingAnchor.set(el);
          }}
          style={{ flexShrink: 0 }}
        >
          <View
            role="button"
            accessibilityLabel="context-usage"
            tooltip={<TooltipBubble text={tr("chat.context.tooltip")} />}
            onPress={() => {
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
    contextUsagePlacement.set("top");
  });
  return (
    <If when={activeContextUsage()}>
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

/** Where dictated text goes: appended to the draft, or appended and sent. */
const composerVoiceActions: VoiceComposerActions = {
  insert(text) {
    const current = composerText();
    const separator = current && !/\s$/.test(current) ? " " : "";
    composerText.set(`${current}${separator}${text}`);
  },
  send(text) {
    composerVoiceActions.insert(text);
    void submitComposer();
  },
  disabled: () => composerDisabled(),
};

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
 * Shared floating elevated composer container used by Primary, Secondary Split, and BTW panes.
 * Guarantees pixel-identical padding, width, radius, border, shadow, hover/focus ring, and drag feedback.
 */
function ComposerCardShell(props: {
  dragActive?: () => boolean;
  inactive?: () => boolean;
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
  const inactive = () => Boolean(props.inactive?.()) && !dragging();
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
          ref={props.cardRef}
          style={{
            width: "100%",
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: dragging() ? palette().accent : inactive() ? palette().borderSubtle : palette().border,
            backgroundColor: dragging() ? palette().accentSoft : inactive() ? palette().canvas : palette().inputBg,
            boxShadow: inactive() ? undefined : palette().shadowComposer,
            opacity: inactive() ? 0.78 : 1,
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

function ComposerDock() {
  ensureModelsLoaded();
  ensureQuickActions();
  ensurePromptSuggestionSettingLoaded();
  void ensureVoiceSettings();
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

  const paneWidth = signal(0);
  const compactComposer = () => sessionsCompact();
  const collapseInlineControls = () => compactComposer() || (paneWidth() > 0 && paneWidth() < 420);
  const hasPayload = () =>
    composerText().trim().length > 0 || imageAttachments().length > 0 || fileAttachments().length > 0;

  return (
    <View>
      <ComposerCardShell
        dragActive={composerFileDragActive}
        inactive={() => splitPaneOpen() && !compactLayout() && focusedPane() !== 0}
        cardRef={el => composerCardAnchor.set(el)}
        onLayoutWidth={w => {
          if (Math.abs(w - paneWidth()) > 1) paneWidth.set(w);
        }}
        onFileDragEnter={() => composerFileDragActive.set(true)}
        onFileDragLeave={() => composerFileDragActive.set(false)}
        onFileDrop={event => handleComposerFileDrop(event)}
        aboveCard={
          <>
            {/* Band 1: Pending Agent Mode Confirmation Banner (when triggered) */}
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

            {/* Band 2: Collapsible Pending Queue Drawer */}
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
      >
        {/* Attachment Strip (uniform 34px images & compact file chips) */}
        <ComposerAttachmentStrip
          images={imageAttachments}
          files={fileAttachments}
          notice={attachmentNotice}
          onRemoveImage={id => removeAttachment(id)}
          onRemoveFile={id => removeFileAttachment(id)}
        />

        <VoiceDictationBar actions={composerVoiceActions} />

        {/* Multiline Editor — right edge aligned with bottom Send button */}
        <View
          style={{
            paddingLeft: space.lg,
            paddingRight: collapseInlineControls() ? space.sm : space.md,
            paddingTop: space.md,
            paddingBottom: space.xs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
            <Input
              ref={composerInputRef}
              value={composerText()}
              placeholder={
                composerDisabled()
                  ? offlineNoticeText() || tr("sessions.noSessionSelected")
                  : runningTurnId()
                    ? midTurnSendPolicy() === "queue"
                      ? tr("sessions.composerQueuePlaceholder")
                      : tr("session.placeholderRunning")
                    : activePromptSuggestion() || tr("session.placeholder")
              }
              accessibilityLabel="composer"
              multiline={true}
              readonly={composerDisabled()}
              submitBehavior="submit"
              pasteBehavior="report"
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
              onFocus={() => {
                if (splitPaneOpen()) focusPane(0);
              }}
              onChange={event => {
                const prev = composerText();
                const next = event.value;
                composerText.set(next);
                const prevCaret = composerCaretPos();
                const delta = next.length - prev.length;
                const estimatedCaret =
                  prevCaret >= 0 && prevCaret <= prev.length
                    ? Math.max(0, Math.min(next.length, prevCaret + delta))
                    : next.length;
                composerCaretPos.set(estimatedCaret);
                syncInlineMention(next, estimatedCaret);
              }}
              onCompositionChange={event => composerComposing.set(event.composing)}
              onSelectionChange={event => {
                composerCaretPos.set(event.end);
                syncInlineMention(composerText(), event.end, true);
              }}
              onCaretMove={event => composerCaretBounds.set(event.pageBounds)}
              onPaste={event => void handleComposerPaste(event)}
              onKeyPress={event => {
                if (mentionOpen() && mentionInline()) {
                  handleMentionKeyNavigation(event.key);
                  return;
                }
                if (slashPopoverVisible() && handleSlashKeyNavigation(event.key)) {
                  return;
                }
                if (
                  !composerComposing() &&
                  !composerText() &&
                  (event.key === "Tab" || event.key === "ArrowRight")
                ) {
                  acceptActivePromptSuggestion();
                }
              }}
              onSubmit={() => void submitComposer()}
            />
            <If when={activePromptSuggestion()}>
              <View
                role="button"
                accessibilityLabel="accept-prompt-suggestion"
                tooltip={<TooltipBubble text={tr("sessions.promptSuggestionAcceptTooltip")} />}
                onPress={() => acceptActivePromptSuggestion()}
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

        {/* Calm Bottom Action Bar (single-row, legible even in 4-region split) */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: collapseInlineControls() ? space.xs : space.chip,
            paddingHorizontal: collapseInlineControls() ? space.sm : space.md,
            paddingTop: space.xs,
            paddingBottom: space.sm,
          }}
        >
          {/* Left: "+" (rarely used items), agent, model. Narrow: "+" holds them all. */}
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
                composerPlusAnchor.set(el);
                quickActionsAnchor.set(el);
                permissionPillAnchor.set(el);
              }}
              style={{ flexShrink: 0 }}
            >
              <If
                when={compactComposer()}
                else={
                  <IconButton
                    icon="plus"
                    size="sm"
                    iconSize={15}
                    active={composerPlusOpen()}
                    accessibilityLabel="composer-plus"
                    tooltip={tr("chat.polish.moreControls")}
                    style={{ borderRadius: radii.pill }}
                    onPress={toggleComposerPlus}
                  />
                }
              >
                <TouchTargetButton
                  icon="plus"
                  tone={composerPlusOpen() ? "active" : "ghost"}
                  accessibilityLabel="composer-plus"
                  onPress={toggleComposerPlus}
                />
              </If>
            </View>
            <If when={!collapseInlineControls()}>
              <View
                style={{
                  width: 1,
                  height: 14,
                  marginHorizontal: space.hair,
                  flexShrink: 0,
                  backgroundColor: palette().borderSubtle,
                }}
              />
              <AgentPickerTrigger compact={compactComposer} />
              <ModelReasoningCapsule compact={compactComposer} />
            </If>
          </View>

          {/* Right: quiet status utilities (full-access shield, voice, context ring) + primary Send / Stop */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexShrink: 0,
              gap: compactComposer() ? space.hair : space.xs,
            }}
          >
            <ComposerFullAccessShield
              sessionId={activeSessionId}
              compact={compactComposer}
              accessibilityLabel="permission-mode-warning"
              onPress={anchor => {
                permissionModeTarget.set(null);
                permissionPillAnchor.set(anchor);
                permissionModeAlign.set("end");
                const next = !permissionModePickerOpen();
                closePickers();
                permissionModePickerOpen.set(next);
              }}
            />
            <VoiceInputButtons actions={composerVoiceActions} />
            <If when={!compactComposer()}>
              <ContextUsageRing />
            </If>
            <ComposerSubmitAction
              running={() => Boolean(runningTurnId())}
              canSend={hasPayload}
              disabled={composerDisabled}
              compact={compactComposer}
              sendLabel="Send"
              stopLabel="Stop"
              onSend={() => void submitComposer()}
              onStop={() => void stopRunningTurn()}
            />
          </View>
        </View>
      </ComposerCardShell>

      <DropdownMenu
        open={composerPlusOpen()}
        anchor={composerPlusAnchor()}
        items={composerPlusItems(collapseInlineControls())}
        placement="top"
        align="start"
        onClose={() => composerPlusOpen.set(false)}
      />

      {/* Anchored Frosted Overlays Above Composer */}
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
          onPressOutside={() => closePickers()}
          onCancel={() => closePickers()}
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
            contextUsagePlacement.set("top");
          }}
          onCancel={() => {
            contextPopoverOpen.set(false);
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
          onPressOutside={() => closePickers()}
          onCancel={() => closePickers()}
        >
          <ReasoningPickerSurface placement={reasoningPickerPlacement()} />
        </Overlay>
      </If>
    </View>
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
          flexShrink: 1,
          maxWidth: props.compact() ? 120 : 148,
          paddingHorizontal: space.sm,
          borderRadius: radii.pill,
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

/** Compact icon-anchored Model pill paired with a quiet icon-first Reasoning toggle. */
function ModelReasoningCapsule(props: {
  compact: () => boolean;
  modelAccessibilityLabel?: string;
  reasoningAccessibilityLabel?: string;
  onFocusPane?: () => void;
}) {
  let modelTriggerRef: ViewRef | null = null;
  let reasoningTriggerRef: ViewRef | null = null;
  const reasoningElevated = computed(() => {
    const id = activeReasoningId();
    return Boolean(id && id !== "default");
  });
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
          if (!props.onFocusPane) modelPickerAnchor.set(el);
        }}
        role="button"
        accessibilityLabel={props.modelAccessibilityLabel ?? "bot-capsule-trigger"}
        tooltip={
          <TooltipBubble
            text={tr("sessions.modelLabel", {
              name: activeModelDetail() ? `${activeModelLabel()} · ${activeModelDetail()}` : activeModelLabel(),
            })}
          />
        }
        onPress={() => {
          props.onFocusPane?.();
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
          {activeModelLabel()}
        </Text>
        <Icon
          name={modelPickerOpen() ? "chevron-up" : "chevron-down"}
          size={10}
          color={palette().textMuted}
        />
      </View>

      <If when={activeReasoningChoices().length > 0}>
        <View
          ref={el => {
            reasoningTriggerRef = el;
            if (!props.onFocusPane) reasoningPickerAnchor.set(el);
          }}
          role="button"
          accessibilityLabel={props.reasoningAccessibilityLabel ?? "reasoning-picker"}
          tooltip={
            <TooltipBubble
              text={tr("sessions.reasoningLabel", { name: activeReasoningLabel() })}
            />
          }
          onPress={() => {
            props.onFocusPane?.();
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
              {activeReasoningLabel()}
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
          padding: space.md,
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
        <Scroll style={{ maxHeight: 240, minHeight: 0 }} scrollbar={true}>
          <View style={{ gap: space.hair }}>
            <Each of={mentionHits()} key={hit => hit.path}>
              {(hit, idx) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.hair,
                    borderRadius: radii.xs,
                    borderCurve: "continuous",
                    backgroundColor:
                      idx() === mentionSelectedIndex() ? palette().accentSoft : "transparent",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
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
                      minHeight: compactLayout() ? layout.touchTarget : 30,
                      gap: space.sm,
                      paddingHorizontal: space.sm,
                      paddingVertical: space.chip,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    activeStyle={{ opacity: 0.9 }}
                    focusVisibleStyle={focusRingStyle(-1)}
                  >
                    <Icon
                      name={hit().directory ? "folder" : "file-code"}
                      size={13}
                      color={
                        idx() === mentionSelectedIndex()
                          ? palette().accent
                          : hit().directory
                            ? palette().accent
                            : palette().textSecondary
                      }
                    />
                    <Text
                      style={{
                        maxWidth: "56%",
                        flexShrink: 0,
                        color:
                          idx() === mentionSelectedIndex() ? palette().accent : palette().text,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.35),
                        fontWeight: "600",
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {hit().name}
                    </Text>
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "right",
                        color: palette().textElevatedMuted,
                        fontFamily: fontMono,
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.3),
                        numberOfLines: 1,
                        textOverflow: "ellipsis-middle",
                      }}
                    >
                      {hit().relativePath || hit().path}
                    </Text>
                  </View>
                  <If when={hit().directory}>
                    <IconButton
                      icon="chevron-right"
                      size="xs"
                      accessibilityLabel={`mention-browse-${hit().name}`}
                      tooltip={tr("sessions.mentionBrowseDir")}
                      onPress={() => browseMentionDir(hit().path)}
                    />
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
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "600",
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
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: compactLayout() ? layout.touchTarget : undefined,
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingVertical: space.chip,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: current() ? palette().accentSoft : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: current() ? palette().accentSoft : palette().panelHover }}
      activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.92 }}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text
          style={{
            color: current() ? palette().accent : palette().text,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.35),
            fontWeight: current() ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.choice.label}
        </Text>
        <If when={desc()}>
          {text => (
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {text()}
            </Text>
          )}
        </If>
      </View>
      <If when={current()}>
        <View
          accessibilityLabel={`✓ ${props.choice.label}`}
          style={{ flexShrink: 0 }}
        >
          <Icon name="check" size={13} color={palette().accent} />
        </View>
      </If>
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
          gap: space.chip,
          padding: space.sm,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Scroll style={{ maxHeight: 332, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.chip }}>
          <If when={agentProfiles().length > 0}>
            <View style={{ gap: space.hair }}>
              <Text
                style={{
                  color: palette().textElevatedMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.3),
                  fontWeight: "600",
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                }}
              >
                {tr("sessions.profiles")}
              </Text>
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
                      paddingTop: space.chip,
                      borderTopWidth: 1,
                      borderColor: palette().borderSubtle,
                    }
                  : {}),
              }}
            >
              <Text
                style={{
                  color: palette().textElevatedMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.3),
                  fontWeight: "600",
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                }}
              >
                {tr("sessions.agents")}
              </Text>
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
          paddingTop: space.chip,
          paddingBottom: space.hair,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
          gap: space.chip,
        }}
      >
        <Text
          style={{
            color: palette().textElevatedMuted,
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
          padding: space.sm,
          gap: space.chip,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "600",
          paddingHorizontal: space.chip,
        }}
      >
        {tr("sessions.model")}
      </Text>
      <If when={fleetModelGroups()}>
        {groups => <FleetModelList groups={groups()} />}
      </If>
      <If when={!fleetModelGroups()}>
      <Scroll style={{ maxHeight: 204, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.hair }}>
          <Each of={chatModels()} key="index">
            {option => (
              <View
                role="button"
                accessibilityLabel={`model-option-${option().id}`}
                onPress={() => void chooseModel(option().id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: compactLayout() ? layout.touchTarget : 30,
                  gap: space.sm,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.chip,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  backgroundColor:
                    option().id === activeModelId() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  userSelect: "none",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor:
                    option().id === activeModelId() ? palette().accentSoft : palette().panelHover,
                }}
                activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.9 }}
                focusVisibleStyle={focusRingStyle(-1)}
              >
                <ModelRowText active={option().id === activeModelId()} label={option().label} detail={option().detail} />
                <If when={option().id === activeModelId()}>
                  <Icon name="check" size={12} color={palette().accent} />
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
    <Scroll style={{ maxHeight: 320, minHeight: 0 }} scrollbar={true}>
      <View style={{ gap: space.hair }}>
        <Each of={props.groups} key="index">
          {device => (
            <View testID={`model-device-${device().deviceId}`} style={{ gap: space.hair, paddingTop: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.chip, paddingHorizontal: space.chip, paddingVertical: space.hair }}>
                <Text
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    color: palette().textElevatedMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.3),
                    fontWeight: "600",
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
 * A model row's text: the model, then its provider in the muted secondary style,
 * both as the host labelled them. The label keeps its width; the provider gives
 * way first when the row is narrow.
 */
function ModelRowText(props: { active: boolean; label: string; detail: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: props.active ? palette().accent : palette().text,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
          fontWeight: props.active ? "600" : "500",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.detail}>
        <Text
          style={{
            flexShrink: 2,
            minWidth: 0,
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.detail}
        </Text>
      </If>
    </View>
  );
}

function FleetModelRow(props: { choice: FleetModelChoice }) {
  const active = () => props.choice.modelRef === activeModelId();
  return (
    <View
      role="button"
      accessibilityLabel={`model-option-${props.choice.modelRef}`}
      disabled={!props.choice.selectable}
      accessibilityState={{ disabled: !props.choice.selectable, selected: active() }}
      onPress={() => {
        if (props.choice.selectable) void chooseModel(props.choice.modelRef);
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: compactLayout() ? layout.touchTarget : 30,
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingVertical: space.chip,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: active() ? palette().accentSoft : "transparent",
        opacity: props.choice.selectable ? 1 : 0.5,
        cursor: props.choice.selectable ? "pointer" : "not-allowed",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={props.choice.selectable ? { backgroundColor: active() ? palette().accentSoft : palette().panelHover } : {}}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <ModelRowText active={active()} label={fleetModelText(props.choice).label} detail={fleetModelText(props.choice).detail} />
      <If when={props.choice.primary}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
          {tr("models.primary")}
        </Text>
      </If>
      <If when={active()}>
        <Icon name="check" size={12} color={palette().accent} />
      </If>
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
          padding: space.sm,
          gap: space.chip,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "600",
          paddingHorizontal: space.chip,
        }}
      >
        {tr("sessions.reasoning")}
      </Text>
      <Scroll style={{ maxHeight: 176, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.hair }}>
          <View
            role="button"
            accessibilityLabel="reasoning-option-default"
            onPress={() => void chooseReasoning(null)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: compactLayout() ? layout.touchTarget : 30,
              gap: space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.chip,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              backgroundColor: activeReasoningId() === null ? palette().accentSoft : "transparent",
              cursor: "pointer",
              userSelect: "none",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor:
                activeReasoningId() === null ? palette().accentSoft : palette().panelHover,
            }}
            activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.9 }}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: activeReasoningId() === null ? palette().accent : palette().text,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                fontWeight: activeReasoningId() === null ? "600" : "500",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("common.default")}
            </Text>
            <If when={activeReasoningId() === null}>
              <Icon name="check" size={12} color={palette().accent} />
            </If>
          </View>
          <Each of={activeReasoningChoices()} key={choice => choice.id}>
            {choice => (
              <View
                role="button"
                accessibilityLabel={`reasoning-option-${choice().id}`}
                onPress={() => void chooseReasoning(choice().id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: compactLayout() ? layout.touchTarget : 30,
                  gap: space.sm,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.chip,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  backgroundColor:
                    choice().id === activeReasoningId() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  userSelect: "none",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor:
                    choice().id === activeReasoningId()
                      ? palette().accentSoft
                      : palette().panelHover,
                }}
                activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.9 }}
                focusVisibleStyle={focusRingStyle(-1)}
              >
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: choice().id === activeReasoningId() ? palette().accent : palette().text,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    fontWeight: choice().id === activeReasoningId() ? "600" : "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {choice().label}
                </Text>
                <If when={choice().id === activeReasoningId()}>
                  <Icon name="check" size={12} color={palette().accent} />
                </If>
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
      <Scroll style={{ maxHeight: 420, minHeight: 0 }} scrollbar={true}>
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
          <Scroll style={{ maxHeight: 168, minHeight: 0 }} scrollbar={true}>
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
      const ref = turnRefs.get(request.turnId);
      if (!ref) return;
      followLatest.set(false);
      ref.reveal({ vertical: "start" });
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
  const id = secondarySessionId();
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
    onPress: () => openDevicePage(device.deviceId),
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
      dimmed={() => focusedPane() !== 1}
      focused={() => focusedPane() === 1}
      bordered={() => true}
      focusAccessibilityLabel="secondary-pane-focus"
      focusIndicatorTestID="secondary-pane-active-indicator"
      onFocus={() => focusPane(1)}
      breadcrumb={
        <SessionBreadcrumb
          device={secondaryDeviceLabel}
          workspaceName={secondaryWorkspaceName}
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
      showTools={() => !compactLayout() && sessionsPaneWidth() >= 680}
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

function SecondaryTranscript() {
  let scrollRef: ScrollRef | undefined;
  let lastSession = secondarySessionId();
  let secSuppressAutoFollowUntil = 0;
  const secFollowLatest = signal(true);
  const loadingEarlierSec = signal(false);
  const secActiveRailKey = signal("");
  const secTurnRowRefs = new Map<string, ViewRef>();
  const secTurnOffsets = new Map<string, number>();

  const syncSecRail = (scrollY: number) => {
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
    const threshold = scrollY + 96;
    let current = rows[0]!.key;
    for (const row of rows) {
      const offset = secTurnOffsets.get(row.key);
      if (offset !== undefined && offset <= threshold) current = row.key;
    }
    if (secActiveRailKey() !== current) secActiveRailKey.set(current);
  };

  const jumpToSecTurn = (rowKey: string) => {
    const ref = rowKey ? secTurnRowRefs.get(rowKey) : undefined;
    if (!ref) return;
    secFollowLatest.set(false);
    secSuppressAutoFollowUntil = Date.now() + 500;
    secActiveRailKey.set(rowKey);
    ref.reveal({ vertical: "start", animated: true });
  };

  let secLastContentHeight = 0;
  let secLastObservedScrollY = 0;
  let secPeakFollowScrollY = 0;
  let secPendingSyncBottomSnap = false;
  let secPendingPrependAnchor: { prevHeight: number; prevScrollY: number } | null = null;

  registerSecondaryAutoBackfillGuard(() => secFollowLatest());
  registerSecondaryBeforePrependListener(() => {
    if (secFollowLatest()) {
      secPendingSyncBottomSnap = true;
    } else if (!secPendingPrependAnchor && secLastContentHeight > 0) {
      secPendingPrependAnchor = {
        prevHeight: secLastContentHeight,
        prevScrollY: secLastObservedScrollY,
      };
    }
  });
  cleanup(() => {
    registerSecondaryAutoBackfillGuard(null);
    registerSecondaryBeforePrependListener(null);
  });

  const showEarlierSecTurns = async (): Promise<void> => {
    if (loadingEarlierSec() || !secondaryHasEarlierTurns()) return;
    loadingEarlierSec.set(true);
    secFollowLatest.set(false);
    secPendingPrependAnchor = {
      prevHeight: secLastContentHeight,
      prevScrollY: secLastObservedScrollY,
    };
    try {
      await loadSecondaryEarlierTurns();
    } finally {
      loadingEarlierSec.set(false);
    }
  };

  effect(() => {
    const id = secondarySessionId();
    if (id !== lastSession) {
      lastSession = id;
      secTurnRowRefs.clear();
      secTurnOffsets.clear();
      secActiveRailKey.set("");
      secFollowLatest.set(true);
      secLastContentHeight = 0;
      secLastObservedScrollY = 0;
      secPeakFollowScrollY = 0;
      secPendingSyncBottomSnap = true;
      secPendingPrependAnchor = null;
    }
    secondaryTurns().length;
    secondaryOptimisticUserText();
    secondaryStreamScrollTick();
    secondaryLiveRounds().length;
    if (secFollowLatest()) {
      scrollRef?.scrollToEnd({ animated: false });
      syncSecRail(secLastObservedScrollY);
    }
  });

  const handleScroll = (event: ScrollEvent) => {
    const y = event.offset.y;
    const contentHeight = event.contentSize.height;
    const viewportHeight = event.size.height;
    secLastObservedScrollY = y;
    const max = Math.max(0, contentHeight - viewportHeight);
    const atBottom = y >= max - 24;
    if (atBottom) {
      if (!secFollowLatest() && Date.now() >= secSuppressAutoFollowUntil) {
        secFollowLatest.set(true);
      }
      if (secFollowLatest()) secPeakFollowScrollY = y;
    } else if (secFollowLatest()) {
      if (y < secPeakFollowScrollY - 4) {
        secFollowLatest.set(false);
      } else if (y > secPeakFollowScrollY) {
        secPeakFollowScrollY = y;
      }
    }
    syncSecRail(y);
    if (y <= 140 && !secFollowLatest() && contentHeight > viewportHeight && secondaryHasEarlierTurns() && !loadingEarlierSec()) {
      void showEarlierSecTurns();
    }
  };

  return (
    <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <Scroll
        ref={el => {
          scrollRef = el;
        }}
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{
          flexGrow: 1,
          paddingLeft: paneTranscriptPadLeft(secondaryVisibleTurnRows().length >= 2),
          paddingRight: sessionsPadX(),
          paddingTop: space.xl,
          paddingBottom: space.x3l,
        }}
        onScroll={handleScroll}
      >
        <View
          onLayout={event => {
            const height = event.bounds.size.height;
            if (height > 0 && Math.abs(height - secLastContentHeight) > 1) {
              const prevHeight = secLastContentHeight;
              secLastContentHeight = height;
              if (secFollowLatest()) {
                if (secPendingSyncBottomSnap && secondaryTurns().length > 0) {
                  secPendingSyncBottomSnap = false;
                }
                scrollRef?.scrollToEnd({ animated: false });
              } else if (secPendingPrependAnchor && height > prevHeight && prevHeight > 0) {
                const anchor = secPendingPrependAnchor;
                secPendingPrependAnchor = null;
                const delta = height - anchor.prevHeight;
                if (delta > 0) {
                  const targetY = Math.max(0, anchor.prevScrollY + delta);
                  secLastObservedScrollY = targetY;
                  scrollRef?.scrollTo({ y: targetY, animated: false });
                }
              }
            }
          }}
          style={{
            width: "100%",
            maxWidth: contentWidth(),
            alignSelf: "center",
            gap: 16,
          }}
        >
          <If when={secondaryTranscriptNotice()}>
            {notice => <InlineBanner tone="info" message={notice()} />}
          </If>

          <If when={secondaryHasEarlierTurns() && secondaryTurns().length > 0}>
            <View style={{ alignSelf: "center" }}>
              <Button
                label={loadingEarlierSec() ? tr("chat.loadingEarlier") : tr("chat.loadEarlier")}
                variant="ghost"
                size="xs"
                leadingIcon="history"
                loading={loadingEarlierSec()}
                accessibilityLabel="secondary-load-earlier"
                onPress={() => void showEarlierSecTurns()}
              />
            </View>
          </If>

          <If when={secondaryTurnsLoading() && secondaryTurns().length === 0}>
            <View style={{ alignItems: "center", paddingVertical: space.xxl }}>
              <BrandSpinner size={20} />
            </View>
          </If>

          <Each of={secondaryVisibleTurnRows()} key={row => row.key}>
            {row => (
              <TranscriptTurn
                turn={() => row().turn}
                rowKey={row().key}
                pane={1}
                onRegisterRef={(_turnId, rowKey, el) => {
                  if (el) secTurnRowRefs.set(rowKey, el);
                  else {
                    secTurnRowRefs.delete(rowKey);
                    secTurnOffsets.delete(rowKey);
                  }
                }}
                onLayoutOffset={(rowKey, y) => {
                  if (Number.isFinite(y)) secTurnOffsets.set(rowKey, y);
                }}
              />
            )}
          </Each>

          <If
            when={
              Boolean(secondaryOptimisticUserText()) ||
              secondaryPendingImages().length > 0 ||
              secondaryLiveDisplayBlocks().length > 0
            }
          >
            <View style={{ gap: space.md }}>
              <If when={Boolean(secondaryOptimisticUserText()) || secondaryPendingImages().length > 0}>
                <UserBubble
                  partKey={`sec-pending-${secondaryPendingTurnState()?.turnId || secondaryOptimisticUserText()}`}
                  text={secondaryOptimisticUserText()}
                  images={secondaryPendingImages()}
                  timestamp={secondaryPendingTurnState()?.createdAt}
                  showCopy={false}
                />
              </If>
              <If when={secondaryLiveDisplayBlocks().length > 0}>
                <View style={{ gap: 8 }}>
                  <Each of={secondaryLiveDisplayBlocks()} key={block => block.key}>
                    {block => (
                      <If
                        when={block().kind === "explore"}
                        else={
                          <LiveRoundView
                            round={() => (block() as Extract<LiveDisplayBlock, { kind: "round" }>).round}
                            singleRound={() => secondaryLiveRounds().length === 1}
                            pane={1}
                          />
                        }
                      >
                        <ExploreGroupCard
                          calls={(block() as Extract<LiveDisplayBlock, { kind: "explore" }>).calls}
                          cardId={`sec-${block().key}`}
                          stateOf={persistedToolState}
                          live={true}
                        />
                      </If>
                    )}
                  </Each>
                </View>
              </If>
            </View>
          </If>

          <If when={secondaryTurnError()}>
            {message => (
              <InlineBanner
                tone="danger"
                message={localizeHostError(message())}
                onDismiss={() => secondaryTurnError.set("")}
              />
            )}
          </If>

          <If when={secondarySendNotice()}>
            {message => (
              <InlineBanner
                tone="warning"
                message={message()}
                onDismiss={() => secondarySendNotice.set("")}
              />
            )}
          </If>
        </View>
      </Scroll>

      <TurnJumpRail
        rows={secondaryVisibleTurnRows}
        previewOf={key => turnJumpPreview(secondaryVisibleTurnRows(), key)}
        activeKey={secActiveRailKey}
        onJump={jumpToSecTurn}
        accessibilityLabel="secondary-turn-jump-rail"
        tickPrefix="secondary-turn-jump-"
      />

      <If when={!secFollowLatest()}>
        <LatestPill
          accessibilityLabel="secondary-jump-latest"
          onPress={() => {
            secSuppressAutoFollowUntil = 0;
            secFollowLatest.set(true);
            scrollRef?.scrollToEnd({ animated: true });
          }}
        />
      </If>
    </View>
  );
}

function SecondaryComposerDock() {
  let inputRef: InputRef | undefined;
  const dragActive = signal(false);
  const composing = signal(false);
  const plusOpen = signal(false);
  const plusAnchor = signal<ViewRef | null>(null);
  const paneWidth = signal(0);

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

  const compactSecondary = computed(() => paneWidth() > 0 && paneWidth() < 420);

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

  const secondaryPlusItems = computed<DropdownMenuItem[]>(() => {
    const fromPlus = (action: () => void) => () => {
      plusOpen.set(false);
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
        onSelect: fromPlus(() => openSecondaryPermissionPicker(plusAnchor(), "start")),
      });
    }
    if (compactSecondary()) {
      items.push({
        id: "sec-model",
        icon: "cpu",
        label: tr("sessions.modelLabel", { name: activeModelLabel() }),
        separator: true,
        accessibilityLabel: "secondary-bot-capsule-trigger",
        onSelect: fromPlus(() => {
          focusPane(1);
          modelPickerAnchor.set(plusAnchor());
          closePickers("model");
          modelPickerOpen.set(true);
          void refreshFleetModels();
        }),
      });
      if (activeReasoningChoices().length > 0) {
        items.push({
          id: "sec-reasoning",
          icon: "bulb",
          label: tr("sessions.reasoningLabel", { name: activeReasoningLabel() }),
          accessibilityLabel: "secondary-reasoning-picker",
          onSelect: fromPlus(() => {
            focusPane(1);
            reasoningPickerAnchor.set(plusAnchor());
            closePickers("reasoning");
            reasoningPickerOpen.set(true);
          }),
        });
      }
    }
    return items;
  });

  const insertSecondaryText = (text: string) => {
    if (!text) return;
    if (inputRef) {
      inputRef.insertText(text);
    } else {
      secondaryComposerText.update(curr => `${curr}${text}`);
    }
  };

  const handleSecondaryUris = (uris: string[], mimeTypes: string[]) => {
    const wsRoot = secondaryWorkspaceRoot();
    for (let i = 0; i < uris.length; i += 1) {
      const uri = uris[i];
      if (!uri) continue;
      const mime = mimeTypes[i] ?? "";
      const path = uri.startsWith("file://") ? pathOfFileUrl(uri) : uri;
      const name = basename(path) || `file-${i + 1}`;
      if (isImageMimeOrPath(mime, path)) {
        if (isLocalAttachmentPathAllowed()) {
          addSecondaryImageAttachment({
            id: `sec-img-${++nextDroppedAttachmentId}`,
            name,
            mimeType: mime || mimeFromFilename(path),
            fileSize: 0,
            imagePath: path,
          });
        }
      } else {
        const rel = toRelativeWorkspacePath(path, wsRoot);
        addSecondaryFileAttachment({
          id: `sec-file-${++nextDroppedAttachmentId}`,
          name,
          path,
          relativePath: rel,
          isDirectory: false,
          source: "file",
        });
      }
    }
  };

  const handleSecondaryPaste = async (event: PasteEvent) => {
    focusPane(1);
    let handled = false;
    const wsId = secondaryWorkspaceId() || activeWorkspaceId() || undefined;
    const wsRoot = secondaryWorkspaceRoot() || activeWorkspaceRoot() || "";
    const ws = secondaryWorkspaceRecord();
    const isRemote = Boolean(
      ws && ((ws.workspaceKind ?? "").toLowerCase().includes("remote") || (ws.workspaceKind ?? "").toLowerCase().includes("ssh") || Boolean(ws.sshHost)),
    );

    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        if (isImageMimeOrPath(file.type, file.name)) {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const mimeType = file.type || mimeFromFilename(file.name);
            addSecondaryImageAttachment({
              id: `sec-paste-img-${++nextDroppedAttachmentId}`,
              name: file.name || `pasted-image-${nextDroppedAttachmentId}.png`,
              mimeType,
              fileSize: bytes.byteLength,
              dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
            });
            handled = true;
          } catch {
            // Fall through quietly.
          }
        } else if (file.type.startsWith("text/") || /\.(md|txt|json|ts|tsx|js|jsx|rs|py|yml|yaml|toml|csv|log)$/i.test(file.name)) {
          try {
            const content = await file.text();
            const saved = await saveLongTextPasteToWorkspace(content, {
              workspaceId: wsId,
              workspaceRoot: wsRoot,
              isRemote,
              fileName: file.name || undefined,
              skipPrimaryStore: true,
            });
            if (saved) {
              addSecondaryFileAttachment(saved);
              handled = true;
            }
          } catch {
            // Fall through quietly.
          }
        }
      }
    }
    if (event.uris && event.uris.length > 0) {
      handleSecondaryUris(event.uris, []);
      handled = true;
    }
    if (handled) return;
    const text = event.text ?? "";
    if (!text) return;
    if (isLongTextPaste(text)) {
      const saved = await saveLongTextPasteToWorkspace(text, {
        workspaceId: wsId,
        workspaceRoot: wsRoot,
        isRemote,
        skipPrimaryStore: true,
      });
      if (saved) {
        addSecondaryFileAttachment(saved);
        inputRef?.focus();
        return;
      }
      pushToast(tr("sessions.pastedSaveFailed"), "warning");
    }
    insertSecondaryText(text);
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
    <View>
      <ComposerCardShell
        dragActive={dragActive}
        inactive={() => focusedPane() !== 1}
        onLayoutWidth={w => {
          if (Math.abs(w - paneWidth()) > 1) paneWidth.set(w);
        }}
        onFileDragEnter={() => dragActive.set(true)}
        onFileDragLeave={() => dragActive.set(false)}
        onFileDrop={event => {
          dragActive.set(false);
          focusPane(1);
          if (event.uris?.length) handleSecondaryUris(event.uris, event.mimeTypes ?? []);
        }}
      >
        <ComposerAttachmentStrip
          images={secondaryImageAttachments}
          files={secondaryFileAttachments}
          onRemoveImage={id => removeSecondaryImageAttachment(id)}
          onRemoveFile={id => removeSecondaryFileAttachment(id)}
          idPrefix="secondary-"
        />

        <View
          style={{
            paddingLeft: space.lg,
            paddingRight: compactSecondary() ? space.sm : space.md,
            paddingTop: space.md,
            paddingBottom: space.xs,
          }}
        >
          <Input
            ref={el => {
              inputRef = el;
            }}
            multiline={true}
            submitBehavior="submit"
            pasteBehavior="report"
            value={secondaryComposerText()}
            placeholder={
              secondaryRunningTurnId()
                ? tr("session.placeholderRunning")
                : tr("session.placeholder")
            }
            accessibilityLabel="secondary-composer"
            onFocus={() => focusPane(1)}
            onChange={event => secondaryComposerText.set(event.value)}
            onPaste={event => void handleSecondaryPaste(event)}
            onCompositionChange={event => composing.set(event.composing)}
            onSubmit={() => {
              if (!composing()) submitSecondary();
            }}
            style={{
              minHeight: controlHeight.sm,
              maxHeight: 160,
              color: palette().text,
              placeholderColor: palette().textMuted,
              caretColor: palette().accent,
              fontSize: textSize(15),
              lineHeight: textLineHeight(15, 24 / 15),
            }}
          />
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: compactSecondary() ? space.sm : space.md,
            paddingTop: space.xs,
            paddingBottom: space.sm,
            gap: compactSecondary() ? space.xs : space.chip,
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
            <View ref={el => plusAnchor.set(el)} style={{ flexShrink: 0 }}>
              <IconButton
                icon="plus"
                size="sm"
                iconSize={15}
                active={plusOpen()}
                accessibilityLabel="secondary-composer-plus"
                tooltip={tr("chat.polish.moreControls")}
                style={{ borderRadius: radii.pill }}
                onPress={() => {
                  focusPane(1);
                  plusOpen.update(v => !v);
                }}
              />
            </View>
            <If when={!compactSecondary()}>
              <View
                style={{
                  width: 1,
                  height: 14,
                  marginHorizontal: space.hair,
                  flexShrink: 0,
                  backgroundColor: palette().borderSubtle,
                }}
              />
              <AgentPickerTrigger
                compact={compactSecondary}
                sessionId={secondarySessionId}
                locked={() => true}
                accessibilityLabel="secondary-agent-picker"
              />
              <ModelReasoningCapsule
                compact={compactSecondary}
                modelAccessibilityLabel="secondary-bot-capsule-trigger"
                reasoningAccessibilityLabel="secondary-reasoning-picker"
                onFocusPane={() => focusPane(1)}
              />
            </If>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <ComposerFullAccessShield
              sessionId={secondarySessionId}
              accessibilityLabel="secondary-permission-mode-warning"
              onPress={anchor => openSecondaryPermissionPicker(anchor, "end")}
            />
            <ComposerSubmitAction
              running={() => Boolean(secondaryRunningTurnId())}
              canSend={canSend}
              sendLabel="secondary-send-turn"
              stopLabel="secondary-stop-turn"
              onSend={submitSecondary}
              onStop={() => void stopSecondaryTurn()}
            />
          </View>
        </View>
      </ComposerCardShell>

      <DropdownMenu
        open={plusOpen()}
        anchor={plusAnchor()}
        items={secondaryPlusItems()}
        placement="top"
        align="start"
        onClose={() => plusOpen.set(false)}
      />
    </View>
  );
}

function SecondarySessionPane() {
  const activateSecondary = () => {
    if (splitPaneOpen()) focusPane(1);
  };
  return (
    <View
      testID="secondary-session-pane"
      focusable={false}
      onTouchStartCapture={activateSecondary}
      onPressDown={activateSecondary}
      onPress={splitPaneOpen() && focusedPane() !== 1 ? activateSecondary : undefined}
      onMouseUp={activateSecondary}
      onKeyDown={activateSecondary}
      style={{
        flexGrow: 1 - sessionSplitRatio(),
        flexBasis: 0,
        minWidth: 260,
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: focusedPane() !== 1 ? palette().canvasSubtle : palette().canvas,
        ...paintTransition(MOTION_DURATION.fast),
      }}
    >
      <SecondaryHeader />
      <If when={Boolean(secondarySessionId())} else={<SecondaryEmptyPicker />}>
        <SecondaryTranscript />
        <PermissionPrompts sessionId={secondarySessionId} />
        <QuestionPrompts sessionId={secondarySessionId} />
        <SecondaryComposerDock />
      </If>
    </View>
  );
}

/**
 * Unified ephemeral `/btw` side-question pane reusing Primary's exact
 * `SessionHeaderBar`, `UserBubble`, `MarkdownBody`, `CopyChip`, `TurnJumpRail`,
 * `LatestPill`, `ComposerCardShell`, and `ComposerSubmitAction`.
 */
function BtwSessionPane(props?: { compact?: boolean }) {
  let scrollRef: ScrollRef | undefined;
  let btwSuppressAutoFollowUntil = 0;
  const composing = signal(false);
  const btwFollowLatest = signal(true);
  const btwActiveRailKey = signal("");
  const btwTurnRowRefs = new Map<string, ViewRef>();
  const btwTurnOffsets = new Map<string, number>();

  const current = () => sideQuestion();
  const history = () => sideQuestionHistory();
  const running = computed(() => current()?.state === "running");
  const canSend = computed(
    () =>
      !running() &&
      Boolean(sideQuestionDraft().trim()) &&
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
    <View
      testID={isCompact ? undefined : "side-question-pane"}
      accessibilityLabel="side-question-sheet"
      style={
        isCompact
          ? { flex: 1, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }
          : {
              flexGrow: 1 - sessionSplitRatio(),
              flexBasis: 0,
              minWidth: 260,
              minHeight: 0,
              flexDirection: "column",
              backgroundColor: palette().canvas,
            }
      }
    >
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

      {/* Transcript — shares Primary's exact spacing, UserBubble, MarkdownBody, CopyChip & TurnJumpRail */}
      <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Scroll
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
                      style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
                    >
                      <BrandSpinner size={13} />
                      <Text style={textStyle("caption", { color: palette().textMuted })}>
                        {tr("btw.thinking")}
                      </Text>
                    </View>
                  </If>

                  <If when={entry().state === "cancelled"}>
                    <View
                      accessibilityLabel="side-question-state"
                      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
                    >
                      <Icon name="info" size={14} color={palette().textMuted} />
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
                      <Icon name="close" size={14} color={palette().danger} />
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

      {/* Composer — reuses Primary's exact ComposerCardShell + 2-band layout + ComposerSubmitAction */}
      <ComposerCardShell>
        <View
          style={{
            paddingLeft: space.lg,
            paddingRight: space.md,
            paddingTop: space.md,
            paddingBottom: space.xs,
          }}
        >
          <Input
            value={sideQuestionDraft()}
            placeholder={tr("btw.placeholder")}
            accessibilityLabel="side-question-input"
            multiline={true}
            autoFocus={true}
            submitBehavior="submit"
            onChange={event => sideQuestionDraft.set(event.value)}
            onCompositionChange={event => composing.set(event.composing)}
            onSubmit={() => {
              if (!composing()) submit();
            }}
            style={{
              minHeight: controlHeight.sm,
              maxHeight: 160,
              fontSize: textSize(15),
              lineHeight: textLineHeight(15, 24 / 15),
              color: palette().text,
              placeholderColor: palette().textMuted,
              caretColor: palette().accent,
            }}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.md,
            paddingTop: space.xs,
            paddingBottom: space.sm,
            gap: space.chip,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
            }}
          >
            <Icon name="git-branch" size={12} color={palette().textMuted} />
            <Text
              style={{
                ...textStyle("caption", { color: palette().textMuted }),
                flex: 1,
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("btw.body")}
            </Text>
          </View>
          <ComposerSubmitAction
            running={running}
            canSend={canSend}
            sendLabel="side-question-ask"
            stopLabel="side-question-stop"
            onSend={submit}
            onStop={() => void cancelSideQuestion()}
          />
        </View>
      </ComposerCardShell>
    </View>
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
      <View
        testID="primary-session-pane"
        focusable={false}
        onTouchStartCapture={() => {
          if (splitPaneOpen()) focusPane(0);
        }}
        onPressDown={() => {
          if (splitPaneOpen()) focusPane(0);
        }}
        onPress={splitPaneOpen() && focusedPane() !== 0 ? () => focusPane(0) : undefined}
        onMouseUp={() => {
          if (splitPaneOpen()) focusPane(0);
        }}
        onKeyDown={() => {
          if (splitPaneOpen()) focusPane(0);
        }}
        style={{
          flex: showSplit() ? undefined : 1,
          flexGrow: showSplit() ? sessionSplitRatio() : 1,
          flexBasis: showSplit() ? 0 : undefined,
          minWidth: showSplit() ? 260 : 0,
          minHeight: 0,
          flexDirection: "column",
          backgroundColor: showSecondarySplit() && focusedPane() !== 0 ? palette().canvasSubtle : palette().canvas,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <ConversationHeader />
        <GoalStrip />
        <Transcript />
        <SessionOfflineNotice />
        <PermissionPrompts />
        <QuestionPrompts />
        <SessionReviewNotes />
        <ReviewLauncherDialog />
        <BackgroundCommandsStrip />
        <If when={Boolean(activeSessionId())}>
          <ComposerDock />
        </If>
      </View>

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

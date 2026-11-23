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
import {
  getLiveRoundText,
  getLiveRoundThinking,
  hasLiveContent,
  hasLiveRoundText,
  hasLiveRoundThinking,
  hasLiveText,
  hasLiveThinking,
  hasLiveTools,
  isStreamDraining,
  liveTurn,
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
  attachmentNotice,
  attachImageFromClipboard,
  attachImagesFromPicker,
  imageAttachments,
  isLocalAttachmentPathAllowed,
  pathOfFileUrl,
  removeAttachment,
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
  takeQueued,
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
  closeMention,
  insertMention,
  mentionHits,
  mentionInline,
  mentionLoading,
  mentionNotice,
  mentionOpen,
  mentionQuery,
  mentionSearched,
  mentionTruncated,
  loadSessionCommands,
  openMention,
  parseSlashCommand,
  runSlashCommand,
  sessionCommandsUnsupported,
  setMentionQuery,
  slashCommandLabel,
  slashCommandsFor,
  type SlashCommand,
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
  closeSessionTab,
  composerText,
  copyActiveSession,
  createSessionInWorkspace,
  deleteSessionRow,
  forkActiveSession,
  hasEarlierTurns,
  isSessionArchived,
  loadEarlierTurns,
  loadTurns,
  openInAuxPane,
  openSessionIds,
  pendingTurn,
  pendingTurnState,
  renameSession,
  runningTurnId,
  selectSession,
  sendNotice,
  sendTurn,
  sessionTurns,
  sessions,
  stopRunningTurn,
  streamText,
  thinkingText,
  turnError,
  transcriptNotice,
  turnsLoading,
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
  textTracking,
} from "../theme";
import { searchRevealTurn } from "../globalSearchStore";
import { openAccountAuthModal } from "../ui/AccountAuthModal";
import { BotCharacter, Icon, type IconName } from "../ui/icons";
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
  animateLayout,
  BrandSpinner,
  enterMotion,
  nonUniformStaggerMotion,
  paintTransition,
  popoverEnterMotion,
  popoverOrigin,
  pressTransition,
  tactileActiveStyle,
} from "../ui/motion";
import { DropdownMenu, pushToast, registerEscapeDismiss, type DropdownMenuItem } from "../ui/overlays";
import { sessionMenuItems } from "../ui/sessionActions";
import { ReviewLauncherDialog } from "../ui/ReviewLauncher";
import { VoiceDictationBar, VoiceInputButtons, type VoiceComposerActions } from "../ui/VoiceInput";
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
  StatusDot,
  TapOptionRow,
  TooltipBubble,
  focusRingStyle as baseFocusRingStyle,
} from "../ui/primitives";

const renaming = signal(false);
const renameValue = signal("");
const confirmingSessionDelete = signal<string | null>(null);
const threadMenuOpen = signal(false);
const transcriptSearchOpen = signal(false);
const transcriptSearchQuery = signal("");
const copiedTranscript = signal(false);
const quickActionMenuOpen = signal(false);
const queueCollapsed = signal(false);
const composerFileDragActive = signal(false);
const composerCaretBounds = signal<Bounds | null>(null);
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
const sessionsPadX = computed(() => (sessionsCompact() ? 16 : 24));

let composerInputRef: InputRef | undefined;
let nextDroppedAttachmentId = 0;

const enabledQuickActions = computed(() => quickActions().filter(action => action.enabled));

interface StarterPrompt {
  id: string;
  icon: IconName;
  titleKey: MessageKey;
  detailKey: MessageKey;
  promptKey: MessageKey;
}

const STARTER_PROMPTS: ReadonlyArray<StarterPrompt> = [
  {
    id: "architecture",
    icon: "layers",
    titleKey: "sessions.starterArchTitle",
    detailKey: "sessions.starterArchDesc",
    promptKey: "sessions.starterArchPrompt",
  },
  {
    id: "git-review",
    icon: "git",
    titleKey: "sessions.starterGitTitle",
    detailKey: "sessions.starterGitDesc",
    promptKey: "sessions.starterGitPrompt",
  },
  {
    id: "plan-feature",
    icon: "sparkles",
    titleKey: "sessions.starterFeatureTitle",
    detailKey: "sessions.starterFeatureDesc",
    promptKey: "sessions.starterFeaturePrompt",
  },
  {
    id: "scheduled-routine",
    icon: "calendar",
    titleKey: "sessions.starterRoutineTitle",
    detailKey: "sessions.starterRoutineDesc",
    promptKey: "sessions.starterRoutinePrompt",
  },
];

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
const hoveredRailTurnKey = signal("");
const hoveredRailAnchor = signal<ViewRef | null>(null);
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
    pushToast(
      tr("sessions.attachedImages", {
        images: formatPlural(1, "format.imageOne", "format.imageOther"),
      }),
      "success",
    );
    return true;
  } catch {
    return false;
  }
}

function attachOrReferenceFileUris(uris: string[], mimeTypes: string[]): void {
  let attachedImages = 0;
  let blockedRemoteImages = 0;
  const allowLocalPath = isLocalAttachmentPathAllowed();
  const referencedNames: string[] = [];

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
        blockedRemoteImages += 1;
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
      referencedNames.push(name);
    }
  }

  if (attachedImages > 0) {
    attachmentNotice.set("");
  }
  void blockedRemoteImages;

  if (referencedNames.length > 0) {
    const tags = referencedNames.map(name => `#file:${name}`).join(" ");
    const current = composerText();
    const separator = current.length > 0 && !/\s$/.test(current) ? " " : "";
    composerText.set(`${current}${separator}${tags} `);
    composerInputRef?.focus();
  }

  if (attachedImages > 0 && referencedNames.length > 0) {
    pushToast(
      tr("sessions.attachedImagesAndFiles", {
        images: formatPlural(attachedImages, "format.imageOne", "format.imageOther"),
        files: formatPlural(referencedNames.length, "format.fileOne", "format.fileOther"),
      }),
      "success",
    );
  } else if (attachedImages > 0) {
    pushToast(
      tr("sessions.attachedImages", {
        images: formatPlural(attachedImages, "format.imageOne", "format.imageOther"),
      }),
      "success",
    );
  } else if (referencedNames.length > 0) {
    pushToast(
      tr("sessions.referencedFiles", {
        files: formatPlural(referencedNames.length, "format.fileOne", "format.fileOther"),
      }),
      "info",
    );
  }
}

async function handleComposerPaste(event: PasteEvent): Promise<void> {
  let attachedImages = 0;
  if (event.files && event.files.length > 0) {
    for (const file of event.files) {
      if (!isImageMimeOrPath(file.type, file.name)) continue;
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
        attachedImages += 1;
      } catch (error) {
        attachmentNotice.set(localizeHostError(error));
      }
    }
    if (attachedImages > 0) {
      attachmentNotice.set("");
      pushToast(
        tr("sessions.attachedPastedImages", {
          images: formatPlural(attachedImages, "format.imageOne", "format.imageOther"),
        }),
        "success",
      );
    }
  }
  if (event.uris && event.uris.length > 0) {
    attachOrReferenceFileUris(event.uris, []);
  }
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
 */
function DeviationChip() {
  const mode = () => {
    const id = activeSessionId();
    if (!id || permissionModeSupported() === false || followsDefaultMode(id)) return null;
    const current = effectivePermissionMode(id);
    return current === permissionMode() ? null : current;
  };
  return (
    <If when={mode()}>
      {current => (
        <View
          accessibilityLabel="session-permission-deviation"
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

/** Device › workspace, each segment pressable (spec §3 Session header). */
function SessionBreadcrumb() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0, flexShrink: 1 }}>
      <If when={sessionDeviceLabel()}>
        {device => (
          <DeviceBadge
            testID="session-breadcrumb-device"
            name={device().name}
            kind={device().kind}
            exception={device().exception}
            onPress={device().onPress}
          />
        )}
      </If>
      <If when={!compactLayout() ? sessionWorkspaceName() : ""}>
        {name => (
          <>
            <If
              when={sessionDeviceLabel()}
              else={<Text style={textStyle("caption", { color: palette().textMuted })}>·</Text>}
            >
              <Icon name="chevron-right" size={12} color={palette().textMuted} />
            </If>
            <View
              role="button"
              accessibilityLabel="session-breadcrumb-workspace"
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
          <View
            testID="session-header"
            style={{
              minHeight: sessionOrigin() ? 64 : layout.topBarHeight,
              paddingHorizontal: sessionsCompact() ? space.lg : space.xxl,
              justifyContent: "center",
              gap: space.hair,
              backgroundColor: palette().canvas,
              borderBottomWidth: 1,
              borderColor: transcriptScrolled() ? palette().borderSubtle : "transparent",
              ...paintTransition(MOTION_DURATION.fast),
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: layout.topBarHeight - space.lg }}>
              <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Text
                  testID="session-title"
                  style={{
                    ...textStyle("sectionTitle"),
                    minWidth: 0,
                    flexShrink: 1,
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {headerTitle()}
                </Text>
                <SessionBreadcrumb />
                <DeviationChip />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: space.xs }}>
                <If when={headerState()}>
                  {state => (
                    <View accessibilityLabel={`session-status-${state()}`} style={{ marginRight: space.sm }}>
                      <StateMark state={state()} withWord={true} />
                    </View>
                  )}
                </If>
                <If when={!sessionsCompact()}>
                  <Each of={TOOL_TOGGLES} key={tool => tool.id}>
                    {tool => <ToolToggle id={tool().id} icon={tool().icon} label={tr(tool().label)} />}
                  </Each>
                </If>
                <ThreadMenuTrigger />
              </View>
            </View>
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
          </View>
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
          <ThreadActionsSurface placement={threadMenuPlacement()} />
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
                animateLayout();
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
                animateLayout();
                renaming.set(false);
              }}
            />
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => {
                animateLayout();
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
                animateLayout();
                transcriptSearchOpen.set(false);
                transcriptSearchQuery.set("");
              }}
            />
          </View>
        </View>
      </If>

      {/* Inline Delete Confirmation */}
      <If when={Boolean(activeSession() && confirmingSessionDelete() === activeSession()!.sessionId)}>
        <View
          style={{
            paddingHorizontal: sessionsPadX(),
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <View style={{ width: "100%", maxWidth: contentWidth(), alignSelf: "center" }}>
            <InlineConfirmBar
              message={tr("sessions.deleteConfirm", { title: sessionTitle(activeSession()!) })}
              confirmLabel={tr("common.confirmDelete")}
              danger={true}
              onConfirm={() => {
                const id = activeSession()!.sessionId;
                confirmingSessionDelete.set(null);
                void deleteSessionRow(id);
              }}
              onCancel={() => confirmingSessionDelete.set(null)}
            />
          </View>
        </View>
      </If>
    </View>
  );
}

function ThreadActionsSurface(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "end", closeThreadMenu);
  return (
    <View
      role="menu"
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 236,
          maxWidth: 300,
          padding: space.chip,
          gap: space.xs,
          transformOrigin: popoverOrigin(props.placement, "end"),
        },
        motion.style,
      ]}
    >
      <ThreadMenuAction
        icon="plus"
        label={tr("nav.newSession")}
        onPress={() => {
          closeThreadMenu();
          void createSessionInWorkspace(tr("nav.newSession"));
        }}
      />

      <If when={!isTranscriptEmpty() || transcriptSearchOpen()}>
        <ThreadMenuAction
          icon="search"
          label={tr("sessions.searchTranscript")}
          accessibilityLabel="transcript-search-toggle"
          onPress={() => {
            closeThreadMenu();
            animateLayout();
            const next = !transcriptSearchOpen();
            transcriptSearchOpen.set(next);
            if (!next) transcriptSearchQuery.set("");
          }}
        />
        <ThreadMenuAction
          icon={copiedTranscript() ? "check" : "copy"}
          label={tr("sessions.copyTranscript")}
          disabled={sessionTurns().length === 0}
          accessibilityLabel="copy-transcript"
          onPress={() => {
            closeThreadMenu();
            void copyWholeTranscript();
          }}
        />
      </If>

      <If when={openSessionIds().length > 0}>
        <View
          style={{
            gap: space.hair,
            paddingTop: space.sm,
            marginTop: space.hair,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Text
            style={{
              color: palette().textElevatedMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              fontWeight: "600",
              paddingHorizontal: space.sm,
              paddingBottom: space.hair,
            }}
          >
            {tr("sessions.openTabs")}
          </Text>
          <Scroll style={{ maxHeight: 180, minHeight: 0 }} scrollbar={true}>
            <View style={{ gap: space.hair }}>
              <Each of={openSessionIds()} key="index">
                {id => <SessionMenuTab id={id()} />}
              </Each>
            </View>
          </Scroll>
        </View>
      </If>

      <If when={activeSession()}>
        {session => (
          <View
            style={{
              gap: space.hair,
              paddingTop: space.sm,
              marginTop: space.hair,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <ThreadMenuAction
              icon="edit"
              label={tr("common.rename")}
              onPress={() => {
                closeThreadMenu();
                animateLayout();
                renameValue.set("");
                renaming.set(true);
              }}
            />
            <ThreadMenuAction
              icon="copy"
              label={tr("sessions.duplicate")}
              hint={tr("sessions.copySession")}
              onPress={() => {
                closeThreadMenu();
                void copyActiveSession();
              }}
            />
            <ThreadMenuAction
              icon="git-branch"
              label={tr("sessions.fork")}
              hint={tr("sessions.forkFromLastTurn")}
              onPress={() => {
                closeThreadMenu();
                void forkActiveSession();
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
            {/* wave22-p2: a phone has no tool toggles; the page of the session's device, live. */}
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
            {/* wave22-p5: the session goal and a side question beside the session. */}
            <ThreadMenuAction
              icon="circle-dot"
              label={tr("goal.menu")}
              disabled={!goalAvailable()}
              hint={goalAvailable() ? undefined : tr("goal.hostUpdate")}
              accessibilityLabel="session-goal-open"
              onPress={() => {
                closeThreadMenu();
                openGoalDialog();
              }}
            />
            <ThreadMenuAction
              icon="message-circle"
              label={tr("btw.menu")}
              accessibilityLabel="side-question-open"
              onPress={() => {
                closeThreadMenu();
                openSideQuestion();
              }}
            />
            {/* Copy session ID, Export as Markdown and Show storage folder: the same items as the All sessions ⋯. */}
            <Each
              of={sessionMenuItems(
                {
                  sessionId: session().sessionId,
                  deviceId: activeSessionDevice(),
                  workspaceId: activeWorkspaceId() ?? "",
                  title: sessionTitle(session()),
                  archived: isArchived(session()),
                },
                { omit: ["rename", "archive", "delete"] },
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
            <ThreadMenuAction
              icon={isArchived(session()) ? "undo" : "layers"}
              label={isArchived(session()) ? tr("sessions.restore") : tr("sessions.archive")}
              onPress={() => {
                closeThreadMenu();
                void archiveSessionRow(session().sessionId, !isArchived(session()));
              }}
            />
            <ThreadMenuAction
              icon="trash"
              label={tr("common.delete")}
              danger={true}
              onPress={() => {
                closeThreadMenu();
                confirmingSessionDelete.set(session().sessionId);
              }}
            />
          </View>
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
        color={palette().textSecondary}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: props.danger ? palette().danger : palette().text,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
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

function SessionMenuTab(props: { id: string }) {
  const title = computed(() => {
    const row = sessions().find(item => item.sessionId === props.id);
    return row?.sessionName || props.id;
  });
  const active = computed(() => activeSessionId() === props.id);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: compactLayout() ? layout.touchTarget : undefined,
        gap: space.chip,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: active() ? palette().accentSoft : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: active() ? palette().accentSoft : palette().panelHover }}
    >
      <View
        role="button"
        accessibilityLabel={`open-tab-${props.id}`}
        onPress={() => {
          selectSession(props.id);
          closeThreadMenu();
        }}
        style={{ flex: 1, minWidth: 0, cursor: "pointer", borderRadius: radii.xs, userSelect: "none" }}
        focusVisibleStyle={focusRingStyle()}
      >
        <Text
          style={{
            color: active() ? palette().text : palette().textSecondary,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
            fontWeight: active() ? "600" : "400",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {title()}
        </Text>
      </View>
      <View
        role="button"
        hitSlop={compactLayout() ? undefined : 4}
        accessibilityLabel={`close-session-tab-${props.id}`}
        onPress={() => closeSessionTab(props.id)}
        style={{
          flexShrink: 0,
          minWidth: compactLayout() ? layout.touchTarget : undefined,
          minHeight: compactLayout() ? layout.touchTarget : undefined,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: space.xs,
          paddingVertical: space.hair,
          borderRadius: radii.xs,
          borderCurve: "continuous",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Text style={{ color: palette().textMuted, fontSize: textSize(11), fontWeight: "600" }}>×</Text>
      </View>
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

function UserImageStrip(props: { images: UserImage[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
      <Each of={props.images} key={image => image.id}>
        {image => (
          <If
            when={image().dataUrl ?? ""}
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
              <Image
                src={src()}
                accessibilityLabel={`user-image-${image().name}`}
                style={{ width: 96, height: 96, borderRadius: radii.md, borderWidth: 1, borderColor: palette().borderSubtle }}
              />
            )}
          </If>
        )}
      </Each>
    </View>
  );
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
  const long = computed(
    () => props.text.split("\n").length > USER_MESSAGE_CLAMP_LINES || props.text.length > 900,
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
          {props.text}
        </Text>
        <If when={long()}>
          <View
            role="button"
            accessibilityLabel={`user-message-toggle-${props.partKey}`}
            onPress={() => {
              animateLayout();
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
              onPress={() => beginRerun(turnId(), props.text)}
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
 * and everything after it, then the edited text starts a new turn — the order
 * the desktop's `UserMessageItem` uses. It is destructive, so it confirms first.
 */
const rerunTarget = signal<{ turnId: string; text: string } | null>(null);
const rerunBusy = signal(false);

function beginRerun(turnId: string, text: string): void {
  animateLayout();
  rerunTarget.set({ turnId, text });
}

async function confirmRerun(): Promise<void> {
  const target = rerunTarget();
  const sessionId = activeSessionId();
  const workspaceId = activeWorkspaceId();
  if (!target || !sessionId || !workspaceId || rerunBusy()) return;
  const text = target.text.trim();
  if (!text) return;
  rerunBusy.set(true);
  try {
    await rollbackSessionToTurn({ sessionId, targetTurnId: target.turnId, workspaceId });
    rerunTarget.set(null);
    await loadTurns(sessionId);
    jumpToTranscriptEnd();
    await sendTurn(text);
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
              animateLayout();
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
          animateLayout();
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
        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size={12} color={palette().textMuted} />
      </View>
      <If when={expanded()}>
        <View
          style={{
            marginLeft: 6,
            paddingLeft: 12,
            borderLeftWidth: 2,
            borderColor: props.live ? palette().accentBorder : palette().borderSubtle,
          }}
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
function liveRoundItems(round: LiveModelRound, singleRound: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const thinking = getLiveRoundThinking(round.roundId);
  const text = getLiveRoundText(round.roundId);
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

function isPureExploreLiveRound(round: LiveModelRound): boolean {
  if (round.tools.length === 0) return false;
  if (hasLiveRoundThinking(round.roundId) || hasLiveRoundText(round.roundId)) return false;
  return round.tools.every(tool => {
    const name = tool.effectiveToolName || tool.toolName;
    const status = (tool.status ?? "").toLowerCase();
    return isExploreTool(name) && !tool.error && status !== "failed" && status !== "error";
  });
}

/**
 * Live rounds grouped like settled history: consecutive explore-only rounds
 * fold immediately into one collapsed `ExploreGroupCard` instead of rendering
 * separate rows live and collapsing when the turn settles.
 */
const liveDisplayBlocks = computed<LiveDisplayBlock[]>(() => {
  const rounds = liveRounds();
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
    if (isPureExploreLiveRound(round)) {
      exploreRun.push(round);
      continue;
    }
    flushExplore();
    blocks.push({ kind: "round", key: round.roundId, round });
  }
  flushExplore();
  return blocks;
});

/**
 * Per-round live view: each round owns its own `computed`, so when round N
 * streams text or thinking, completed rounds 0..N-1 never re-slice text or
 * rebuild their item lists.
 */
function LiveRoundView(props: { round: () => LiveModelRound; singleRound: () => boolean }) {
  const items = computed<TranscriptItem[]>(() => liveRoundItems(props.round(), props.singleRound()));
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
  const answer = computed(() => turnAnswerText(props.turn));
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
      <If when={answer()}>
        {text => (
          <IconButton
            icon={copiedBlock() === `answer-${turnId()}` ? "check" : "copy"}
            size="sm"
            accessibilityLabel={`copy-answer-${turnId()}`}
            tooltip={tr("chat.copyAnswer")}
            style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={() => {
              const id = turnId();
              void Clipboard.writeText(text()).then(() => {
                copiedBlock.set(`answer-${id}`);
                if (copyTimer) clearTimeout(copyTimer);
                copyTimer = setTimeout(() => {
                  copyTimer = null;
                  if (copiedBlock() === `answer-${id}`) copiedBlock.set("");
                }, 1500);
              });
            }}
          />
        )}
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
function TurnFailureNotice(props: { turn: unknown; failure: TurnFailure }) {
  const cancelled = computed(() => props.failure.status === "cancelled" || props.failure.status === "interrupted");
  const prompt = computed(() => userPartsOf(props.turn)[0]?.text ?? "");
  const reason = computed(() => (props.failure.message ? localizeHostError(props.failure.message) : ""));
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
          <CopyChip partKey={`failure-${turnKeyOf(props.turn)}`} text={raw()} />
        </If>
      </View>
      <If when={!cancelled() ? failureDetailLines(props.failure).join(" · ") : ""}>
        {line => <Text style={{ ...textStyle("mono", { color: palette().textMuted }), userSelect: "text" }}>{line()}</Text>}
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <If when={interruptedRecoveryOf(props.turn) && !runningTurnId() ? "resume" : ""}>
          <Button
            label={tr("chat.resume")}
            variant="ghost"
            size="sm"
            loading={resumingTurn() === turnKeyOf(props.turn)}
            accessibilityLabel={`resume-turn-${turnKeyOf(props.turn)}`}
            onPress={() => void resumeInterruptedTurn(props.turn)}
          />
        </If>
        <If when={prompt() && !runningTurnId() ? prompt() : ""}>
          {text => (
            <Button
              label={tr("common.tryAgain")}
              variant="ghost"
              size="sm"
              accessibilityLabel={`retry-turn-${turnKeyOf(props.turn)}`}
              onPress={() => {
                jumpToTranscriptEnd();
                void sendTurn(text());
              }}
            />
          )}
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
  turnOffsets.clear();
  suppressAutoFollowUntil = 0;
  activeRailTurnKey.set("");
  hoveredRailTurnKey.set("");
  hoveredRailAnchor.set(null);
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
  // A reader who scrolled up to the top of a windowed history gets the turns
  // before it; the initial layout pass (still following) never triggers this.
  if (y <= 2 && !followLatest() && contentHeight > viewportHeight && hasEarlierTurns() && !loadingEarlier()) {
    void showEarlierTurns();
  }
}

function WelcomeStudio() {
  const heroMotion = nonUniformStaggerMotion(0, 4, "fadeInUp");
  return (
    <View
      style={{
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: space.x3l,
        gap: space.xxl,
        alignItems: "center",
        width: "100%",
        maxWidth: 640,
        alignSelf: "center",
      }}
    >
      <View style={[{ alignItems: "center", gap: space.md }, heroMotion.style]}>
        <BotCharacter
          seed={activeWorkspace()?.name || "OpenBitFun"}
          variant="grok"
          size={62}
          ringColor={palette().canvas}
          status={runningTurnId() ? "running" : undefined}
        />
        <View style={{ alignItems: "center", gap: space.chip }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(22),
              lineHeight: textLineHeight(22, 1.25),
              fontWeight: "600",
              letterSpacing: textTracking(22),
              textAlign: "center",
            }}
          >
            {tr("sessions.welcomeTitle")}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
              textAlign: "center",
              maxWidth: 460,
            }}
          >
            {activeWorkspace()?.name
              ? tr("sessions.welcomeWorkspaceSubtitle", { name: activeWorkspace()!.name ?? "" })
              : tr("sessions.welcomeSubtitle")}
          </Text>
        </View>
      </View>

      <View
        style={{
          display: "grid",
          gridTemplateColumns: sessionsCompact() ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))",
          gap: space.md,
          width: "100%",
        }}
      >
        <Each of={STARTER_PROMPTS} key={card => card.id}>
          {(card, idx) => {
            const cardMotion = nonUniformStaggerMotion(idx() + 1, 4, "fadeInUp");
            return (
              <View
                role="button"
                accessibilityLabel={`starter-card-${card().id}`}
                onPress={() => {
                  composerText.set(tr(card().promptKey));
                  composerInputRef?.focus();
                }}
                style={[
                  {
                    padding: space.lg,
                    minHeight: layout.touchTarget,
                    borderRadius: radii.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().panelRaised,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.md,
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  },
                  cardMotion.style,
                ]}
                hoverStyle={{ backgroundColor: palette().panelHover }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={focusRingStyle()}
              >
                <View style={{ paddingTop: space.hair, flexShrink: 0 }}>
                  <Icon name={card().icon} size={16} color={palette().textSecondary} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(14),
                      lineHeight: textLineHeight(14, 1.35),
                      fontWeight: "600",
                    }}
                  >
                    {tr(card().titleKey)}
                  </Text>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(13),
                      lineHeight: textLineHeight(13, 1.45),
                    }}
                  >
                    {tr(card().detailKey)}
                  </Text>
                </View>
              </View>
            );
          }}
        </Each>
      </View>
    </View>
  );
}

/** Subtle elevated floating scroll-to-bottom control (Codex / Claude Desktop aesthetic). */
function LatestPill() {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  return (
    <View
      role="button"
      accessibilityLabel="Latest"
      onPress={jumpToTranscriptEnd}
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
  try {
    await loadEarlierTurns();
  } finally {
    loadingEarlier.set(false);
  }
  if (anchorKey) {
    if (earlierRevealTimer) clearTimeout(earlierRevealTimer);
    earlierRevealTimer = setTimeout(() => {
      earlierRevealTimer = null;
      turnRefs.get(anchorKey)?.reveal({ vertical: "start", animated: false });
    }, 0);
  }
}

/**
 * One settled turn. Its row is kept by the turn's id and its record keeps its
 * identity while unchanged (`stableTurnRows`), so a streaming chunk, a reload or
 * "Load earlier" never evaluates this subtree again.
 */
function TranscriptTurn(props: { turn: () => unknown; rowKey: string }) {
  const key = computed(() => turnKeyOf(props.turn()));
  const matches = computed(() => turnMatchesSearch(props.turn(), transcriptSearchQuery()));
  const items = computed(() => turnItems(props.turn()));
  const hovered = signal(false);
  return (
    <View
      ref={el => {
        registerTurnRef(key(), el);
        registerTurnRowRef(props.rowKey, el);
      }}
      onLayout={event => recordTurnOffset(props.rowKey, event.bounds.origin.y)}
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
            partKey={turnPartKey(props.turn(), part())}
            text={part().text}
            timestamp={turnTimestampOf(props.turn())}
            turnId={key()}
            images={userImagesOf(props.turn())}
          />
        )}
      </Each>

      <If when={Boolean(rerunTarget() && rerunTarget()!.turnId === key())}>
        <RerunEditor />
      </If>

      <TranscriptItems items={items()} preserveFullReply={liveStreamedTurnIds.has(key())} />

      <If when={publishedFiguresOf(props.turn()).length > 0}>
        <View style={{ gap: space.xs }}>
          <Each of={publishedFiguresOf(props.turn())} key={fig => fig.path}>
            {fig => <InlineFigureCard figure={fig()} />}
          </Each>
        </View>
      </If>

      <If when={turnFailureOf(props.turn())}>
        {failure => <TurnFailureNotice turn={props.turn()} failure={failure()} />}
      </If>

      <If when={items().length > 0}>
        <TurnFooter turn={props.turn()} visible={hovered() || compactLayout()} />
      </If>
    </View>
  );
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

const hoveredRailEntry = computed(() => {
  const key = hoveredRailTurnKey();
  if (!key) return null;
  const rows = visibleTurnRows();
  const index = rows.findIndex(row => row.key === key);
  if (index < 0) return null;
  const turn = rows[index]!.turn;
  return {
    key,
    index,
    total: rows.length,
    prompt: turnPromptExcerpt(turn),
    reply: turnReplyExcerpt(turn),
    timestamp: turnTimestampOf(turn),
  };
});

/**
 * Subtle left-edge turn minimap: thin horizontal hairlines (one per turn) that
 * thicken and lengthen on hover with an anchored preview card, and scroll back
 * to that turn on click. Hidden on narrow/compact viewports and 0-1 turn chats.
 */
function TurnJumpRail() {
  const rows = computed(() => visibleTurnRows());
  const visible = computed(() => !compactLayout() && !sessionsCompact() && rows().length >= 2);
  const dense = computed(() => rows().length > 24);
  const resolvedActiveKey = computed(() => {
    const current = activeRailTurnKey();
    const list = rows();
    if (current && list.some(row => row.key === current)) return current;
    return list[list.length - 1]?.key ?? "";
  });

  const renderTicks = () => (
    <View style={{ alignItems: "flex-start" }}>
      <Each of={rows()} key={row => row.key}>
        {(row, index) => {
          let tickRef: ViewRef | null = null;
          const key = () => row().key;
          const isHovered = () => hoveredRailTurnKey() === key();
          const isActive = () => resolvedActiveKey() === key();
          return (
            <View
              ref={el => {
                tickRef = el;
              }}
              role="button"
              accessibilityLabel={`turn-jump-${index() + 1}`}
              accessibilityState={{ selected: isActive() }}
              onMouseEnter={() => {
                hoveredRailTurnKey.set(key());
                hoveredRailAnchor.set(tickRef);
              }}
              onMouseLeave={() => {
                if (hoveredRailTurnKey() === key()) {
                  hoveredRailTurnKey.set("");
                  hoveredRailAnchor.set(null);
                }
              }}
              onPress={() => jumpToTurn(key())}
              style={{
                width: 28,
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
                  width: 10,
                  height: 2,
                  borderRadius: radii.pill,
                  transformOrigin: "left center",
                  pointerEvents: "none",
                  backgroundColor: isHovered() || isActive() ? palette().text : palette().borderStrong,
                  opacity: isHovered() ? 1 : isActive() ? 0.9 : 0.55,
                  transform: isHovered()
                    ? [{ scaleX: 2.2 }, { scaleY: 1.75 }]
                    : isActive()
                      ? [{ scaleX: 1.5 }, { scaleY: 1.25 }]
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
        accessibilityLabel="turn-jump-rail"
        style={{
          position: "absolute",
          left: 10,
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
          <If when={rows().length > 32} else={renderTicks()}>
            <Scroll style={{ maxHeight: 360 }} scrollbar={false}>
              {renderTicks()}
            </Scroll>
          </If>
        </View>

        <If when={Boolean(hoveredRailEntry() && hoveredRailAnchor())}>
          <Overlay
            anchor={hoveredRailAnchor()}
            placement="right"
            align="center"
            offset={10}
            margin={12}
          >
            <TurnJumpPreview />
          </Overlay>
        </If>
      </View>
    </If>
  );
}

function TurnJumpPreview() {
  const entry = hoveredRailEntry;
  const motion = enterMotion("fadeIn", MOTION_DURATION.fast);
  return (
    <If when={entry()}>
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
  let lastSessionId = activeSessionId();
  let lastOptimisticText = optimisticUserText();

  effect(() => {
    const id = activeSessionId();
    if (id !== lastSessionId) {
      lastSessionId = id;
      resetTranscriptScrollTracking();
      rerunTarget.set(null);
      // The previous transcript's rows are disposed with their keys; drop the
      // per-row state they left behind so a long day of sessions does not grow it.
      untracked(() => {
        resetExpandedCards();
        fullReplySignals.clear();
        liveStreamedTurnIds.clear();
        thinkingOverrides.set({});
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
          paddingHorizontal: sessionsPadX(),
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
        <View
          onLayout={event => {
            const height = event.bounds.size.height;
            if (height > 0 && Math.abs(height - lastContentHeight) > 1) {
              lastContentHeight = height;
              if (followLatest()) stickToTranscriptEnd();
            }
          }}
          style={{
            width: "100%",
            maxWidth: contentWidth(),
            alignSelf: "center",
            flexGrow: isTranscriptEmpty() ? 1 : 0,
            gap: 16,
          }}
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

          <If when={Boolean(optimisticUserText()) || liveDisplayBlocks().length > 0 || liveFallbackItems().length > 0}>
            {/* Mirrors `TranscriptTurn`'s exact `gap: space.md` and `TurnFooter` height so settling into a persisted turn causes 0px vertical jump. */}
            <View style={{ gap: space.md }}>
              <If when={optimisticUserText()}>
                {text => (
                  <UserBubble
                    partKey={`pending-${pendingTurnState()?.turnId || text()}`}
                    text={text()}
                    timestamp={pendingTurnState()?.createdAt}
                    showCopy={false}
                  />
                )}
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
      </Scroll>

      <TurnJumpRail />

      <If when={!followLatest()}>
        <LatestPill />
      </If>
    </View>
  );
}

/** The tool the running turn is in right now, as its row would title it. */
const slashMatches = computed(() => slashCommandsFor(composerText(), Boolean(runningTurnId())));

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
  if (command.local && command.id === "model") {
    await runModelSlashCommand(arg);
    return;
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
  } else {
    turnError.set(outcome.message);
  }
}

/** Shown under a typed `/` when the host offers no session commands at all. */
function SlashCommandsUnavailable(props: { placement: Placement }) {
  const motion = usePopoverMotion(() => props.placement, "start", () => composerText.set(""));
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 320,
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
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 320,
          maxWidth: "92%",
          padding: space.chip,
          gap: space.hair,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          paddingHorizontal: space.sm,
          paddingTop: space.hair,
          paddingBottom: space.xs,
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
          fontWeight: "600",
        }}
      >
        {tr("chat.slash.title")}
      </Text>
      <Each of={slashMatches() ?? []} key={entry => entry.id}>
        {entry => (
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
              cursor: "pointer",
              userSelect: "none",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <Text style={{ color: palette().text, fontFamily: fontMono, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.35) }}>
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
  // wave22-p5: `/goal [objective]` and `/btw [question]`; bare commands open their dialogs instead of sending literal prompts.
  if (activeSessionId()) {
    const trimmed = composerText().trim();
    if (/^\/goal$/i.test(trimmed)) {
      composerText.set("");
      openGoalDialog();
      return;
    }
    if (/^\/btw$/i.test(trimmed)) {
      composerText.set("");
      openSideQuestion();
      return;
    }
    if (runExtrasCommand(composerText())) {
      composerText.set("");
      return;
    }
  }
  const text = composerText();
  const hasPayload = Boolean(text.trim() || imageAttachments().length > 0);
  if (hasPayload && !runningTurnId()) jumpToTranscriptEnd();
  // The host decides whether a message written during a turn steers it or
  // waits in its queue; the composer clears immediately and follows the answer.
  const outcome = await sendTurn(text, sendDuringTurn, {
    onQueued: info => {
      recordQueuedFromSubmit(info.sessionId, info.turnId, info.content, info.attachmentCount);
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
  const count = mentionHits().length;
  if (key === "Escape") {
    closeMention();
    return;
  }
  if (count <= 0) return;
  if (key === "ArrowDown") {
    mentionSelectedIndex.update(idx => (idx + 1) % count);
  } else if (key === "ArrowUp") {
    mentionSelectedIndex.update(idx => (idx - 1 + count) % count);
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
 * The permission mode lives in the "+" menu; only full access, the one mode
 * that runs every tool unasked, stays visible as quiet neutral text.
 */
function FullAccessNotice() {
  return (
    <If
      when={
        permissionModeSupported() !== false &&
        Boolean(activeSessionId()) &&
        effectivePermissionMode(activeSessionId()) === "full_access"
      }
    >
      <View
        ref={el => fullAccessTriggerAnchor.set(el)}
        role="button"
        accessibilityLabel="permission-mode-warning"
        tooltip={<TooltipBubble text={tr("chat.permissionMode.tooltip")} />}
        onPress={() => {
          permissionPillAnchor.set(fullAccessTriggerAnchor());
          permissionModeAlign.set("end");
          const next = !permissionModePickerOpen();
          closePickers();
          permissionModePickerOpen.set(next);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          gap: space.xs,
          minHeight: compactLayout() || sessionsCompact() ? layout.touchTarget : 26,
          minWidth: compactLayout() || sessionsCompact() ? layout.touchTarget : undefined,
          paddingHorizontal: space.chip,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon name="shield" size={14} color={palette().textMuted} />
        <If when={!sessionsCompact()}>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              fontWeight: "500",
              numberOfLines: 1,
            }}
          >
            {permissionModeLabel("full_access")}
          </Text>
        </If>
      </View>
    </If>
  );
}

function PermissionModeSurface(props: { placement: Placement; align: "start" | "end" }) {
  const motion = usePopoverMotion(() => props.placement, props.align, () => {
    permissionModePickerOpen.set(false);
    permissionModePlacement.set("top");
  });
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
            onPress={() => void chooseSessionPermissionMode(row().mode)}
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
                (row().mode === null && followsDefaultMode(activeSessionId())) ||
                (row().mode !== null &&
                  !followsDefaultMode(activeSessionId()) &&
                  effectivePermissionMode(activeSessionId()) === row().mode)
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
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radii.pill,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
            activeStyle={tactileActiveStyle(0.97)}
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
  const items: DropdownMenuItem[] = [];
  if (compact) {
    items.push({
      id: "attach",
      icon: "paperclip",
      label: tr("sessions.attachImage"),
      accessibilityLabel: "Attach",
      onSelect: fromPlus(() => void attachImageFromClipboard()),
    });
  }
  items.push(
    {
      id: "pick-images",
      icon: "image",
      label: tr("chat.attach.pickImages"),
      accessibilityLabel: "attach-image-file",
      onSelect: fromPlus(() => {
        void attachImagesFromPicker().then(count => {
          if (count > 0) {
            pushToast(
              tr("sessions.attachedImages", {
                images: formatPlural(count, "format.imageOne", "format.imageOther"),
              }),
              "success",
            );
          }
        });
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
  );
  if (permissionModeSupported() !== false && activeSessionId()) {
    items.push({
      id: "permission",
      icon: "shield",
      label: tr("chat.permissionMode.tooltip"),
      trailingHint: permissionModeLabel(effectivePermissionMode(activeSessionId())),
      accessibilityLabel: "permission-mode-pill",
      onSelect: fromPlus(() => {
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

function ComposerDock() {
  ensureModelsLoaded();
  ensureQuickActions();
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
    mentionQuery();
    mentionOpen();
    mentionSelectedIndex.set(0);
  });

  const compactComposer = () => sessionsCompact();

  return (
    <View
      onFileDragEnter={() => composerFileDragActive.set(true)}
      onFileDragLeave={() => composerFileDragActive.set(false)}
      onFileDrop={event => handleComposerFileDrop(event)}
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

        {/* Band 3: One Cohesive Floating Elevated Composer Card */}
        <View
          ref={el => composerCardAnchor.set(el)}
          style={{
            width: "100%",
            borderRadius: radii.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: composerFileDragActive() ? palette().accent : palette().border,
            backgroundColor: composerFileDragActive()
              ? palette().accentSoft
              : palette().inputBg,
            boxShadow: palette().shadowComposer,
            overflow: "hidden",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            borderColor: composerFileDragActive() ? palette().accent : palette().borderStrong,
          }}
          focusWithinStyle={{
            borderColor: palette().fieldFocusBorder,
            boxShadow: palette().shadowComposerFocus,
          }}
        >
          {/* Attachment Chips & Drag-Drop Strip (seamlessly integrated inside card top) */}
          <If
            when={
              composerFileDragActive() ||
              imageAttachments().length > 0 ||
              attachmentNotice().length > 0
            }
          >
            <View
              style={{
                paddingHorizontal: space.md,
                paddingTop: space.sm,
                paddingBottom: space.hair,
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: space.chip,
              }}
            >
              <If when={composerFileDragActive()}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.chip,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.xs,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().accentBorder,
                    backgroundColor: palette().accentSoft,
                  }}
                >
                  <Icon name="upload" size={12} color={palette().accent} />
                  <Text
                    style={{
                      color: palette().accent,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.3),
                      fontWeight: "600",
                    }}
                  >
                    {tr("sessions.composerDropHint")}
                  </Text>
                </View>
              </If>

              <Each of={imageAttachments()} key={entry => entry.id}>
                {entry => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      maxWidth: 240,
                      gap: space.chip,
                      paddingHorizontal: space.sm,
                      paddingVertical: space.xs,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <If when={entry().dataUrl ?? ""} else={<Icon name="image" size={12} color={palette().textSecondary} />}>
                      {src => (
                        <Image
                          src={src()}
                          accessibilityLabel={`attachment-thumb-${entry().id}`}
                          style={{ width: 40, height: 40, borderRadius: radii.xs, flexShrink: 0 }}
                        />
                      )}
                    </If>
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
                      {entry().name}
                    </Text>
                    <If when={entry().fileSize > 0}>
                      <Text
                        style={{
                          flexShrink: 0,
                          color: palette().textMuted,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.25),
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatBytes(entry().fileSize)}
                      </Text>
                    </If>
                    <View
                      role="button"
                      hitSlop={compactLayout() ? undefined : 4}
                      accessibilityLabel={`remove-attachment-${entry().id}`}
                      onPress={() => removeAttachment(entry().id)}
                      style={{
                        flexShrink: 0,
                        minWidth: compactLayout() ? layout.touchTarget : undefined,
                        minHeight: compactLayout() ? layout.touchTarget : undefined,
                        alignItems: "center",
                        justifyContent: "center",
                        padding: space.hair,
                        borderRadius: radii.xs,
                        borderCurve: "continuous",
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
                )}
              </Each>

              <If when={attachmentNotice().length > 0}>
                <Text
                  style={{
                    color: palette().warning,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                  }}
                >
                  {localizeHostError(attachmentNotice())}
                </Text>
              </If>
            </View>
          </If>

          <VoiceDictationBar actions={composerVoiceActions} />

          {/* Multiline Editor */}
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs }}>
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
                    : tr("session.placeholder")
              }
              accessibilityLabel="composer"
              multiline={true}
              readonly={composerDisabled()}
              submitBehavior="submit"
              style={{
                minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
                maxHeight: 160,
                fontSize: compactLayout() ? Math.max(16, textSize(15)) : textSize(15),
                lineHeight: compactLayout() ? textLineHeight(16, 1.5) : textLineHeight(15, 24 / 15),
                color: palette().text,
                placeholderColor: palette().textMuted,
                caretColor: palette().accent,
              }}
              onChange={event => {
                composerText.set(event.value);
                syncInlineMention(event.value, event.value.length);
              }}
              onSelectionChange={event => syncInlineMention(composerText(), event.end)}
              onCaretMove={event => composerCaretBounds.set(event.pageBounds)}
              onPaste={event => void handleComposerPaste(event)}
              onKeyPress={event => {
                if (mentionOpen() && mentionInline()) {
                  handleMentionKeyNavigation(event.key);
                }
              }}
              onSubmit={() => void submitComposer()}
            />
          </View>

          {/* Calm Bottom Action Bar (single-row, legible even on 1100px + AuxPane) */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: compactComposer() ? space.xs : space.chip,
              paddingHorizontal: compactComposer() ? space.sm : space.md,
              paddingTop: space.xs,
              paddingBottom: space.sm,
            }}
          >
            {/* Left: "+" (rarely used items), attach, agent, model. Narrow: "+" holds them all. */}
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
              <If when={!compactComposer()}>
                <IconButton
                  icon="paperclip"
                  size="sm"
                  iconSize={15}
                  accessibilityLabel="Attach"
                  tooltip={tr("sessions.attachImage")}
                  onPress={() => {
                    closePickers();
                    void attachImageFromClipboard();
                  }}
                />
                <AgentPickerTrigger compact={compactComposer} />
                <ModelReasoningCapsule compact={compactComposer} />
              </If>
              <FullAccessNotice />
            </View>

            {/* Right: context ring, then Send / Stop */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                gap: compactComposer() ? space.hair : space.xs,
              }}
            >
              <VoiceInputButtons actions={composerVoiceActions} />
              <If when={!compactComposer()}>
                <ContextUsageRing />
              </If>

              <If when={Boolean(runningTurnId() && !composerText().trim())}>
                <View style={{ flexShrink: 0, paddingLeft: compactComposer() ? space.hair : space.xs }}>
                  <If
                    when={compactComposer() || compactLayout()}
                    else={
                      <View
                        role="button"
                        accessibilityLabel="Stop"
                        tooltip={<TooltipBubble text={tr("sessions.stopTurn")} />}
                        onPress={() => void stopRunningTurn()}
                        style={{
                          boxSizing: "border-box",
                          width: 30,
                          height: 30,
                          borderRadius: radii.sm,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: palette().dangerBorder,
                          backgroundColor: palette().dangerSoft,
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{
                          backgroundColor: palette().dangerHoverBg,
                          borderColor: palette().danger,
                        }}
                        activeStyle={tactileActiveStyle(0.97)}
                        focusVisibleStyle={focusRingStyle()}
                      >
                        <Icon name="stop" size={13} color={palette().danger} />
                      </View>
                    }
                  >
                    <View
                      role="button"
                      accessibilityLabel="Stop"
                      onPress={() => void stopRunningTurn()}
                      style={{
                        width: layout.touchTarget,
                        height: layout.touchTarget,
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        userSelect: "none",
                        ...pressTransition(MOTION_DURATION.fast),
                      }}
                      activeStyle={tactileActiveStyle(0.97)}
                      focusVisibleStyle={focusRingStyle(-4)}
                    >
                      <View
                        style={{
                          boxSizing: "border-box",
                          width: 34,
                          height: 34,
                          borderRadius: radii.pill,
                          borderWidth: 1,
                          borderColor: palette().dangerBorder,
                          backgroundColor: palette().dangerSoft,
                          alignItems: "center",
                          justifyContent: "center",
                          pointerEvents: "none",
                        }}
                      >
                        <Icon name="stop" size={14} color={palette().danger} />
                      </View>
                    </View>
                  </If>
                </View>
              </If>

              <If when={!runningTurnId() || composerText().trim().length > 0}>
                <View style={{ flexShrink: 0, paddingLeft: compactComposer() ? 0 : 4 }}>
                  <If
                    when={compactComposer()}
                    else={
                      <IconCircleButton
                        icon="arrow-up"
                        variant={composerDisabled() || !composerText().trim() ? "subtle" : "primary"}
                        size={30}
                        accessibilityLabel="Send"
                        tooltip={tr("sessions.sendMessage")}
                        disabled={composerDisabled() || !composerText().trim()}
                        onPress={() => void submitComposer()}
                      />
                    }
                  >
                    <TouchTargetButton
                      icon="arrow-up"
                      tone={composerDisabled() || !composerText().trim() ? "subtle" : "primary"}
                      disabled={composerDisabled() || !composerText().trim()}
                      accessibilityLabel="Send"
                      onPress={() => void submitComposer()}
                    />
                  </If>
                </View>
              </If>
            </View>
          </View>
        </View>

        {/* Only show a footer notice when the composer cannot send (offline or no session). */}
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
      </View>

      <DropdownMenu
        open={composerPlusOpen()}
        anchor={composerPlusAnchor()}
        items={composerPlusItems(compactComposer())}
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

      <If when={((slashMatches()?.length ?? 0) > 0 || mcpPromptMatches().length > 0) && !mentionOpen()}>
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

      <If when={sessionCommandsUnsupported() && (slashMatches()?.length ?? 0) === 0 && mcpPromptMatches().length === 0 && composerText().startsWith("/") && !/\s/.test(composerText()) && !mentionOpen()}>
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
            permissionModePlacement.set("top");
          }}
          onCancel={() => {
            permissionModePickerOpen.set(false);
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
function AgentPickerTrigger(props: { compact: () => boolean }) {
  let triggerRef: ViewRef | null = null;
  const locked = () => agentModeLockedToSingle();
  return (
    <If
      when={locked()}
      else={
        <View
          ref={el => {
            triggerRef = el;
            agentPickerAnchor.set(el);
          }}
          role="button"
          accessibilityLabel="agent-picker"
          tooltip={
            <TooltipBubble
              text={tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) })}
            />
          }
          onPress={() => {
            agentPickerAnchor.set(triggerRef);
            const next = !agentPickerOpen();
            closePickers(next ? "agent" : undefined);
            agentPickerOpen.set(next);
          }}
          style={{
            height: controlHeight.sm,
            minWidth: props.compact() ? 48 : 64,
            flexShrink: 1,
            maxWidth: props.compact() ? 132 : 168,
            paddingHorizontal: props.compact() ? space.chip : space.sm,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: agentPickerOpen() ? palette().border : "transparent",
            backgroundColor: agentPickerOpen() ? palette().surfaceSubtle : "transparent",
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            backgroundColor: palette().surfaceSubtle,
            borderColor: palette().borderSubtle,
          }}
          activeStyle={tactileActiveStyle(0.97)}
          focusVisibleStyle={focusRingStyle(-1)}
        >
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 18 / 13),
              fontWeight: "500",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {agentLabel(agentTypeOf(activeSessionId()))}
          </Text>
          <Icon
            name={agentPickerOpen() ? "chevron-up" : "chevron-down"}
            size={12}
            color={palette().textMuted}
          />
        </View>
      }
    >
      <View
        accessibilityLabel="agent-picker"
        tooltip={
          <TooltipBubble
            text={tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) })}
          />
        }
        style={{
          height: controlHeight.sm,
          flexShrink: 1,
          maxWidth: props.compact() ? 132 : 168,
          paddingHorizontal: props.compact() ? space.chip : space.sm,
          borderRadius: radii.sm,
          flexDirection: "row",
          alignItems: "center",
          userSelect: "none",
        }}
      >
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 18 / 13),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {agentLabel(agentTypeOf(activeSessionId()))}
        </Text>
      </View>
    </If>
  );
}

/** Compact readable Model & Reasoning selector pills separated by a thin hairline. */
function ModelReasoningCapsule(props: { compact: () => boolean }) {
  let modelTriggerRef: ViewRef | null = null;
  let reasoningTriggerRef: ViewRef | null = null;
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: props.compact() ? 56 : 72,
        flexDirection: "row",
        alignItems: "center",
        gap: space.hair,
      }}
    >
      <View
        ref={el => {
          modelTriggerRef = el;
          modelPickerAnchor.set(el);
        }}
        role="button"
        accessibilityLabel="bot-capsule-trigger"
        tooltip={
          <TooltipBubble
            text={tr("sessions.modelLabel", {
              name: activeModelDetail() ? `${activeModelLabel()} · ${activeModelDetail()}` : activeModelLabel(),
            })}
          />
        }
        onPress={() => {
          modelPickerAnchor.set(modelTriggerRef);
          const next = !modelPickerOpen();
          closePickers(next ? "model" : undefined);
          modelPickerOpen.set(next);
          // Other devices' models may have come or gone since the last read.
          if (next) void refreshFleetModels();
        }}
        style={{
          height: controlHeight.sm,
          minWidth: props.compact()
            ? activeReasoningChoices().length > 0
              ? 52
              : 56
            : 72,
          flexShrink: 1,
          maxWidth: props.compact() ? 172 : 216,
          paddingHorizontal: props.compact() ? space.chip : space.sm,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: modelPickerOpen() ? palette().border : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          backgroundColor: modelPickerOpen() ? palette().surfaceSubtle : "transparent",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor: palette().surfaceSubtle,
          borderColor: palette().borderSubtle,
        }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 18 / 13),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {activeModelLabel()}
        </Text>
        <Icon
          name={modelPickerOpen() ? "chevron-up" : "chevron-down"}
          size={12}
          color={palette().textMuted}
        />
      </View>

      <If when={activeReasoningChoices().length > 0}>
        <View
          style={{
            minWidth: props.compact() ? 44 : 64,
            flexShrink: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: space.hair,
          }}
        >
          <View style={{ width: 1, height: space.md, flexShrink: 0, backgroundColor: palette().borderSubtle }} />
          <View
            ref={el => {
              reasoningTriggerRef = el;
              reasoningPickerAnchor.set(el);
            }}
            role="button"
            accessibilityLabel="reasoning-picker"
            tooltip={
              <TooltipBubble
                text={tr("sessions.reasoningLabel", { name: activeReasoningLabel() })}
              />
            }
            onPress={() => {
              reasoningPickerAnchor.set(reasoningTriggerRef);
              const next = !reasoningPickerOpen();
              closePickers(next ? "reasoning" : undefined);
              reasoningPickerOpen.set(next);
            }}
            style={{
              height: controlHeight.sm,
              minWidth: 0,
              flexShrink: 1,
              maxWidth: props.compact() ? 92 : 156,
              paddingHorizontal: props.compact() ? space.chip : space.sm,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: reasoningPickerOpen() ? palette().border : "transparent",
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              backgroundColor: reasoningPickerOpen() ? palette().surfaceSubtle : "transparent",
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor: palette().surfaceSubtle,
              borderColor: palette().borderSubtle,
            }}
            activeStyle={tactileActiveStyle(0.97)}
            focusVisibleStyle={focusRingStyle(-1)}
          >
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 16 / 12),
                fontWeight: "500",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.compact()
                ? activeReasoningLabel()
                : tr("sessions.reasoningLabel", { name: activeReasoningLabel() })}
            </Text>
            <Icon
              name={reasoningPickerOpen() ? "chevron-up" : "chevron-down"}
              size={12}
              color={palette().textMuted}
            />
          </View>
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
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
        }}
      >
        {mentionInline()
          ? tr("sessions.mentionInlineHint")
          : tr("sessions.mentionPickerHint")}
      </Text>
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
        <Scroll style={{ maxHeight: 220, minHeight: 0 }} scrollbar={true}>
          <View style={{ gap: space.hair }}>
            <Each of={mentionHits()} key={hit => hit.path}>
              {(hit, idx) => (
                <View
                  role="button"
                  accessibilityLabel={`mention-option-${hit().name}`}
                  onPress={() => insertMention(hit(), composerInputRef)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: compactLayout() ? layout.touchTarget : 30,
                    gap: space.sm,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.chip,
                    borderRadius: radii.xs,
                    borderCurve: "continuous",
                    backgroundColor:
                      idx() === mentionSelectedIndex() ? palette().accentSoft : "transparent",
                    cursor: "pointer",
                    userSelect: "none",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.9 }}
                  focusVisibleStyle={focusRingStyle(-1)}
                >
                  <Icon
                    name={hit().directory ? "folder" : "file-code"}
                    size={13}
                    color={
                      idx() === mentionSelectedIndex()
                        ? palette().accent
                        : palette().textSecondary
                    }
                  />
                  <Text
                    style={{
                      maxWidth: "54%",
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
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.3),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {hit().path}
                  </Text>
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
function PermissionCard() {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  return (
    <View
      style={[
        { width: "100%", maxWidth: contentWidth(), alignSelf: "center", gap: space.sm },
        motion.style,
      ]}
    >
      <Each of={activePermissions()} key={request => `${request.deviceId}/${request.requestId}`}>
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
                <If when={idx() === 0 && activePermissions().length > 1}>
                  <Button
                    label={tr("chat.permission.allowAll", { count: activePermissions().length })}
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

function PermissionPrompts() {
  return (
    <If when={activePermissions().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.sm }}>
        <PermissionCard />
      </View>
    </If>
  );
}


function QuestionPrompts() {
  return (
    <If when={activeQuestions().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: space.chip }}>
        <View
          style={{
            width: "100%",
            maxWidth: contentWidth(),
            alignSelf: "center",
            gap: space.sm,
          }}
        >
          <Each of={activeQuestions()} key={prompt => prompt.toolId}>
            {prompt => <QuestionCard prompt={prompt} />}
          </Each>
        </View>
      </View>
    </If>
  );
}

function QuestionCard(props: { prompt: () => QuestionPrompt }) {
  const prompt = props.prompt;
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  return (
    <View
      style={[
        {
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
          gap: space.md,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvas,
        },
        motion.style,
      ]}
    >
      {/* Row 1 of the attention shell (spec §3 AttentionItem): mark, device, source. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 20 }}>
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
          <Text style={{ ...textStyle("label", { color: palette().text }), flexShrink: 1, minWidth: 0 }}>
            {tr("sessions.questionTitle")}
          </Text>
        </View>
      </View>
      <Scroll style={{ maxHeight: 320, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: space.md }}>
          <Each of={prompt().questions} key="index">
            {(question, index) => (
              <If when={prompt().questions.length <= 1 || index() === questionPageOf(prompt().toolId, prompt().questions.length)}>
                <QuestionBlock prompt={prompt} question={question} index={index()} />
              </If>
            )}
          </Each>
        </View>
      </Scroll>
      <If when={prompt().error}>
        {message => (
          <Text
            style={textStyle("caption", { color: palette().danger })}
          >
            {localizeHostError(message())}
          </Text>
        )}
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <If when={prompt().questions.length > 1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <IconButton
              icon="chevron-left"
              size="sm"
              accessibilityLabel={`question-prev-${prompt().toolId}`}
              tooltip={tr("chat.question.previous")}
              disabled={questionPageOf(prompt().toolId, prompt().questions.length) === 0}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepQuestionPage(prompt().toolId, -1, prompt().questions.length)}
            />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
                fontVariant: ["tabular-nums"],
              }}
            >
              {`${questionPageOf(prompt().toolId, prompt().questions.length) + 1}/${prompt().questions.length}`}
            </Text>
            <IconButton
              icon="chevron-right"
              size="sm"
              accessibilityLabel={`question-next-${prompt().toolId}`}
              tooltip={tr("chat.question.next")}
              disabled={questionPageOf(prompt().toolId, prompt().questions.length) >= prompt().questions.length - 1}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => stepQuestionPage(prompt().toolId, 1, prompt().questions.length)}
            />
          </View>
        </If>
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
  animateLayout();
  const next = Math.max(0, Math.min(total - 1, questionPageOf(toolId, total) + direction));
  questionPages.update(current => ({ ...current, [toolId]: next }));
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
    <View style={{ gap: 8 }}>
      <Text
        style={textStyle("body", { color: palette().text })}
      >
        {question().header ? `${question().header}: ${question().question}` : question().question}
      </Text>
      <Text style={textStyle("caption")}>
        {question().multiSelect
          ? tr("sessions.questionChooseMulti")
          : tr("sessions.questionChooseOne")}
      </Text>
      <View style={{ gap: 6 }}>
        <Each of={question().options} key={option => option.label}>
          {option => (
            <TapOptionRow
              label={option().label}
              detail={option().description}
              selected={chosen().includes(option().label)}
              accessibilityLabel={`question-${prompt().toolId}-${props.index}-${option().label}`}
              onPress={() =>
                toggleQuestionOption(prompt().toolId, props.index, option().label)
              }
            />
          )}
        </Each>
        <TapOptionRow
          label={tr("sessions.questionOther")}
          detail={tr("sessions.questionOtherDetail")}
          selected={typingOther()}
          accessibilityLabel={`question-${prompt().toolId}-${props.index}-other`}
          onPress={() =>
            toggleQuestionOption(prompt().toolId, props.index, "Other")
          }
        />
      </View>
      <If when={typingOther()}>
        <InputBox
          size="sm"
          accessibilityLabel={`question-${prompt().toolId}-${props.index}-text`}
          value={prompt().others[String(props.index)] ?? ""}
          placeholder={tr("sessions.questionPlaceholder")}
          onChange={value => setQuestionOther(prompt().toolId, props.index, value)}
        />
      </If>
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
            animateLayout();
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
          <Icon
            name={queueCollapsed() ? "chevron-right" : "chevron-down"}
            size={12}
            color={palette().textMuted}
          />
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
                        color: palette().text,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.4),
                        numberOfLines: 2,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item().content}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexShrink: 0,
                        gap: space.hair,
                      }}
                    >
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
                          onPress={() => void moveQueued(item().id, -1)}
                        />
                        <IconButton
                          icon="chevron-down"
                          size="xs"
                          iconSize={13}
                          disabled={index() === queuedForActive().length - 1}
                          tooltip={tr("common.down")}
                          accessibilityLabel={tr("common.down")}
                          onPress={() => void moveQueued(item().id, 1)}
                        />
                      </If>
                      <IconButton
                        icon="arrow-up"
                        size="xs"
                        iconSize={13}
                        tooltip={tr("sessions.sendNow")}
                        accessibilityLabel={tr("sessions.sendNow")}
                        onPress={() => void sendQueuedNow(item().id)}
                      />
                      <IconButton
                        icon="edit"
                        size="xs"
                        iconSize={13}
                        tooltip={tr("common.edit")}
                        accessibilityLabel={tr("common.edit")}
                        onPress={() => {
                          const content = item().content;
                          const prevDraft = composerText();
                          const nextDraft = prevDraft.trim() ? `${prevDraft.trimEnd()}\n${content}` : content;
                          composerText.set(nextDraft);
                          void takeQueued(item().id).then(text => {
                            if (!text && composerText() === nextDraft) {
                              composerText.set(prevDraft);
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

export function SessionsScene() {
  followSearchRevealRequests();
  useSessionExtras(); // wave22-p5
  return (
    <View
      onLayout={event => {
        const width = event.bounds.size.width;
        if (width > 0 && Math.abs(width - sessionsPaneWidth()) > 1) {
          sessionsPaneWidth.set(width);
        }
      }}
      style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: palette().canvas }}
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
      <ComposerDock />
      <SessionExtrasDialogs />
    </View>
  );
}

/**
 * Sessions conversation viewport — combines OpenBitFun Tauri's `FlowChat` Muse
 * progressive-disclosure transcript and 3-band `ChatInput` dock with the calm,
 * borderless editorial craft of Codex, Antigravity, and Claude Desktop.
 * Navigation across workspaces and sessions is owned by `App.tsx`'s `NavPanel`.
 */

import { Buffer } from "buffer";
import { Canvas, cleanup, Clipboard, computed, effect, Image, openUrl, Overlay, Scroll, signal, Text, untracked, View } from "nsh";
import type {
  Bounds,
  InputRef,
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
import { recoverInterruptedDialogTurn, rollbackSessionToTurn } from "../api";
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
  formatTimestamp,
  formatTokens,
  LARGE_MARKDOWN_CHARS,
  lineCountOf,
  markdownPreviewCut,
  groupExploreItems,
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
} from "../permissionStore";
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
  removeQueued,
  sendQueuedNow,
  takeQueued,
} from "../queueStore";
import {
  activeModelId,
  activeModelLabel,
  activeReasoningChoices,
  activeReasoningId,
  activeReasoningLabel,
  chatModels,
  chooseModel,
  chooseReasoning,
  ensureModelsLoaded,
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
  activeSessionId,
  activeWorkspace,
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
  turnsLoading,
} from "../state";
import {
  controlHeight,
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
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
  inferCodeLanguage,
} from "../ui/markdown";
import {
  MOTION_DURATION,
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
import { DropdownMenu, pushToast, type DropdownMenuItem } from "../ui/overlays";
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

const composerDisabled = computed(() => !activeSessionId());

function focusRingStyle(offset = 2): ViewStyle {
  return {
    outlineWidth: 2,
    outlineColor: palette().borderFocus,
    outlineOffset: offset,
  };
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
  contextPopoverOpen.set(false);
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
    boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
  };
}

/** Maps a profile or agent id to its OpenBitFun harness identity color. */
function harnessColorFor(id: string): string {
  const normalized = id.trim().toLowerCase();
  const colors = palette().harnessColors;
  if (normalized.includes("minimal") || normalized.includes("fast") || normalized.includes("lite")) {
    return colors.minimal;
  }
  if (normalized.includes("ultimate") || normalized.includes("deep") || normalized.includes("max")) {
    return colors.ultimate;
  }
  if (
    normalized.includes("creative") ||
    normalized.includes("plan") ||
    normalized.includes("architect")
  ) {
    return colors.creative;
  }
  if (
    !normalized ||
    normalized.includes("standard") ||
    normalized.includes("agentic") ||
    normalized.includes("default")
  ) {
    return colors.standard;
  }
  return palette().accent;
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
  const record = turn as Record<string, unknown>;
  const candidate = record.timestamp ?? record.createdAt ?? record.created_at ?? record.updatedAt;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
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

/** The rendered view of each persisted turn, so search can scroll a match into view. */
const turnRefs = new Map<string, ViewRef>();

function registerTurnRef(key: string, el: ViewRef | null | undefined): void {
  if (!key) return;
  if (el) turnRefs.set(key, el);
  else turnRefs.delete(key);
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
  setTimeout(() => copiedTranscript.set(false), 1600);
}


function isImageMimeOrPath(mime: string, nameOrUri: string): boolean {
  if (mime.toLowerCase().startsWith("image/")) return true;
  const clean = nameOrUri.split(/[?#]/)[0] ?? nameOrUri;
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function decodeFileUri(uri: string): string {
  const withoutScheme = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
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

function attachOrReferenceFileUris(uris: string[], mimeTypes: string[]): void {
  let attachedImages = 0;
  const referencedNames: string[] = [];

  for (let i = 0; i < uris.length; i += 1) {
    const uri = uris[i];
    if (!uri) continue;
    const mime = mimeTypes[i] ?? "";
    const filePath = decodeFileUri(uri);
    const name = basename(filePath) || "file";
    if (isImageMimeOrPath(mime, name)) {
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

/** Calm borderless conversation header (`38px`) sitting directly on `palette().canvas`. */
/** The header's one status mark: a running turn wins over an archived session. */
const headerStatus = computed<"" | "running" | "archived">(() => {
  if (runningTurnId() || isStreamDraining()) return "running";
  const session = activeSession();
  return session && isArchived(session) ? "archived" : "";
});

function ConversationHeader() {
  return (
    <View>
      <View
        style={{
          minHeight: sessionsCompact() ? 44 : 38,
          paddingHorizontal: sessionsCompact() ? 16 : 18,
          paddingVertical: 5,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          backgroundColor: palette().canvas,
          borderBottomWidth: 1,
          borderColor: transcriptScrolled() ? palette().borderSubtle : "transparent",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(14),
              lineHeight: textLineHeight(14, 1.3),
              fontWeight: "600",
              letterSpacing: textTracking(14),
              flexShrink: 1,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {activeSession()
              ? sessionTitle(activeSession()!)
              : activeWorkspace()?.name || tr("sessions.newConversation")}
          </Text>
          <If when={headerStatus()}>
            {status => (
              <View
                accessibilityLabel={`session-status-${status()}`}
                tooltip={
                  status() === "running"
                    ? tr("chat.status.running")
                    : tr("sessions.archivedBadge")
                }
                style={{ flexShrink: 0 }}
              >
                <StatusDot
                  kind={status() === "running" ? "accent" : "warning"}
                  size={6}
                  pulse={status() === "running"}
                />
              </View>
            )}
          </If>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 2 }}>
          <View ref={el => threadMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
            <If
              when={sessionsCompact()}
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
        </View>
      </View>

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
            paddingVertical: 7,
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
              gap: 8,
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
            paddingVertical: 7,
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
              gap: 8,
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
                setTimeout(revealSearchMatch, 0);
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
              onPress={() => stepSearchMatch(-1)}
            />
            <IconButton
              icon="chevron-down"
              size="sm"
              disabled={transcriptMatchCount() === 0}
              accessibilityLabel="search-next"
              tooltip={tr("chat.searchNext")}
              onPress={() => stepSearchMatch(1)}
            />
            <IconButton
              icon="close"
              size="sm"
              accessibilityLabel="close-transcript-search"
              tooltip={tr("sessions.closeSearch")}
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
  const motion = popoverEnterMotion(props.placement, "end", MOTION_DURATION.popover);
  return (
    <View
      role="menu"
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 236,
          maxWidth: 300,
          padding: 6,
          gap: 3,
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
            gap: 2,
            paddingTop: 5,
            marginTop: 2,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Text
            style={{
              color: palette().textElevatedMuted,
              fontSize: textSize(10.5),
              lineHeight: textLineHeight(10.5, 1.3),
              fontWeight: "600",
              paddingHorizontal: 8,
              paddingBottom: 2,
            }}
          >
            {tr("sessions.openTabs")}
          </Text>
          <Scroll style={{ maxHeight: 180, minHeight: 0 }} scrollbar={true}>
            <View style={{ gap: 2 }}>
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
              gap: 2,
              paddingTop: 5,
              marginTop: 2,
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
        gap: 8,
        minHeight: sessionsCompact() ? 44 : 30,
        opacity: props.disabled ? 0.45 : 1,
        paddingHorizontal: 9,
        paddingVertical: 6,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
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
              fontSize: textSize(10),
              lineHeight: textLineHeight(10, 1.3),
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
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 5,
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
        style={{ flex: 1, minWidth: 0, cursor: "pointer", borderRadius: 4 }}
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
        hitSlop={4}
        accessibilityLabel={`close-session-tab-${props.id}`}
        onPress={() => closeSessionTab(props.id)}
        style={{
          flexShrink: 0,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: radii.xs,
          borderCurve: "continuous",
          cursor: "pointer",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.92)}
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
  return (
    <View
      role="button"
      onPress={() => {
        void Clipboard.writeText(props.text).then(() => {
          copiedBlock.set(props.partKey);
          setTimeout(() => {
            if (copiedBlock() === props.partKey) copiedBlock.set("");
          }, 1500);
        });
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
      activeStyle={tactileActiveStyle(0.96)}
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
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.3),
          fontWeight: "500",
        }}
      >
        {copied() ? tr("common.copied") : tr("common.copy")}
      </Text>
    </View>
  );
}

/** User messages longer than this many lines start clamped behind "Show more". */
const USER_MESSAGE_CLAMP_LINES = 8;
const expandedUserMessages = signal<string[]>([]);

interface UserImage {
  id: string;
  name: string;
  dataUrl?: string;
  imagePath?: string;
}

/** The images a persisted user message carried (`userMessage.metadata.images`). */
function userImagesOf(turn: unknown): UserImage[] {
  if (!turn || typeof turn !== "object") return [];
  const record = turn as Record<string, unknown>;
  const user = (record.userMessage ?? record.user_message) as Record<string, unknown> | undefined;
  const metadata = user?.metadata as Record<string, unknown> | undefined;
  const images = metadata?.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => {
      const name = String(entry.name ?? entry.image_name ?? entry.imageName ?? "image");
      const dataUrl = entry.data_url ?? entry.dataUrl;
      const imagePath = entry.image_path ?? entry.imagePath;
      return {
        id: String(entry.id ?? `${name}-${index}`),
        name,
        ...(typeof dataUrl === "string" && dataUrl ? { dataUrl } : {}),
        ...(typeof imagePath === "string" && imagePath ? { imagePath } : {}),
      };
    });
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
                  gap: 5,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
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
        maxWidth: Math.min(768, Math.round(contentWidth() * 0.72)),
        gap: 4,
        alignItems: "flex-end",
      }}
    >
      <If when={(props.images?.length ?? 0) > 0}>
        <UserImageStrip images={props.images ?? []} />
      </If>
      <View
        style={{
          backgroundColor: palette().userBubble,
          borderRadius: radii.md,
          borderCurve: "continuous",
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 4,
        }}
      >
        <Text
          style={{
            color: palette().userBubbleText,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.58),
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
            style={{ alignSelf: "flex-start", cursor: "pointer" }}
          >
            <Text
              style={{
                color: palette().accent,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
                fontWeight: "500",
              }}
            >
              {expanded() ? tr("chat.showLess") : tr("chat.showMore")}
            </Text>
          </View>
        </If>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 2,
          opacity: revealActions() ? 1 : 0,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <If when={props.timestamp ? formatTimestamp(props.timestamp) : ""}>
          {stamp => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.3),
                fontVariant: ["tabular-nums"],
              }}
            >
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
 * Thinking blocks a reader opened or closed by hand. A block nobody touched
 * follows the stream: open while the model is still thinking (its tail kept in
 * view), closed once the answer starts or the block is persisted.
 */
const thinkingOverrides = signal<Record<string, boolean>>({});

function ThinkingBlock(props: {
  partKey: string;
  text: string;
  kind?: "reasoning" | "summary";
  live?: boolean;
}) {
  let tailRef: ScrollRef | undefined;
  const expanded = computed(() => {
    const override = thinkingOverrides()[props.partKey];
    return override ?? Boolean(props.live);
  });
  effect(() => {
    // Tail-follow while the reasoning streams into an open block.
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
          gap: 6,
          paddingHorizontal: 6,
          paddingVertical: 3,
          marginLeft: -6,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <If when={Boolean(props.live)} else={<Icon name="bulb" size={14} color={palette().textMuted} />}>
          <BrandSpinner size={12} color={palette().accent} variant="bars" />
        </If>
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.35),
            fontWeight: "500",
          }}
        >
          {props.kind === "summary" ? tr("chat.thinkingSummary") : tr("chat.thinking")}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
            fontVariant: ["tabular-nums"],
          }}
        >
          {props.live
            ? tr("sessions.thinkingStreaming")
            : formatPlural(props.text.length, "format.characterOne", "format.characterOther")}
        </Text>
        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          size={14}
          color={palette().textMuted}
        />
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

/** A link in a reply: a web address leaves the app, anything else is a workspace path. */
function handleMarkdownLink(event: { url: string }): void {
  const url = event.url.trim();
  if (!url || url.startsWith("#")) return;
  if (/^(https?:|mailto:)/i.test(url)) {
    void openUrl(url).catch(() => undefined);
    return;
  }
  const path = url.replace(/^file:\/\//i, "").split("#")[0] ?? url;
  if (path) openInAuxPane("files", decodeFileUri(path));
}

/** Which oversized replies the reader opened in full, one signal per item key. */
const fullReplySignals = new Map<string, Signal<boolean>>();

function fullReplySignal(key: string): Signal<boolean> {
  let entry = fullReplySignals.get(key);
  if (!entry) {
    entry = signal(false);
    fullReplySignals.set(key, entry);
  }
  return entry;
}

function MarkdownBody(props: { text: string; live?: boolean }) {
  return (
    <TextView
      markdown={props.text}
      selectable
      links="report"
      onLinkPress={handleMarkdownLink}
      options={props.live ? STREAMING_MARKDOWN_OPTIONS : STATIC_MARKDOWN_OPTIONS}
      codeBlockActions={createMarkdownCodeActions()}
      styles={createMarkdownStyles()}
    />
  );
}

/**
 * A reply, full column width. A settled reply above `LARGE_MARKDOWN_CHARS`
 * opens as a preview cut at a safe paragraph break, and lays out the rest only
 * when the reader asks for it, so a session with a few huge answers opens fast.
 */
function AnswerMarkdown(props: { text: string; live?: boolean; itemKey?: string }) {
  const large = computed(() => !props.live && props.text.length > LARGE_MARKDOWN_CHARS);
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
function TranscriptItemView(props: { item: TranscriptItem; live?: boolean }) {
  switch (props.item.kind) {
    case "text":
      return <AnswerMarkdown text={(props.item as ItemOf<"text">).text} live={props.live} itemKey={props.item.key} />;
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
function TranscriptItems(props: { items: TranscriptItem[]; live?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Each of={props.items} key={item => item.key}>
        {item => <TranscriptItemView item={item()} live={props.live} />}
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

const liveItems = computed<TranscriptItem[]>(() => {
  const rounds = liveTurn()?.rounds ?? [];
  if (rounds.length === 0) {
    // Flat stream signals without structured rounds (a host that sends no round ids).
    const fallback: TranscriptItem[] = [];
    if (thinkingText()) {
      fallback.push({ kind: "thinking", key: "live-thinking", text: thinkingText(), live: !streamText() });
    }
    if (streamText()) fallback.push({ kind: "text", key: "live-text", text: streamText() });
    return fallback;
  }
  return rounds.flatMap(round => liveRoundItems(round, rounds.length === 1));
});

/** The answer text of one persisted turn, for its footer's copy button. */
function turnAnswerText(turn: unknown): string {
  return turnParts(turn)
    .filter(part => part.role === "assistant")
    .map(part => part.text)
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
function TurnFooter(props: { turn: unknown }) {
  const answer = computed(() => turnAnswerText(props.turn));
  const turnId = computed(() => turnKeyOf(props.turn));
  const meta = computed(() =>
    [turnMetadataLabel(props.turn), turnTokenLabel(props.turn)].filter(Boolean).join(" · "),
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -4 }}>
      <If when={answer()}>
        {text => (
          <IconButton
            icon={copiedBlock() === `answer-${turnId()}` ? "check" : "copy"}
            size="sm"
            accessibilityLabel={`copy-answer-${turnId()}`}
            tooltip={tr("chat.copyAnswer")}
            onPress={() => {
              void Clipboard.writeText(text()).then(() => {
                copiedBlock.set(`answer-${turnId()}`);
                setTimeout(() => {
                  if (copiedBlock() === `answer-${turnId()}`) copiedBlock.set("");
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
            onPress={() => void forkActiveSession(id())}
          />
        )}
      </If>
      <If when={meta()}>
        {text => (
          <Text
            style={{
              marginLeft: 6,
              color: palette().textMuted,
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.3),
              fontVariant: ["tabular-nums"],
            }}
          >
            {text()}
          </Text>
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
function TurnFailureNotice(props: { turn: unknown; failure: TurnFailure }) {
  const cancelled = computed(() => props.failure.status === "cancelled" || props.failure.status === "interrupted");
  const prompt = computed(() => userPartsOf(props.turn)[0]?.text ?? "");
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
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: cancelled() ? palette().borderSubtle : palette().dangerBorder,
        backgroundColor: cancelled() ? palette().surfaceSubtle : palette().dangerSoft,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon
          name={cancelled() ? "info" : "alert-circle"}
          size={14}
          color={cancelled() ? palette().textMuted : palette().danger}
        />
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: cancelled() ? palette().textSecondary : palette().danger,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.4),
            fontWeight: "500",
          }}
        >
          {cancelled() ? tr("chat.turnInterrupted") : tr("chat.turnFailed")}
        </Text>
        <If when={!cancelled() && props.failure.message ? "copy" : ""}>
          <CopyChip partKey={`failure-${turnKeyOf(props.turn)}`} text={raw()} />
        </If>
        <If when={interruptedRecoveryOf(props.turn) && !runningTurnId() ? "resume" : ""}>
          <Button
            label={tr("chat.resume")}
            variant="primary"
            size="xs"
            leadingIcon="play"
            loading={resumingTurn() === turnKeyOf(props.turn)}
            accessibilityLabel={`resume-turn-${turnKeyOf(props.turn)}`}
            onPress={() => void resumeInterruptedTurn(props.turn)}
          />
        </If>
        <If when={prompt() && !runningTurnId() ? prompt() : ""}>
          {text => (
            <Button
              label={tr("chat.retry")}
              variant="secondary"
              size="xs"
              leadingIcon="refresh"
              accessibilityLabel={`retry-turn-${turnKeyOf(props.turn)}`}
              onPress={() => {
                jumpToTranscriptEnd();
                void sendTurn(text());
              }}
            />
          )}
        </If>
      </View>
      <If when={props.failure.message ? localizeHostError(props.failure.message) : ""}>
        {message => (
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
              userSelect: "text",
            }}
          >
            {message()}
          </Text>
        )}
      </If>
      <If when={failureDetailLines(props.failure).join(" · ")}>
        {line => (
          <Text
            style={{
              color: palette().textMuted,
              fontFamily: fontMono,
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.4),
              userSelect: "text",
            }}
          >
            {line()}
          </Text>
        )}
      </If>
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
  followLatest.set(true);
  peakFollowScrollY = lastObservedScrollY;
  cancelScheduledTranscriptScroll();
  transcriptScrollRef?.scrollToEnd({ animated: false });
  stickToTranscriptEnd();
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
    if (!followLatest()) followLatest.set(true);
    peakFollowScrollY = y;
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
        paddingVertical: 28,
        gap: 24,
        alignItems: "center",
        width: "100%",
        maxWidth: 640,
        alignSelf: "center",
      }}
    >
      <View style={[{ alignItems: "center", gap: 14 }, heroMotion.style]}>
        <BotCharacter
          seed={activeWorkspace()?.name || "OpenBitFun"}
          variant="grok"
          size={62}
          ringColor={palette().canvas}
          status={runningTurnId() ? "running" : undefined}
        />
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(24),
              lineHeight: textLineHeight(24, 1.22),
              fontWeight: "600",
              letterSpacing: textTracking(24),
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
          gap: 12,
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
                    padding: 16,
                    minHeight: 44,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().panelRaised,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    cursor: "pointer",
                    ...pressTransition(MOTION_DURATION.fast),
                  },
                  cardMotion.style,
                ]}
                hoverStyle={{ backgroundColor: palette().panelHover }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={focusRingStyle()}
              >
                <View style={{ paddingTop: 1, flexShrink: 0 }}>
                  <Icon name={card().icon} size={16} color={palette().textSecondary} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
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
          bottom: 12,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: palette().borderStrong,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(12px)",
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
          transformOrigin: "bottom center",
          cursor: "pointer",
          ...pressTransition(MOTION_DURATION.fast),
        },
        motion.style,
      ]}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.96)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon name="arrow-down" size={12} color={palette().text} />
      <Text
        style={{
          color: palette().text,
          fontSize: textSize(11.5),
          lineHeight: textLineHeight(11.5, 1.25),
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
  const pending = pendingTurnState()?.userText || pendingTurn();
  if (pending) return pending;
  const live = liveTurn();
  return live?.turnId && live.sessionId === activeSessionId() ? live.userText : "";
});


/**
 * The host answers every reload (a turn settling, "Load earlier") with fresh
 * objects for every turn. A settled turn whose record did not change keeps the
 * row the transcript already drew, so its `turn()` never changes and nothing
 * under it is evaluated again; only new or changed turns re-render, and turns
 * prepended by "Load earlier" never shift the rows below them.
 */
interface TurnRow {
  key: string;
  turn: unknown;
}

let turnRowCache = new Map<string, { row: TurnRow; signature: string }>();
let turnRowSession: string | null = null;

function turnSignature(turn: unknown): string {
  try {
    return JSON.stringify(turn) ?? "";
  } catch {
    return `unserializable:${Math.random()}`;
  }
}

const stableTurnRows = computed<TurnRow[]>(() => {
  const turns = sessionTurns();
  const sessionId = activeSessionId();
  if (sessionId !== turnRowSession) {
    turnRowSession = sessionId;
    turnRowCache = new Map();
  }
  const next = new Map<string, { row: TurnRow; signature: string }>();
  const rows = turns.map((turn, index) => {
    const id = turnKeyOf(turn);
    // A host that repeats an id (or sends none) gets a positional key, so the
    // keyed list never sees two rows under one key.
    // Keys carry the session, so switching sessions (a fork shares its parent's
    // turn ids) disposes the previous transcript's rows instead of reusing them.
    const key = id && !next.has(`${sessionId}|turn:${id}`) ? `${sessionId}|turn:${id}` : `${sessionId}|index:${index}`;
    const signature = turnSignature(turn);
    const previous = turnRowCache.get(key);
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

const showTurnsSkeleton = computed(
  () => turnsLoading() && sessionTurns().length === 0 && !optimisticUserText() && !hasLiveContent(),
);

function TranscriptSkeleton() {
  const bar = (width: `${number}%`, height = 12): ViewStyle => ({
    width,
    height,
    borderRadius: radii.xs,
    backgroundColor: palette().skeletonBg,
  });
  return (
    <View accessibilityLabel="transcript-loading" style={{ gap: 16, paddingTop: 8 }}>
      <View style={{ alignSelf: "flex-end", width: "42%", height: 36, borderRadius: radii.md, backgroundColor: palette().skeletonBg }} />
      <View style={{ gap: 8 }}>
        <View style={bar("88%")} />
        <View style={bar("94%")} />
        <View style={bar("61%")} />
      </View>
      <View style={{ alignSelf: "flex-end", width: "30%", height: 36, borderRadius: radii.md, backgroundColor: palette().skeletonBg }} />
      <View style={{ gap: 8 }}>
        <View style={bar("76%")} />
        <View style={bar("52%")} />
      </View>
    </View>
  );
}

const loadingEarlier = signal(false);

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
  if (anchorKey) setTimeout(() => turnRefs.get(anchorKey)?.reveal({ vertical: "start", animated: false }), 0);
}

/**
 * One settled turn. Its row is kept by the turn's id and its record keeps its
 * identity while unchanged (`stableTurnRows`), so a streaming chunk, a reload or
 * "Load earlier" never evaluates this subtree again.
 */
function TranscriptTurn(props: { turn: () => unknown }) {
  const key = computed(() => turnKeyOf(props.turn()));
  const matches = computed(() => turnMatchesSearch(props.turn(), transcriptSearchQuery()));
  const items = computed(() => turnItems(props.turn()));
  return (
    <View
      ref={el => registerTurnRef(key(), el)}
      style={{
        gap: 12,
        marginHorizontal: matches() ? -10 : 0,
        paddingHorizontal: matches() ? 10 : 0,
        paddingVertical: matches() ? 8 : 0,
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

      <TranscriptItems items={items()} />

      <If when={turnFailureOf(props.turn())}>
        {failure => <TurnFailureNotice turn={props.turn()} failure={failure()} />}
      </If>

      <If when={items().length > 0}>
        <TurnFooter turn={props.turn()} />
      </If>
    </View>
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
    activeSessionId();
    sessionTurns().length;
    optimisticUserText();
    streamScrollTick();
    liveTurn()?.rounds.length;
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
          paddingTop: 20,
          paddingBottom: 28,
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

          <If when={showTurnsSkeleton()}>
            <TranscriptSkeleton />
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
            {row => <TranscriptTurn turn={() => row().turn} />}
          </Each>

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

          <If when={liveItems().length > 0}>
            <TranscriptItems items={liveItems()} live={true} />
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

      <If when={!followLatest()}>
        <LatestPill />
      </If>
    </View>
  );
}

/** The tool the running turn is in right now, as its row would title it. */
const currentLiveToolLabel = computed(() => {
  const rounds = liveTurn()?.rounds ?? [];
  for (let r = rounds.length - 1; r >= 0; r -= 1) {
    const tools = rounds[r].tools;
    for (let t = tools.length - 1; t >= 0; t -= 1) {
      const tool = tools[t];
      if (tool.status === "running" || tool.status === "queued" || tool.status === "waiting" || tool.status === "confirmation") {
        const call = liveToolToCallView(tool);
        const state = persistedToolState(call);
        const target = toolTargetOf(call);
        const title = toolTitleOf(call, state);
        return target ? `${title} ${target}` : title;
      }
    }
  }
  return "";
});

function RunningAmbientCard() {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  // Elapsed seconds since the host said the turn started, ticking while shown.
  const now = signal(Date.now());
  const timer = setInterval(() => now.set(Date.now()), 1000);
  cleanup(() => clearInterval(timer));
  const elapsed = computed(() => {
    const sessionId = activeSessionId();
    const started = sessionId ? turnStartedAt(sessionId) : undefined;
    if (!started || !runningTurnId()) return "";
    return formatDuration(Math.max(0, now() - started));
  });
  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth: contentWidth(),
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: radii.md,
          borderCurve: "continuous",
          backgroundColor: palette().surfaceSubtle,
        },
        motion.style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <StatusDot kind="accent" size={6} pulse={true} />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.32),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {currentLiveToolLabel()
            ? currentLiveToolLabel()
            : hasLiveTools() && !hasLiveText()
            ? tr("sessions.runningTools")
            : hasLiveThinking() && !hasLiveText()
              ? tr("sessions.thinkingLive")
              : hasLiveText() || isStreamDraining()
                ? tr("sessions.streamingResponse")
                : tr("sessions.workingOnTurn")}
        </Text>
      </View>
      <Text
        style={{
          flexShrink: 0,
          maxWidth: 200,
          color: palette().textMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.25),
          fontWeight: "500",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {[elapsed(), activeModelLabel()].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
}

/** Layer 1 Ambient streaming status strip directly above the composer while a turn runs or drains. */
function RunningAmbientStrip() {
  return (
    <If when={Boolean(runningTurnId() || isStreamDraining() || hasLiveContent())}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: 4 }}>
        <RunningAmbientCard />
      </View>
    </If>
  );
}

const slashMatches = computed(() => slashCommandsFor(composerText(), Boolean(runningTurnId())));

async function executeSlashCommand(command: SlashCommand, arg = ""): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;
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
function SlashCommandsUnavailable() {
  return (
    <View style={[overlayPopoverStyle(), { width: 320, padding: 10 }]}>
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

function SlashCommandSurface() {
  return (
    <View style={[overlayPopoverStyle(), { width: 320, padding: 6, gap: 2 }]}>
      <Text
        style={{
          paddingHorizontal: 8,
          paddingTop: 2,
          paddingBottom: 4,
          color: palette().textMuted,
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.3),
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
              gap: 10,
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: radii.sm,
              cursor: "pointer",
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
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
    </View>
  );
}

async function submitComposer(sendDuringTurn?: "immediate" | "queue"): Promise<void> {
  if (insertSelectedMention()) return;
  const slash = parseSlashCommand(composerText());
  if (slash && activeSessionId()) {
    await executeSlashCommand(slash.command, slash.arg);
    return;
  }
  const sessionId = activeSessionId();
  const text = composerText();
  const hasPayload = Boolean(text.trim() || imageAttachments().length > 0);
  if (hasPayload && !runningTurnId()) jumpToTranscriptEnd();
  // The host decides whether a message written during a turn steers it or
  // waits in its queue; the composer only follows the answer.
  const outcome = await sendTurn(text, sendDuringTurn);
  if (outcome === "queued" && sessionId) void loadQueueForSession(sessionId, true);
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
const contextRingAnchor = signal<ViewRef | null>(null);
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
 * that runs every tool unasked, stays visible as quiet warning text.
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
        role="button"
        accessibilityLabel="permission-mode-warning"
        tooltip={<TooltipBubble text={tr("chat.permissionMode.tooltip")} />}
        onPress={() => {
          permissionPillAnchor.set(composerPlusAnchor());
          const next = !permissionModePickerOpen();
          closePickers();
          permissionModePickerOpen.set(next);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          gap: 4,
          minHeight: sessionsCompact() ? 44 : 26,
          paddingHorizontal: 6,
          borderRadius: radii.sm,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon name="warning" size={14} color={palette().warning} />
        <If when={!sessionsCompact()}>
          <Text
            style={{
              color: palette().warning,
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

function PermissionModeSurface() {
  return (
    <View style={[overlayPopoverStyle(), { width: 280, padding: 6, gap: 2 }]}>
      <Each of={PERMISSION_MODE_ROWS} key={row => String(row.mode)}>
        {row => (
          <View
            role="button"
            accessibilityLabel={`permission-mode-${row().mode ?? "default"}`}
            onPress={() => void chooseSessionPermissionMode(row().mode)}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: radii.sm,
              cursor: "pointer",
              backgroundColor:
                (row().mode === null && followsDefaultMode(activeSessionId())) ||
                (row().mode !== null &&
                  !followsDefaultMode(activeSessionId()) &&
                  effectivePermissionMode(activeSessionId()) === row().mode)
                  ? palette().surfaceSubtle
                  : "transparent",
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
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
          <Text style={{ paddingHorizontal: 8, color: palette().danger, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
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
  const fallbackMax = chatModels().find(model => model.id === activeModelId())?.contextWindow ?? null;
  const max = usage.max ?? fallbackMax;
  return { ...usage, max, ratio: max && max > 0 ? Math.min(1, usage.used / max) : null };
});

/** How full the context window is, as a ring with the numbers behind it on press. */
function ContextUsageRing() {
  return (
    <If when={activeContextUsage()}>
      {usage => (
        <View ref={el => contextRingAnchor.set(el)} style={{ flexShrink: 0 }}>
          <View
            role="button"
            accessibilityLabel="context-usage"
            tooltip={<TooltipBubble text={tr("chat.context.tooltip")} />}
            onPress={() => {
              const next = !contextPopoverOpen();
              closePickers();
              contextPopoverOpen.set(next);
            }}
            style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, cursor: "pointer" }}
            hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
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

function ContextUsageSurface() {
  return (
    <If when={activeContextUsage()}>
      {usage => (
        <View style={[overlayPopoverStyle(), { width: 240, padding: 12, gap: 6 }]}>
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
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        cursor: props.disabled ? "default" : "pointer",
      }}
      activeStyle={props.disabled ? undefined : tactileActiveStyle(0.94)}
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
        closePickers("actions");
        quickActionMenuOpen.set(true);
      }),
    },
  );
  if (permissionModeSupported() !== false && activeSessionId()) {
    items.push({
      id: "permission",
      icon: effectivePermissionMode(activeSessionId()) === "full_access" ? "warning" : "shield",
      label: tr("chat.permissionMode.tooltip"),
      trailingHint: permissionModeLabel(effectivePermissionMode(activeSessionId())),
      accessibilityLabel: "permission-mode-pill",
      onSelect: fromPlus(() => {
        closePickers();
        permissionModePickerOpen.set(true);
      }),
    });
  }
  if (compact) {
    items.push(
      {
        id: "agent",
        icon: "bot",
        label: tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) }),
        separator: true,
        accessibilityLabel: "agent-picker",
        onSelect: fromPlus(() => {
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
          closePickers();
          contextPopoverOpen.set(true);
        }),
      });
    }
  }
  return items;
}

function ComposerDock() {
  ensureModelsLoaded();
  ensureQuickActions();
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
        paddingTop: 6,
        paddingBottom: 14,
        gap: 6,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: contentWidth(),
          alignSelf: "center",
          gap: 6,
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
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6 }}>
                  <Button
                    label={tr("sessions.startSession")}
                    variant="primary"
                    size="xs"
                    pill={true}
                    onPress={() => void startSessionAs(mode())}
                  />
                  <Button
                    label={tr("common.cancel")}
                    variant="ghost"
                    size="xs"
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
              : palette().surfaceElevated,
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
                paddingHorizontal: 14,
                paddingTop: 10,
                paddingBottom: 2,
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6,
              }}
            >
              <If when={composerFileDragActive()}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
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
                      fontSize: textSize(11),
                      lineHeight: textLineHeight(11, 1.3),
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
                      gap: 6,
                      paddingHorizontal: 9,
                      paddingVertical: 4,
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
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.3),
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
                          fontSize: textSize(10),
                          lineHeight: textLineHeight(10, 1.25),
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatBytes(entry().fileSize)}
                      </Text>
                    </If>
                    <View
                      role="button"
                      hitSlop={4}
                      accessibilityLabel={`remove-attachment-${entry().id}`}
                      onPress={() => removeAttachment(entry().id)}
                      style={{
                        flexShrink: 0,
                        padding: 2,
                        borderRadius: 4,
                        borderCurve: "continuous",
                        cursor: "pointer",
                        ...pressTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{ backgroundColor: palette().panelHover }}
                      activeStyle={tactileActiveStyle(0.92)}
                      focusVisibleStyle={focusRingStyle()}
                    >
                      <Icon name="close" size={11} color={palette().textMuted} />
                    </View>
                  </View>
                )}
              </Each>

              <If when={attachmentNotice().length > 0}>
                <Text
                  style={{
                    color: palette().warning,
                    fontSize: textSize(11),
                    lineHeight: textLineHeight(11, 1.35),
                  }}
                >
                  {localizeHostError(attachmentNotice())}
                </Text>
              </If>
            </View>
          </If>

          {/* Multiline Editor */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
            <Input
              ref={composerInputRef}
              value={composerText()}
              placeholder={
                composerDisabled()
                  ? tr("sessions.noSessionSelected")
                  : runningTurnId()
                    ? midTurnSendPolicy() === "queue"
                      ? tr("sessions.composerQueuePlaceholder")
                      : tr("sessions.composerSteerPlaceholder")
                    : tr("sessions.composerIdlePlaceholder")
              }
              accessibilityLabel="composer"
              multiline={true}
              readonly={composerDisabled()}
              submitBehavior="submit"
              style={{
                minHeight: 28,
                maxHeight: 160,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.54),
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
              gap: compactComposer() ? 4 : 6,
              paddingHorizontal: compactComposer() ? 8 : 12,
              paddingTop: 4,
              paddingBottom: 9,
            }}
          >
            {/* Left: "+" (rarely used items), attach, agent, model. Narrow: "+" holds them all. */}
            <View
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
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
                gap: compactComposer() ? 2 : 4,
              }}
            >
              <If when={!compactComposer()}>
                <ContextUsageRing />
              </If>

              <If when={Boolean(runningTurnId() && composerText().trim().length > 0)}>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 5, paddingLeft: 2 }}>
                  <Button
                    label={
                      midTurnSendPolicy() === "queue"
                        ? tr("sessions.steer")
                        : tr("sessions.queue")
                    }
                    variant="secondary"
                    size="xs"
                    pill={true}
                    onPress={() =>
                      void submitComposer(midTurnSendPolicy() === "queue" ? "immediate" : "queue")
                    }
                  />
                  <Button
                    label={
                      midTurnSendPolicy() === "queue"
                        ? tr("sessions.queue")
                        : tr("sessions.steer")
                    }
                    variant="primary"
                    size="xs"
                    pill={true}
                    onPress={() => void submitComposer()}
                  />
                  <IconButton
                    icon="stop"
                    size="sm"
                    tone="danger"
                    accessibilityLabel="Stop"
                    tooltip={tr("sessions.stopTurn")}
                    onPress={() => void stopRunningTurn()}
                  />
                </View>
              </If>

              <If when={Boolean(runningTurnId() && !composerText().trim())}>
                <View style={{ flexShrink: 0, paddingLeft: compactComposer() ? 2 : 4 }}>
                  <View
                    role="button"
                    accessibilityLabel="Stop"
                    tooltip={<TooltipBubble text={tr("sessions.stopTurn")} />}
                    onPress={() => void stopRunningTurn()}
                    style={{
                      boxSizing: "border-box",
                      width: compactComposer() ? 28 : 30,
                      height: compactComposer() ? 28 : 30,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().dangerBorder,
                      backgroundColor: palette().dangerSoft,
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      ...pressTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{
                      backgroundColor: palette().dangerHoverBg,
                      borderColor: palette().danger,
                    }}
                    activeStyle={tactileActiveStyle(0.94)}
                    focusVisibleStyle={focusRingStyle()}
                  >
                    <Icon name="stop" size={13} color={palette().danger} />
                  </View>
                </View>
              </If>

              <If when={!runningTurnId()}>
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

        {/* Quiet Single-Line Shortcut / Mode Hint Row (color locked to palette().textMuted) */}
        <View
          style={{
            paddingHorizontal: 6,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(10.5),
              lineHeight: textLineHeight(10.5, 1.3),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {composerDisabled()
              ? tr("sessions.noSessionSelected")
              : runningTurnId()
                ? midTurnSendPolicy() === "queue"
                  ? tr("sessions.queuedUntilFinish")
                  : tr("sessions.steeringRunning")
                : tr("sessions.composerShortcutHint")}
          </Text>
        </View>
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
          align="end"
          offset={6}
          margin={8}
          onPosition={pos => quickActionsPlacement.set(pos.placement)}
          onPressOutside={() => closePickers()}
          onCancel={() => closePickers()}
        >
          <QuickActionsSurface placement={quickActionsPlacement()} />
        </Overlay>
      </If>

      <If when={agentPickerOpen()}>
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

      <If when={(slashMatches()?.length ?? 0) > 0 && !mentionOpen()}>
        <Overlay
          anchor={composerCardAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPressOutside={() => undefined}
          onCancel={() => composerText.set("")}
        >
          <SlashCommandSurface />
        </Overlay>
      </If>

      <If when={sessionCommandsUnsupported() && composerText().startsWith("/") && !/\s/.test(composerText()) && !mentionOpen()}>
        <Overlay
          anchor={composerCardAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPressOutside={() => undefined}
          onCancel={() => composerText.set("")}
        >
          <SlashCommandsUnavailable />
        </Overlay>
      </If>

      <If when={permissionModePickerOpen()}>
        <Overlay
          anchor={permissionPillAnchor()}
          placement="top"
          align="start"
          offset={6}
          margin={8}
          onPressOutside={() => permissionModePickerOpen.set(false)}
          onCancel={() => permissionModePickerOpen.set(false)}
        >
          <PermissionModeSurface />
        </Overlay>
      </If>

      <If when={contextPopoverOpen()}>
        <Overlay
          anchor={contextRingAnchor()}
          placement="top"
          align="end"
          offset={6}
          margin={8}
          onPressOutside={() => contextPopoverOpen.set(false)}
          onCancel={() => contextPopoverOpen.set(false)}
        >
          <ContextUsageSurface />
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
  return (
    <View
      ref={el => agentPickerAnchor.set(el)}
      role="button"
      accessibilityLabel="agent-picker"
      tooltip={
        props.compact() ? (
          <TooltipBubble
            text={tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) })}
          />
        ) : undefined
      }
      onPress={() => {
        const next = !agentPickerOpen();
        closePickers(next ? "agent" : undefined);
        agentPickerOpen.set(next);
      }}
      style={{
        height: controlHeight.sm,
        minWidth: props.compact() ? 48 : 72,
        flexShrink: 1,
        maxWidth: props.compact() ? 132 : 168,
        paddingHorizontal: props.compact() ? 7 : 9,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: agentPickerOpen() ? palette().border : "transparent",
        backgroundColor: agentPickerOpen() ? palette().surfaceSubtle : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: props.compact() ? 4 : 5.5,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().surfaceSubtle,
        borderColor: palette().borderSubtle,
      }}
      activeStyle={tactileActiveStyle(0.97)}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <View
        style={{
          width: 5.5,
          height: 5.5,
          flexShrink: 0,
          borderRadius: radii.pill,
          backgroundColor: harnessColorFor(agentTypeOf(activeSessionId())),
        }}
      />
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(11.5),
          lineHeight: textLineHeight(11.5, 1.25),
          fontWeight: "500",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.compact()
          ? agentLabel(agentTypeOf(activeSessionId()))
          : tr("sessions.agentLabel", { name: agentLabel(agentTypeOf(activeSessionId())) })}
      </Text>
      <Icon
        name={agentPickerOpen() ? "chevron-up" : "chevron-down"}
        size={10.5}
        color={palette().textMuted}
      />
    </View>
  );
}

/** Compact readable Model & Reasoning selector pills separated by a thin hairline. */
function ModelReasoningCapsule(props: { compact: () => boolean }) {
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: props.compact() ? 56 : 84,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <View
        ref={el => modelPickerAnchor.set(el)}
        role="button"
        accessibilityLabel="bot-capsule-trigger"
        tooltip={
          props.compact() ? (
            <TooltipBubble text={tr("sessions.modelLabel", { name: activeModelLabel() })} />
          ) : undefined
        }
        onPress={() => {
          const next = !modelPickerOpen();
          closePickers(next ? "model" : undefined);
          modelPickerOpen.set(next);
        }}
        style={{
          height: controlHeight.sm,
          minWidth: props.compact()
            ? activeReasoningChoices().length > 0
              ? 52
              : 56
            : 84,
          flexShrink: 1,
          maxWidth: props.compact() ? 172 : 216,
          paddingHorizontal: props.compact() ? 7 : 9,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: modelPickerOpen() ? palette().border : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: props.compact() ? 3.5 : 4.5,
          backgroundColor: modelPickerOpen() ? palette().surfaceSubtle : "transparent",
          cursor: "pointer",
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
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.25),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.compact()
            ? activeModelLabel()
            : tr("sessions.modelLabel", { name: activeModelLabel() })}
        </Text>
        <Icon
          name={modelPickerOpen() ? "chevron-up" : "chevron-down"}
          size={10.5}
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
            gap: 2,
          }}
        >
          <View style={{ width: 1, height: 12, flexShrink: 0, backgroundColor: palette().borderSubtle }} />
          <View
            ref={el => reasoningPickerAnchor.set(el)}
            role="button"
            accessibilityLabel="reasoning-picker"
            tooltip={
              props.compact() ? (
                <TooltipBubble
                  text={tr("sessions.reasoningLabel", { name: activeReasoningLabel() })}
                />
              ) : undefined
            }
            onPress={() => {
              const next = !reasoningPickerOpen();
              closePickers(next ? "reasoning" : undefined);
              reasoningPickerOpen.set(next);
            }}
            style={{
              height: controlHeight.sm,
              minWidth: 0,
              flexShrink: 1,
              maxWidth: props.compact() ? 92 : 156,
              paddingHorizontal: props.compact() ? 6 : 8,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: reasoningPickerOpen() ? palette().border : "transparent",
              flexDirection: "row",
              alignItems: "center",
              gap: 3.5,
              backgroundColor: reasoningPickerOpen() ? palette().surfaceSubtle : "transparent",
              cursor: "pointer",
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
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.25),
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
              size={10.5}
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
  const motion = isInline
    ? null
    : popoverEnterMotion(props.placement, "start", MOTION_DURATION.popover);
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 440,
          maxWidth: "92%",
          gap: 8,
          padding: 12,
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
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.32),
        }}
      >
        {mentionInline()
          ? tr("sessions.mentionInlineHint")
          : tr("sessions.mentionPickerHint")}
      </Text>
      <If when={mentionLoading()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <BrandSpinner size={11} color={palette().accent} variant="bars" />
          <Text
            style={{
              color: palette().textElevatedMuted,
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.35),
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
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.35),
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
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.35),
          }}
        >
          {tr("sessions.mentionNoMatch", { query: mentionQuery().trim() })}
        </Text>
      </If>
      <If when={mentionTruncated()}>
        <Text
          style={{
            color: palette().textElevatedMuted,
            fontSize: textSize(10.5),
            lineHeight: textLineHeight(10.5, 1.32),
          }}
        >
          {tr("sessions.moreMatchesHint")}
        </Text>
      </If>
      <If when={mentionHits().length > 0}>
        <Scroll style={{ maxHeight: 220, minHeight: 0 }} scrollbar={true}>
          <View style={{ gap: 2 }}>
            <Each of={mentionHits()} key={hit => hit.path}>
              {(hit, idx) => (
                <View
                  role="button"
                  accessibilityLabel={`mention-option-${hit().name}`}
                  onPress={() => insertMention(hit(), composerInputRef)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 9,
                    paddingVertical: 6,
                    borderRadius: radii.xs,
                    borderCurve: "continuous",
                    backgroundColor:
                      idx() === mentionSelectedIndex() ? palette().accentSoft : "transparent",
                    cursor: "pointer",
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
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.3),
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
                      fontSize: textSize(10.5),
                      lineHeight: textLineHeight(10.5, 1.3),
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
  const motion = popoverEnterMotion(props.placement, "end", MOTION_DURATION.popover);
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 248,
          maxWidth: 320,
          gap: 8,
          padding: 12,
          transformOrigin: popoverOrigin(props.placement, "end"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.3),
          fontWeight: "600",
        }}
      >
        {tr("sessions.quickActions")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Each of={enabledQuickActions()} key={action => action.id}>
          {action => (
            <Button
              label={action().label}
              variant="secondary"
              size="xs"
              pill={true}
              onPress={() => void runQuickAction(action().id)}
            />
          )}
        </Each>
      </View>
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.35),
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
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: current() ? palette().accentSoft : "transparent",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: current() ? palette().accentSoft : palette().panelHover }}
      activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.92 }}
      focusVisibleStyle={focusRingStyle(-1)}
    >
      <View
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: radii.pill,
          backgroundColor: harnessColorFor(props.choice.id),
        }}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text
          style={{
            color: current() ? palette().accent : palette().text,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.32),
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
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.34),
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
  const motion = popoverEnterMotion(props.placement, "start", MOTION_DURATION.popover);
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 320,
          maxWidth: "92%",
          gap: 6,
          padding: 8,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Scroll style={{ maxHeight: 332, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: 6 }}>
          <View style={{ gap: 2 }}>
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(10),
                lineHeight: textLineHeight(10, 1.3),
                fontWeight: "600",
                letterSpacing: textTracking(10, true),
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              {tr("sessions.profiles")}
            </Text>
            <Each of={agentProfiles()} key={choice => choice.id}>
              {choice => <AgentRow choice={choice()} />}
            </Each>
          </View>
          <If when={agentAgents().length > 0}>
            <View
              style={{
                gap: 2,
                paddingTop: 6,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <Text
                style={{
                  color: palette().textElevatedMuted,
                  fontSize: textSize(10),
                  lineHeight: textLineHeight(10, 1.3),
                  fontWeight: "600",
                  letterSpacing: textTracking(10, true),
                  paddingHorizontal: 10,
                  paddingVertical: 3,
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
          paddingHorizontal: 10,
          paddingTop: 6,
          paddingBottom: 2,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
          gap: 6,
        }}
      >
        <Text
          style={{
            color: palette().textElevatedMuted,
            fontSize: textSize(10.5),
            lineHeight: textLineHeight(10.5, 1.38),
          }}
        >
          {activeSessionStarted()
            ? tr("sessions.agentPickerStartedHint")
            : tr("sessions.agentPickerNewHint")}
        </Text>
        <If when={agentCatalogNotice().length > 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().warning,
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.35),
              }}
            >
              {localizeHostError(agentCatalogNotice())}
            </Text>
            <Button
              label={tr("common.reload")}
              variant="secondary"
              size="xs"
              onPress={() => reloadAgentModes()}
            />
          </View>
        </If>
        <If when={agentNotice().length > 0}>
          <Text
            style={{
              color: palette().danger,
              fontSize: textSize(10.5),
              lineHeight: textLineHeight(10.5, 1.35),
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
  const motion = popoverEnterMotion(props.placement, "start", MOTION_DURATION.popover);
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          width: 344,
          maxWidth: "92%",
          padding: 10,
          gap: 6,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.3),
          fontWeight: "600",
          paddingHorizontal: 6,
        }}
      >
        {tr("sessions.model")}
      </Text>
      <Scroll style={{ maxHeight: 204, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: 2 }}>
          <Each of={chatModels()} key="index">
            {option => (
              <View
                role="button"
                accessibilityLabel={`model-option-${option().id}`}
                onPress={() => void chooseModel(option().id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 9,
                  paddingVertical: 6.5,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  backgroundColor:
                    option().id === activeModelId() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor:
                    option().id === activeModelId() ? palette().accentSoft : palette().panelHover,
                }}
                activeStyle={{ backgroundColor: palette().panelHover, opacity: 0.9 }}
                focusVisibleStyle={focusRingStyle(-1)}
              >
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: option().id === activeModelId() ? palette().accent : palette().text,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    fontWeight: option().id === activeModelId() ? "600" : "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${option().label}${option().provider ? ` · ${option().provider}` : ""}`}
                </Text>
                <If when={option().id === activeModelId()}>
                  <Icon name="check" size={12.5} color={palette().accent} />
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

function ReasoningPickerSurface(props: { placement: Placement }) {
  const motion = popoverEnterMotion(props.placement, "start", MOTION_DURATION.popover);
  return (
    <View
      style={[
        overlayPopoverStyle(),
        {
          minWidth: 228,
          maxWidth: 300,
          padding: 10,
          gap: 6,
          transformOrigin: popoverOrigin(props.placement, "start"),
        },
        motion.style,
      ]}
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.3),
          fontWeight: "600",
          paddingHorizontal: 6,
        }}
      >
        {tr("sessions.reasoning")}
      </Text>
      <Scroll style={{ maxHeight: 176, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: 2 }}>
          <View
            role="button"
            accessibilityLabel="reasoning-option-default"
            onPress={() => void chooseReasoning(null)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 9,
              paddingVertical: 6.5,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              backgroundColor: activeReasoningId() === null ? palette().accentSoft : "transparent",
              cursor: "pointer",
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
              <Icon name="check" size={12.5} color={palette().accent} />
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
                  gap: 8,
                  paddingHorizontal: 9,
                  paddingVertical: 6.5,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  backgroundColor:
                    choice().id === activeReasoningId() ? palette().accentSoft : "transparent",
                  cursor: "pointer",
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
                  <Icon name="check" size={12.5} color={palette().accent} />
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

const activePermissions = computed(() => permissionsForSession(activeSessionId()));

const rejectingPermission = signal<string | null>(null);
const rejectFeedback = signal("");

function PermissionCard() {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth: contentWidth(),
          alignSelf: "center",
          padding: 14,
          gap: 10,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().warningBorder,
          backgroundColor: palette().panelRaised,
        },
        motion.style,
      ]}
    >
      <Each of={activePermissions()} key={request => request.requestId}>
        {(request, idx) => (
          <View
            style={{
              gap: 9,
              borderTopWidth: idx() > 0 ? 1 : 0,
              borderColor: palette().borderSubtle,
              paddingTop: idx() > 0 ? 10 : 0,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: radii.xs,
                  borderCurve: "continuous",
                  backgroundColor: palette().warningSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="shield" size={13} color={palette().warning} />
              </View>
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().warning,
                  fontSize: textSize(12.5),
                  lineHeight: textLineHeight(12.5, 1.35),
                  fontWeight: "600",
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("sessions.approvalNeeded", { action: request().action })}
              </Text>
            </View>
            <If when={request().resources.length > 0}>
              <Scroll
                style={{
                  maxHeight: 96,
                  minHeight: 0,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
                scrollbar={true}
                contentStyle={{ paddingHorizontal: 10, paddingVertical: 7 }}
              >
                <Text
                  style={{
                    color: palette().text,
                    fontFamily: fontMono,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.5),
                    userSelect: "text",
                  }}
                >
                  {request().resources.join(" · ")}
                </Text>
              </Scroll>
            </If>
            <If when={rejectingPermission() === request().requestId}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                  variant="danger"
                  size="sm"
                  pill={true}
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Button
                label={tr("sessions.allowOnce")}
                variant="primary"
                size="sm"
                pill={true}
                loading={answeringPermission()?.requestId === request().requestId && answeringPermission()?.reply === "once"}
                disabled={Boolean(answeringPermission())}
                onPress={() => void answerPermission(request().requestId, "once")}
              />
              <Button
                label={tr("sessions.alwaysAllow")}
                variant="secondary"
                size="sm"
                pill={true}
                loading={answeringPermission()?.requestId === request().requestId && answeringPermission()?.reply === "always"}
                disabled={Boolean(answeringPermission())}
                onPress={() => void answerPermission(request().requestId, "always")}
              />
              <Button
                label={tr("sessions.reject")}
                variant="danger"
                size="sm"
                pill={true}
                loading={answeringPermission()?.requestId === request().requestId && answeringPermission()?.reply === "reject"}
                disabled={Boolean(answeringPermission())}
                onPress={() => void answerPermission(request().requestId, "reject")}
              />
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
                  variant="outline"
                  size="sm"
                  pill={true}
                  accessibilityLabel="allow-all-permissions"
                  loading={answeringPermission()?.reply === "batch-once"}
                  disabled={Boolean(answeringPermission())}
                  onPress={() => void answerPermissionBatch(request().requestId, "once")}
                />
              </If>
            </View>
          </View>
        )}
      </Each>
    </View>
  );
}

function PermissionPrompts() {
  return (
    <If when={activePermissions().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: 6 }}>
        <PermissionCard />
      </View>
    </If>
  );
}

const activeQuestions = computed(() => questionsForSession(activeSessionId()));

function QuestionPrompts() {
  return (
    <If when={activeQuestions().length > 0}>
      <View style={{ paddingHorizontal: sessionsPadX(), paddingTop: 6 }}>
        <View
          style={{
            width: "100%",
            maxWidth: contentWidth(),
            alignSelf: "center",
            gap: 10,
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
          padding: 15,
          gap: 12,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
        },
        motion.style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: radii.xs,
            borderCurve: "continuous",
            backgroundColor: palette().accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="help-circle" size={13} color={palette().accent} />
        </View>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().accent,
            fontSize: textSize(12.5),
            lineHeight: textLineHeight(12.5, 1.35),
            fontWeight: "600",
          }}
        >
          {tr("sessions.questionTitle")}
        </Text>
      </View>
      <Scroll style={{ maxHeight: 320, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: 12 }}>
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
            style={{
              color: palette().warning,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.35),
            }}
          >
            {localizeHostError(message())}
          </Text>
        )}
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <If when={prompt().questions.length > 1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <IconButton
              icon="chevron-left"
              size="sm"
              accessibilityLabel={`question-prev-${prompt().toolId}`}
              tooltip={tr("chat.question.previous")}
              disabled={questionPageOf(prompt().toolId, prompt().questions.length) === 0}
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
              onPress={() => stepQuestionPage(prompt().toolId, 1, prompt().questions.length)}
            />
          </View>
        </If>
        <Button
          label={prompt().submitting ? tr("common.sending") : tr("sessions.sendAnswer")}
          variant="primary"
          size="sm"
          pill={true}
          loading={prompt().submitting}
          disabled={prompt().submitting}
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
        style={{
          color: palette().text,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.4),
          fontWeight: "600",
        }}
      >
        {question().header ? `${question().header}: ${question().question}` : question().question}
      </Text>
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.3),
        }}
      >
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
          paddingHorizontal: 12,
          color: palette().textMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.35),
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
        style={{
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().surfaceTertiary,
        }}
      >
        <View
          role="button"
          onPress={() => {
            animateLayout();
            queueCollapsed.update(v => !v);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 2,
            borderRadius: radii.xs,
            cursor: "pointer",
          }}
          focusVisibleStyle={focusRingStyle()}
        >
          <Icon
            name={queueCollapsed() ? "chevron-right" : "chevron-down"}
            size={12}
            color={palette().textMuted}
          />
          <Icon name="clock" size={11} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(10.5),
              lineHeight: textLineHeight(10.5, 1.3),
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("sessions.queuedSummary", { count: formatCount(queuedForActive().length) })}
          </Text>
        </View>
        <If when={!queueCollapsed()}>
          <Scroll style={{ maxHeight: 176, minHeight: 0 }} scrollbar={true}>
            <View style={{ gap: 6 }}>
              <Each of={queuedForActive()} key={item => item.id}>
                {item => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().panelRaised,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 160,
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
                        flexWrap: "wrap",
                        flexShrink: 0,
                        gap: 4,
                      }}
                    >
                      <If when={item().status !== "queued"}>
                        <Badge label={queuedStatusLabel(item().status)} tone="warning" />
                      </If>
                      <If when={canReorder(item().source)}>
                        <Button
                          label={tr("common.up")}
                          variant="ghost"
                          size="xs"
                          onPress={() => void moveQueued(item().id, -1)}
                        />
                        <Button
                          label={tr("common.down")}
                          variant="ghost"
                          size="xs"
                          onPress={() => void moveQueued(item().id, 1)}
                        />
                      </If>
                      <Button
                        label={tr("sessions.sendNow")}
                        variant="secondary"
                        size="xs"
                        onPress={() => void sendQueuedNow(item().id)}
                      />
                      <Button
                        label={tr("common.edit")}
                        variant="ghost"
                        size="xs"
                        onPress={() => {
                          void takeQueued(item().id).then(text => {
                            if (text) composerText.set(text);
                          });
                        }}
                      />
                      <Button
                        label={tr("common.delete")}
                        variant="danger"
                        size="xs"
                        onPress={() => void removeQueued(item().id)}
                      />
                    </View>
                  </View>
                )}
              </Each>
              <Each of={queuedForActive().filter(item => item.reason.length > 0)} key={item => `reason-${item.id}`}>
                {item => (
                  <Text
                    style={{
                      color: palette().warning,
                      fontSize: textSize(10.5),
                      lineHeight: textLineHeight(10.5, 1.35),
                    }}
                  >
                    {tr("sessions.queuedWaiting", { reason: localizeHostError(item().reason) })}
                  </Text>
                )}
              </Each>
              <If when={queueFallbackReason().length > 0}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.35),
                  }}
                >
                  {localizeHostError(queueFallbackReason())}
                </Text>
              </If>
              <If when={queueNotice().length > 0}>
                <Text
                  style={{
                    color: palette().danger,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.35),
                  }}
                >
                  {localizeHostError(queueNotice())}
                </Text>
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
  effect(() => {
    const request = searchRevealTurn();
    if (!request || activeSessionId() !== request.sessionId) return;
    const loaded = sessionTurns().some(turn => turnKeyOf(turn) === request.turnId);
    if (!loaded) return;
    setTimeout(() => {
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
      <Transcript />
      <RunningAmbientStrip />
      <PermissionPrompts />
      <QuestionPrompts />
      <ComposerDock />
    </View>
  );
}

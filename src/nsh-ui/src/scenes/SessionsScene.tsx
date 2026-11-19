/**
 * Sessions conversation viewport — combines OpenBitFun Tauri's `FlowChat` Muse
 * progressive-disclosure transcript and 3-band `ChatInput` dock with the calm,
 * borderless editorial craft of Codex, Antigravity, and Claude Desktop.
 * Navigation across workspaces and sessions is owned by `App.tsx`'s `NavPanel`.
 */

import { Buffer } from "buffer";
import { Clipboard, computed, effect, Overlay, Scroll, signal, Text, View } from "nsh";
import type {
  Bounds,
  InputRef,
  PasteEvent,
  Placement,
  ScrollEvent,
  ScrollRef,
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
  type LiveToolItem,
} from "../agentEvents";
import {
  attachmentNotice,
  attachImageFromClipboard,
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
  formatPlural,
  formatTimestamp,
  pathOf,
  todosOf,
  toolCallsOf,
  turnDurationMs,
  turnEffectiveModel,
  turnParts,
  type ToolCallView,
  type TurnPart,
} from "../format";
import { currentLocale, isAuthRequiredError, localizeHostError, tr, type MessageKey } from "../i18n";
import { answerPermission, permissionsForSession } from "../permissionStore";
import {
  type QuestionPrompt,
  type QuestionView,
  questionsForSession,
  setQuestionOther,
  submitQuestion,
  toggleQuestionOption,
} from "../userQuestionStore";
import {
  enqueueMessage,
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
  openMention,
  setMentionQuery,
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
  isSessionArchived,
  openInAuxPane,
  openSessionIds,
  pendingTurn,
  pendingTurnState,
  renameSession,
  runningTurnId,
  selectSession,
  sendTurn,
  sessionStarted,
  sessionTurns,
  sessions,
  stopRunningTurn,
  streamText,
  thinkingText,
  turnError,
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
import { pushToast } from "../ui/overlays";
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

const threadMenuPlacement = signal<Placement>("bottom");
const mentionPlacement = signal<Placement>("top");
const quickActionsPlacement = signal<Placement>("top");
const agentPickerPlacement = signal<Placement>("top");
const modelPickerPlacement = signal<Placement>("top");
const reasoningPickerPlacement = signal<Placement>("top");
const transcriptScrolled = signal(false);
const sessionsPaneWidth = signal(0);
const sessionsCompact = computed(() => sessionsPaneWidth() > 0 && sessionsPaneWidth() < 560);
const sessionsPadX = computed(() => (sessionsCompact() ? 12 : 24));

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

const transcriptMatchCount = computed(() => {
  const query = transcriptSearchQuery().trim();
  if (!query) return 0;
  return sessionTurns().filter(turn => turnMatchesSearch(turn, query)).length;
});

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

type ToolRunState = "completed" | "running" | "failed";

/** Reads tool-call run state from normalized `ToolCallView` (real Rust `toolItems`) or raw turn records. */
function toolStatusFor(turn: unknown, call: ToolCallView): ToolRunState {
  if (call.success === false || Boolean(call.error)) return "failed";
  if (call.status) {
    const status = call.status.toLowerCase();
    if (status === "failed" || status === "error" || status === "rejected" || status === "cancelled") {
      return "failed";
    }
    if (status === "running" || status === "in_progress" || status === "pending" || status === "streaming" || status === "queued" || status === "waiting" || status === "confirmation") {
      return "running";
    }
    if (status === "completed" || status === "success") return "completed";
  }
  if (!turn || typeof turn !== "object") return "completed";
  const containers: unknown[] = [turn];
  const rounds = (turn as Record<string, unknown>).modelRounds;
  if (Array.isArray(rounds)) {
    for (const round of rounds) {
      containers.push(round);
      if (round && typeof round === "object") {
        containers.push((round as Record<string, unknown>).assistantMessage);
      }
    }
  }
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const record = container as Record<string, unknown>;
    for (const key of ["toolItems", "tool_items", "toolCalls", "tool_calls"]) {
      const list = record[key];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const raw = entry as Record<string, unknown>;
        const name = raw.toolName ?? raw.tool_name ?? raw.name ?? raw.tool;
        if (name !== call.name) continue;
        if (call.id && typeof raw.id === "string" && raw.id !== call.id) continue;
        const toolResult = (raw.toolResult ?? raw.tool_result) as Record<string, unknown> | undefined;
        if (
          raw.isError === true ||
          raw.is_error === true ||
          raw.success === false ||
          raw.error ||
          toolResult?.success === false ||
          toolResult?.error
        ) {
          return "failed";
        }
        const status = String(raw.status ?? raw.state ?? "").toLowerCase();
        if (status === "failed" || status === "error" || status === "rejected" || status === "cancelled") {
          return "failed";
        }
        if (status === "running" || status === "in_progress" || status === "pending" || status === "streaming") {
          return "running";
        }
      }
    }
  }
  return "completed";
}

function liveToolToCallView(tool: LiveToolItem): ToolCallView {
  return {
    id: tool.toolId,
    name: tool.effectiveToolName || tool.toolName,
    detail: tool.progressMessage || tool.error || tool.detail,
    ...(tool.input !== undefined ? { input: tool.input } : {}),
    status: tool.status,
    ...(tool.error ? { error: tool.error } : {}),
    ...(tool.durationMs !== undefined ? { durationMs: tool.durationMs } : {}),
  };
}

function liveToolRunState(tool: LiveToolItem): ToolRunState {
  if (tool.status === "failed" || tool.status === "cancelled") return "failed";
  if (tool.status === "completed") return "completed";
  return "running";
}

function toolCategoryIcon(call: ToolCallView): IconName {
  if (todosOf(call.input).length > 0) return "check-circle";
  if (diffOf(call.input) !== null) return "file-code";
  if (commandOf(call.input)) return "terminal";
  const lower = call.name.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("exec") || lower.includes("command") || lower.includes("terminal")) {
    return "terminal";
  }
  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("replace")) {
    return "file-code";
  }
  if (lower.includes("todo") || lower.includes("plan") || lower.includes("checklist")) {
    return "check-circle";
  }
  if (lower.includes("grep") || lower.includes("glob") || lower.includes("search") || lower.includes("find")) {
    return "search";
  }
  if (lower.includes("read") || lower.includes("cat") || lower.includes("file") || lower.includes("view") || pathOf(call.input)) {
    return "file-text";
  }
  if (lower.includes("list") || lower.includes("dir") || lower.includes("ls")) {
    return "folder-open";
  }
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("http") || lower.includes("browser")) {
    return "globe";
  }
  if (lower.includes("agent") || lower.includes("subagent") || lower.includes("task")) {
    return "bot";
  }
  return "wrench";
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
function ConversationHeader() {
  return (
    <View>
      <View
        style={{
          minHeight: 38,
          paddingHorizontal: 18,
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
              fontSize: textSize(13.5),
              lineHeight: textLineHeight(13.5, 1.3),
              fontWeight: "600",
              letterSpacing: textTracking(13.5),
              flexShrink: 1,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {activeSession()
              ? sessionTitle(activeSession()!)
              : activeWorkspace()?.name || tr("sessions.newConversation")}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexShrink: 0,
              maxWidth: 160,
              gap: 5,
            }}
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
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.25),
                fontWeight: "500",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {agentLabel(agentTypeOf(activeSessionId()))}
            </Text>
          </View>
          <If when={Boolean(activeSession() && isArchived(activeSession()!))}>
            <Badge label={tr("sessions.archivedBadge")} tone="warning" />
          </If>
          <If when={Boolean(runningTurnId() || isStreamDraining())}>
            <StatusDot kind="accent" size={6} pulse={true} />
          </If>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 2 }}>
          <If when={!isTranscriptEmpty() || transcriptSearchOpen()}>
            <IconButton
              icon="search"
              size="sm"
              active={transcriptSearchOpen()}
              accessibilityLabel="transcript-search-toggle"
              tooltip={tr("sessions.searchTranscript")}
              onPress={() => {
                animateLayout();
                const next = !transcriptSearchOpen();
                transcriptSearchOpen.set(next);
                if (!next) transcriptSearchQuery.set("");
              }}
            />
            <IconButton
              icon={copiedTranscript() ? "check" : "copy"}
              size="sm"
              disabled={sessionTurns().length === 0}
              accessibilityLabel="copy-transcript"
              tooltip={tr("sessions.copyTranscript")}
              onPress={() => void copyWholeTranscript()}
            />
          </If>
          <View ref={el => threadMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={threadMenuOpen()}
              accessibilityLabel="thread-actions-trigger"
              tooltip={tr("nav.threadActions")}
              onPress={() => {
                closePickers();
                if (threadMenuOpen()) closeThreadMenu();
                else threadMenuOpen.set(true);
              }}
            />
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
              onChange={value => transcriptSearchQuery.set(value)}
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
  onPress: () => void;
}) {
  return (
    <View
      role="menuitem"
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
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
        opacity: copied() ? 1 : 0.64,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ opacity: 1, backgroundColor: palette().surfaceSubtle }}
      activeStyle={tactileActiveStyle(0.96)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon
        name={copied() ? "check" : "copy"}
        size={11}
        color={copied() ? palette().success : palette().textMuted}
      />
      <Text
        style={{
          color: copied() ? palette().success : palette().textMuted,
          fontSize: textSize(10.5),
          lineHeight: textLineHeight(10.5, 1.3),
          fontWeight: "500",
        }}
      >
        {copied() ? tr("common.copied") : tr("common.copy")}
      </Text>
    </View>
  );
}

function UserBubble(props: { partKey: string; text: string; timestamp?: number; showCopy?: boolean }) {
  const hovered = signal(false);
  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{ alignSelf: "flex-end", maxWidth: "78%", gap: 4, alignItems: "flex-end" }}
    >
      <View
        style={{
          backgroundColor: palette().userBubble,
          borderRadius: radii.xl,
          borderCurve: "continuous",
          boxShadow: palette().innerHighlight,
          paddingHorizontal: 15,
          paddingVertical: 10,
        }}
      >
        <Text
          style={{
            color: palette().userBubbleText,
            fontSize: textSize(14),
            lineHeight: textLineHeight(14, 1.58),
            userSelect: "text",
          }}
        >
          {props.text}
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 3,
          opacity: hovered() || copiedBlock() === props.partKey ? 1 : 0.44,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <If when={props.timestamp ? formatTimestamp(props.timestamp) : ""}>
          {stamp => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.3),
                fontVariant: ["tabular-nums"],
              }}
            >
              {stamp()}
            </Text>
          )}
        </If>
        <If when={props.showCopy !== false}>
          <CopyChip partKey={props.partKey} text={props.text} />
        </If>
      </View>
    </View>
  );
}

/** Which tool cards the user expanded; an id is the card's position in the transcript. */
const expandedCards = signal<string[]>([]);

/**
 * Editorial two-tier tool disclosure:
 * - Collapsed: ultra-clean borderless row matching Codex / Antigravity / Claude traces.
 * - Expanded: unfolds a calm tonal inset card with checklist progress, themed DiffView, or bounded monospace payload.
 */
function ToolCard(props: { call: ToolCallView; cardId: string; status?: ToolRunState }) {
  const todos = computed(() => todosOf(props.call.input));
  const diff = computed(() => diffOf(props.call.input));
  const filePath = computed(() => pathOf(props.call.input));
  const command = computed(() => commandOf(props.call.input));
  const icon = computed(() => toolCategoryIcon(props.call));
  const runState = computed<ToolRunState>(() => props.status ?? "completed");
  const expandable = computed(
    () => todos().length > 0 || diff() !== null || Boolean(command()) || Boolean(props.call.detail),
  );
  const expanded = computed(() => expandedCards().includes(props.cardId));
  const todoDoneCount = computed(() => todos().filter(item => item.state === "done").length);
  const summary = computed(() => {
    if (todos().length) {
      return tr("sessions.toolChecklist", {
        done: todoDoneCount(),
        total: todos().length,
      });
    }
    if (diff()) {
      return filePath()
        ? tr("sessions.toolEditPath", { path: filePath()! })
        : tr("sessions.toolEdit");
    }
    if (command()) return `$ ${command()}`;
    if (filePath()) return filePath()!;
    return props.call.detail || tr("sessions.toolCompleted");
  });
  const payloadText = computed(() => (command() ? `$ ${command()}` : props.call.detail || ""));

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          role={expandable() ? "button" : undefined}
          accessibilityLabel={expandable() ? `tool-card-${props.call.name}` : undefined}
          onPress={() => {
            if (!expandable()) return;
            animateLayout();
            const current = expandedCards();
            expandedCards.set(
              current.includes(props.cardId)
                ? current.filter(id => id !== props.cardId)
                : [...current, props.cardId],
            );
          }}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            backgroundColor: expanded() ? palette().surfaceSubtle : "transparent",
            cursor: expandable() ? "pointer" : "default",
            ...paintTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={expandable() ? { backgroundColor: palette().surfaceSubtle } : undefined}
          activeStyle={expandable() ? { backgroundColor: palette().surfaceSubtle, opacity: 0.88 } : undefined}
          focusVisibleStyle={expandable() ? focusRingStyle(-1) : undefined}
        >
          <StatusDot
            kind={
              runState() === "failed"
                ? "danger"
                : runState() === "running"
                  ? "accent"
                  : "success"
            }
            pulse={runState() === "running"}
            size={5}
          />
          <Icon
            name={icon()}
            size={12}
            color={
              runState() === "failed"
                ? palette().danger
                : diff()
                  ? palette().brandWarm
                  : todos().length > 0
                    ? palette().accent
                    : palette().textMuted
            }
          />
          <Text
            style={{
              maxWidth: "45%",
              flexShrink: 0,
              color: runState() === "failed" ? palette().danger : palette().textSecondary,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.35),
              fontWeight: "600",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("sessions.toolPrefix", { name: props.call.name })}
          </Text>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.35),
              fontFamily: command() || filePath() ? fontMono : undefined,
              fontVariant: ["tabular-nums"],
              numberOfLines: 1,
              textOverflow: filePath() ? "ellipsis-middle" : "ellipsis",
            }}
          >
            {summary()}
          </Text>
          <If when={todos().length > 0 && !expanded()}>
            <View
              style={{
                width: 34,
                height: 4,
                flexShrink: 0,
                borderRadius: radii.pill,
                backgroundColor: palette().surfaceSubtle,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 4,
                  borderRadius: radii.pill,
                  backgroundColor:
                    todoDoneCount() === todos().length ? palette().success : palette().accent,
                  width: `${Math.round((todoDoneCount() / Math.max(1, todos().length)) * 100)}%`,
                }}
              />
            </View>
          </If>
          <If when={expandable()}>
            <Icon
              name={expanded() ? "chevron-down" : "chevron-right"}
              size={12}
              color={palette().textMuted}
            />
          </If>
        </View>

        <If when={filePath() ?? ""}>
          {pathValue => (
            <View
              role="button"
              accessibilityLabel={`open-tool-file-${props.call.name}`}
              onPress={() => openInAuxPane("files", pathValue())}
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                gap: 4,
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderRadius: radii.xs,
                borderCurve: "continuous",
                backgroundColor: "transparent",
                cursor: "pointer",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              activeStyle={tactileActiveStyle(0.96)}
              focusVisibleStyle={focusRingStyle()}
            >
              <Icon name="external-link" size={11} color={palette().accent} />
              <Text
                style={{
                  color: palette().accent,
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.25),
                  fontWeight: "500",
                }}
              >
                {tr("sessions.openInFiles")}
              </Text>
            </View>
          )}
        </If>
      </View>

      <If when={expanded()}>
        <View
          style={{
            gap: 8,
            padding: 10,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: runState() === "failed" ? palette().dangerBorder : palette().borderSubtle,
            backgroundColor: palette().surfaceTertiary,
          }}
        >
          <If when={todos().length > 0}>
            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: radii.pill,
                    backgroundColor: palette().surfaceSubtle,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 4,
                      borderRadius: radii.pill,
                      backgroundColor:
                        todoDoneCount() === todos().length ? palette().success : palette().accent,
                      width: `${Math.round((todoDoneCount() / Math.max(1, todos().length)) * 100)}%`,
                    }}
                  />
                </View>
                <Text
                  style={{
                    flexShrink: 0,
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.25),
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {`${todoDoneCount()}/${todos().length}`}
                </Text>
              </View>
              <Each of={todos()} key="index">
                {item => (
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <View style={{ marginTop: 5, flexShrink: 0 }}>
                      <StatusDot
                        kind={
                          item().state === "done"
                            ? "success"
                            : item().state === "active"
                              ? "accent"
                              : "muted"
                        }
                        pulse={item().state === "active"}
                        size={6}
                      />
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.45),
                        color: item().state === "done" ? palette().textMuted : palette().text,
                      }}
                    >
                      {item().text}
                    </Text>
                  </View>
                )}
              </Each>
            </View>
          </If>

          <If when={diff()}>
            {change => (
              <View
                style={{
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().canvasSubtle,
                }}
              >
                <If when={filePath() ?? ""}>
                  {fp => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderBottomWidth: 1,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.3),
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {basename(fp())}
                      </Text>
                      <Text
                        style={{
                          flexShrink: 0,
                          color: palette().textMuted,
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.25),
                          fontWeight: "500",
                        }}
                      >
                        {inferCodeLanguage(fp()) || "diff"}
                      </Text>
                    </View>
                  )}
                </If>
                <View style={{ height: 224 }}>
                  <DiffView
                    oldValue={"oldText" in change() ? (change() as { oldText: string }).oldText : null}
                    newValue={"newText" in change() ? (change() as { newText: string }).newText : null}
                    patch={"patch" in change() ? (change() as { patch: string }).patch : null}
                    language={inferCodeLanguage(filePath() ?? undefined)}
                    layout="unified"
                    indicators="bars"
                    inline="wordAlt"
                    lineNumbers={true}
                    fontFamily={fontMono}
                    fontSize={textSize(12)}
                    lineHeight={textLineHeight(12, 1.55)}
                    styles={createDiffViewStyles()}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}
          </If>

          <If when={todos().length === 0 && !diff() && Boolean(payloadText())}>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
                <CopyChip partKey={`tool-payload-${props.cardId}`} text={payloadText()} />
              </View>
              <Scroll style={{ maxHeight: 240, minHeight: 0 }} scrollbar={true}>
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontFamily: fontMono,
                    fontSize: textSize(11),
                    lineHeight: textLineHeight(11, 1.55),
                    userSelect: "text",
                  }}
                >
                  {payloadText()}
                </Text>
              </Scroll>
            </View>
          </If>
        </View>
      </If>
    </View>
  );
}

/** Collapsible THINKING / THINKING SUMMARY pill disclosure with animateLayout(). */
const expandedThinking = signal<string[]>([]);

function ThinkingBlock(props: {
  partKey: string;
  text: string;
  kind?: "reasoning" | "summary";
  live?: boolean;
}) {
  const expanded = computed(() => expandedThinking().includes(props.partKey));
  return (
    <View style={{ gap: 6 }}>
      <View
        role="button"
        accessibilityLabel={`thinking-${props.partKey}`}
        onPress={() => {
          animateLayout();
          const current = expandedThinking();
          expandedThinking.set(
            current.includes(props.partKey)
              ? current.filter(id => id !== props.partKey)
              : [...current, props.partKey],
          );
        }}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 4.5,
          borderRadius: radii.pill,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: props.live
            ? palette().accentBorder
            : expanded()
              ? palette().border
              : palette().borderSubtle,
          backgroundColor: props.live
            ? palette().accentSoft
            : expanded()
              ? palette().panelRaised
              : palette().surfaceSubtle,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          backgroundColor: props.live ? palette().accentSoft : palette().panelHover,
          borderColor: props.live ? palette().accent : palette().border,
        }}
        activeStyle={{ opacity: 0.9 }}
        focusVisibleStyle={focusRingStyle(-1)}
      >
        <If when={Boolean(props.live)}>
          <BrandSpinner size={11} color={palette().accent} variant="bars" />
        </If>
        <Text
          style={{
            color: props.live ? palette().accent : palette().textSecondary,
            fontSize: textSize(10.5),
            lineHeight: textLineHeight(10.5, 1.3),
            fontWeight: "600",
            letterSpacing: textTracking(10.5, true),
          }}
        >
          {props.kind === "summary"
            ? tr("sessions.thinkingSummaryHeader")
            : tr("sessions.thinkingHeader")}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(10.5),
            lineHeight: textLineHeight(10.5, 1.3),
            fontVariant: ["tabular-nums"],
          }}
        >
          {props.live
            ? tr("sessions.thinkingStreaming")
            : formatPlural(props.text.length, "format.characterOne", "format.characterOther")}
        </Text>
        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          size={11}
          color={palette().textMuted}
        />
      </View>
      <If when={expanded()}>
        <View
          style={{
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: props.live ? palette().accentBorder : palette().borderSubtle,
            backgroundColor: palette().surfaceTertiary,
            overflow: "hidden",
          }}
        >
          <Scroll
            style={{ maxHeight: 220, minHeight: 0 }}
            scrollbar={true}
            contentStyle={{ paddingHorizontal: 13, paddingVertical: 10 }}
          >
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.6),
                userSelect: "text",
              }}
            >
              {props.text}
            </Text>
          </Scroll>
        </View>
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
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 10,
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
                    padding: 15,
                    borderRadius: radii.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().border,
                    backgroundColor: palette().panelRaised,
                    boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    cursor: "pointer",
                    ...pressTransition(MOTION_DURATION.fast),
                  },
                  cardMotion.style,
                ]}
                hoverStyle={{
                  backgroundColor: palette().panelHover,
                  borderColor: palette().borderStrong,
                }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={focusRingStyle()}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    flexShrink: 0,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().surfaceSubtle,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={card().icon} size={14} color={palette().textSecondary} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(13.5),
                      lineHeight: textLineHeight(13.5, 1.34),
                      fontWeight: "600",
                    }}
                  >
                    {tr(card().titleKey)}
                  </Text>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.44),
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
    !pendingTurn() &&
    !pendingTurnState() &&
    !runningTurnId() &&
    !hasLiveContent(),
);

const optimisticUserText = computed(() => pendingTurnState()?.userText || pendingTurn());

const liveRounds = computed(() => liveTurn()?.rounds ?? []);

function Transcript() {
  resetTranscriptScrollTracking();
  let lastSessionId = activeSessionId();
  let lastOptimisticText = optimisticUserText();

  effect(() => {
    const id = activeSessionId();
    if (id !== lastSessionId) {
      lastSessionId = id;
      resetTranscriptScrollTracking();
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
            gap: 28,
          }}
        >
          <If when={isTranscriptEmpty()}>
            <WelcomeStudio />
          </If>

          <Each of={sessionTurns()} key="index">
            {turn => (
              <View
                style={{
                  gap: 12,
                  marginHorizontal: turnMatchesSearch(turn(), transcriptSearchQuery()) ? -10 : 0,
                  paddingHorizontal: turnMatchesSearch(turn(), transcriptSearchQuery()) ? 10 : 0,
                  paddingVertical: turnMatchesSearch(turn(), transcriptSearchQuery()) ? 8 : 0,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: turnMatchesSearch(turn(), transcriptSearchQuery()) ? 1 : 0,
                  borderColor: palette().accentBorder,
                  backgroundColor: turnMatchesSearch(turn(), transcriptSearchQuery())
                    ? palette().accentSoft
                    : "transparent",
                }}
              >
                <Each of={userPartsOf(turn())} key="index">
                  {part => (
                    <UserBubble
                      partKey={turnPartKey(turn(), part())}
                      text={part().text}
                      timestamp={turnTimestampOf(turn())}
                    />
                  )}
                </Each>

                <If
                  when={
                    thinkingPartsOf(turn()).length > 0 ||
                    toolCallsOf(turn()).length > 0 ||
                    responsePartsOf(turn()).length > 0
                  }
                >
                  <View style={{ gap: 10 }}>
                    {/* Layer 2: Quiet borderless editorial trace rail (thinking + tools) */}
                    <If when={thinkingPartsOf(turn()).length > 0 || toolCallsOf(turn()).length > 0}>
                      <View
                        style={{
                          paddingLeft: 14,
                          borderLeftWidth: 1.5,
                          borderColor: palette().borderSubtle,
                          gap: 5,
                        }}
                      >
                        <Each of={thinkingPartsOf(turn())} key="index">
                          {part => (
                            <ThinkingBlock
                              partKey={turnPartKey(turn(), part())}
                              text={part().text}
                              kind={part().reasoningKind}
                            />
                          )}
                        </Each>

                        <If when={toolCallsOf(turn()).length > 0}>
                          <View style={{ gap: 2 }}>
                            <Each of={toolCallsOf(turn())} key="index">
                              {call => (
                                <ToolCard
                                  call={call()}
                                  status={toolStatusFor(turn(), call())}
                                  cardId={`${turnKeyOf(turn()) || "turn"}|${call().id || call().name}|${call().detail}`}
                                />
                              )}
                            </Each>
                          </View>
                        </If>
                      </View>
                    </If>

                    {/* Layer 3: Editorial Markdown answer directly on the calm canvas (~72ch measure) */}
                    <Each of={responsePartsOf(turn())} key="index">
                      {part => (
                        <View
                          style={{
                            width: "100%",
                            maxWidth: Math.min(contentWidth(), 740),
                            gap: 6,
                          }}
                        >
                          <TextView
                            markdown={part().text}
                            selectable
                            links="open"
                            options={STATIC_MARKDOWN_OPTIONS}
                            codeBlockActions={createMarkdownCodeActions()}
                            styles={createMarkdownStyles()}
                          />
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <CopyChip partKey={turnPartKey(turn(), part())} text={part().text} />
                            <If when={turnMetadataLabel(turn())}>
                              {meta => (
                                <Text
                                  style={{
                                    color: palette().textMuted,
                                    fontSize: textSize(10.5),
                                    lineHeight: textLineHeight(10.5, 1.3),
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  {meta()}
                                </Text>
                              )}
                            </If>
                          </View>
                        </View>
                      )}
                    </Each>
                  </View>
                </If>
              </View>
            )}
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

          <If when={hasLiveContent()}>
            <View style={{ gap: 12 }}>
              <If when={liveRounds().length > 0}>
                <Each of={liveRounds()} key={round => round.roundId}>
                  {round => (
                    <View style={{ gap: 10 }}>
                      <If
                        when={
                          hasLiveRoundThinking(round().roundId) || round().tools.length > 0
                        }
                      >
                        <View
                          style={{
                            paddingLeft: 14,
                            borderLeftWidth: 1.5,
                            borderColor: palette().borderSubtle,
                            gap: 5,
                          }}
                        >
                          <If when={hasLiveRoundThinking(round().roundId)}>
                            <ThinkingBlock
                              partKey={
                                round().roundId === "__default__" || liveRounds().length === 1
                                  ? "live-thinking"
                                  : `live-thinking-${round().roundId}`
                              }
                              text={getLiveRoundThinking(round().roundId)}
                              kind={round().reasoningKind}
                              live={!round().completed}
                            />
                          </If>
                          <If when={round().tools.length > 0}>
                            <View style={{ gap: 2 }}>
                              <Each of={round().tools} key={tool => tool.toolId}>
                                {tool => (
                                  <ToolCard
                                    call={liveToolToCallView(tool())}
                                    status={liveToolRunState(tool())}
                                    cardId={`live-tool-${round().roundId}-${tool().toolId}`}
                                  />
                                )}
                              </Each>
                            </View>
                          </If>
                        </View>
                      </If>
                      <If when={hasLiveRoundText(round().roundId)}>
                        <View
                          style={{
                            width: "100%",
                            maxWidth: Math.min(contentWidth(), 740),
                          }}
                        >
                          <TextView
                            markdown={getLiveRoundText(round().roundId)}
                            selectable
                            links="open"
                            options={STREAMING_MARKDOWN_OPTIONS}
                            codeBlockActions={createMarkdownCodeActions()}
                            styles={createMarkdownStyles()}
                          />
                        </View>
                      </If>
                    </View>
                  )}
                </Each>
              </If>

              {/* Fallback when flat stream signals exist without structured round state. */}
              <If when={liveRounds().length === 0}>
                <View style={{ gap: 10 }}>
                  <If when={hasLiveThinking()}>
                    <View
                      style={{
                        paddingLeft: 14,
                        borderLeftWidth: 1.5,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <ThinkingBlock partKey="live-thinking" text={thinkingText()} live={true} />
                    </View>
                  </If>
                  <If when={hasLiveText()}>
                    <View
                      style={{
                        width: "100%",
                        maxWidth: Math.min(contentWidth(), 740),
                      }}
                    >
                      <TextView
                        markdown={streamText()}
                        selectable
                        links="open"
                        options={STREAMING_MARKDOWN_OPTIONS}
                        codeBlockActions={createMarkdownCodeActions()}
                        styles={createMarkdownStyles()}
                      />
                    </View>
                  </If>
                </View>
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
        </View>
      </Scroll>

      <If when={!followLatest()}>
        <LatestPill />
      </If>
    </View>
  );
}

function RunningAmbientCard() {
  const motion = enterMotion("fadeInUp", MOTION_DURATION.fast);
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
          {hasLiveTools() && !hasLiveText()
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
        {activeModelLabel()}
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

async function submitComposer(): Promise<void> {
  if (insertSelectedMention()) return;
  const text = composerText();
  const hasPayload = Boolean(text.trim() || imageAttachments().length > 0);
  if (runningTurnId()) {
    if (midTurnSendPolicy() === "queue") await queueComposerText();
    else {
      if (hasPayload) jumpToTranscriptEnd();
      await sendTurn(text);
    }
    return;
  }
  if (hasPayload) jumpToTranscriptEnd();
  await sendTurn(text);
}

async function queueComposerText(): Promise<void> {
  const sessionId = activeSessionId();
  const text = composerText().trim();
  if (!sessionId || !text) return;
  composerText.set("");
  const queued = await enqueueMessage(text);
  if (!queued) composerText.set(text);
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
function ComposerDock() {
  ensureModelsLoaded();
  ensureQuickActions();
  effect(() => {
    const id = activeSessionId();
    if (id) void loadQueueForSession(id);
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
            boxShadow: `${palette().shadowComposer}, ${palette().innerHighlight}`,
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
                    <Icon name="image" size={12} color={palette().textSecondary} />
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
            {/* Left: Compact readable Agent + Model/Reasoning pills */}
            <View
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: compactComposer() ? 4 : 4,
                overflow: "hidden",
              }}
            >
              <AgentPickerTrigger compact={compactComposer} />
              <ModelReasoningCapsule compact={compactComposer} />
            </View>

            {/* Right: Attach, @ Reference, Quick Actions, High-Contrast Send / Rose Stop Square */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                gap: compactComposer() ? 2 : 4,
              }}
            >
              <IconButton
                icon="paperclip"
                size={compactComposer() ? "xs" : "sm"}
                iconSize={compactComposer() ? 14 : 15}
                accessibilityLabel="Attach"
                tooltip={tr("sessions.attachImage")}
                onPress={() => {
                  closePickers();
                  void attachImageFromClipboard();
                }}
              />
              <IconButton
                icon="at"
                size={compactComposer() ? "xs" : "sm"}
                iconSize={compactComposer() ? 14 : 15}
                active={mentionOpen()}
                accessibilityLabel="Reference"
                tooltip={tr("sessions.referenceFile")}
                onPress={() => {
                  if (mentionOpen()) closeMentionPopover();
                  else {
                    closePickers();
                    openMention();
                  }
                }}
              />
              <View ref={el => quickActionsAnchor.set(el)} style={{ flexShrink: 0 }}>
                <IconButton
                  icon="bolt"
                  size={compactComposer() ? "xs" : "sm"}
                  iconSize={compactComposer() ? 14 : 15}
                  active={quickActionMenuOpen()}
                  accessibilityLabel="Actions"
                  tooltip={tr("sessions.quickActions")}
                  onPress={() => {
                    const next = !quickActionMenuOpen();
                    closePickers(next ? "actions" : undefined);
                    quickActionMenuOpen.set(next);
                  }}
                />
              </View>

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
                      void (midTurnSendPolicy() === "queue"
                        ? sendTurn(composerText())
                        : queueComposerText())
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
                      boxShadow: palette().shadowButton,
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
                <View style={{ flexShrink: 0, paddingLeft: compactComposer() ? 2 : 4 }}>
                  <IconCircleButton
                    icon="arrow-up"
                    variant={composerDisabled() || !composerText().trim() ? "subtle" : "primary"}
                    size={compactComposer() ? 28 : 30}
                    accessibilityLabel="Send"
                    tooltip={tr("sessions.sendMessage")}
                    disabled={composerDisabled() || !composerText().trim()}
                    onPress={() => void submitComposer()}
                  />
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
          {sessionStarted(activeSessionId())
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
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button
                label={tr("sessions.allowOnce")}
                variant="primary"
                size="sm"
                pill={true}
                onPress={() => void answerPermission(request().requestId, "once")}
              />
              <Button
                label={tr("sessions.alwaysAllow")}
                variant="secondary"
                size="sm"
                pill={true}
                onPress={() => void answerPermission(request().requestId, "always")}
              />
              <Button
                label={tr("sessions.reject")}
                variant="danger"
                size="sm"
                pill={true}
                onPress={() => void answerPermission(request().requestId, "reject")}
              />
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
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
              <QuestionBlock prompt={prompt} question={question} index={index()} />
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

export function SessionsScene() {
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

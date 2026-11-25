// Independent state and operations for the secondary split session pane (Pane 1).
//
// Memory discipline: Pane 1 retains transcript turns, draft text, attachments,
// and live streaming state ONLY while split view is open. Switching Pane 1 to
// another session or closing split view immediately releases the previous
// session's turns and attachments so zero background transcript caches linger.

import { batch, computed, signal } from "nsh";
import {
  cancelDialogTurn,
  createSession,
  interruptDialogTurn,
  startDialogTurn,
  type SessionTranscriptView,
  type SubmitUserMessageResult,
  type TranscriptTurnView,
  type WorkspaceRecord,
} from "./api";
import {
  buildAttachmentContexts,
  composeMessageWithFileAttachments,
  type FileAttachment,
  type ImageAttachment,
} from "./attachmentStore";
import { fleetActive, invokeCommand } from "./bridge";
import { closeSideQuestion, sideQuestionOpen } from "./btwStore";
import { fleetDeviceById, fleetSessionRow, fleetWorkspaceByKey } from "./fleetStore";
import { isCommandUnavailable } from "./hostCommands";
import { tr } from "./i18n";
import { noteTranscriptSource } from "./toolDetailStore";
import { clearPermissionsForSession } from "./permissionStore";
import { clearPromptSuggestion, hydratePromptSuggestionFromTranscript } from "./promptSuggestionStore";
import { markSessionSeen } from "./sessionStatusStore";
import { ensureRemoteConnected } from "./sshRemoteStore";
import {
  activeSessionDevice,
  activeSessionId,
  activeSessionKey,
  activeWorkspaceId,
  activeWorkspaceRoot,
  agentTypeOf,
  chosenAgentType,
  deviceContext,
  deviceOfSession,
  focusPane,
  focusedPane,
  isSessionArchived,
  loadSessions,
  notifySecondaryRunningTurn,
  notifySecondarySessionSwitch,
  registerSecondaryPaneBridge,
  runningTurns,
  runStep,
  secondarySessionDevice,
  secondarySessionId,
  secondarySessionKey,
  BACKFILL_DELAY_MS,
  BACKFILL_TURN_BATCH,
  earlierPageSizeFor,
  earliestTurnIndexOf,
  INITIAL_FAST_TURN_COUNT,
  mergePrependedTurns,
  secondaryWorkspaceId,
  selectSession,
  sessionKey,
  sessionLastActivityMs,
  sessions,
  shouldAutoBackfillTurns,
  splitPaneOpen,
  TAIL_REFRESH_MIN_LIMIT,
  workspaces,
  type PendingTurnState,
} from "./state";
import { clearQuestionsForSession, loadQuestionMailbox } from "./userQuestionStore";

export const secondaryTurns = signal<TranscriptTurnView[]>([]);
export const secondaryTurnsLoading = signal(false);
export const secondaryTranscriptNotice = signal("");
export const secondaryTurnError = signal("");
export const secondarySendNotice = signal("");
export const secondaryPendingTurnState = signal<PendingTurnState | null>(null);
export const secondaryComposerText = signal("");
export const secondaryImageAttachments = signal<ImageAttachment[]>([]);
export const secondaryFileAttachments = signal<FileAttachment[]>([]);
const secondaryTranscriptHasEarlier = signal(false);

let secondaryTranscriptCursor: { sessionKey: string; cursor: string } | null = null;
let secondaryTurnsLoadSeq = 0;
let secondaryEarlierLoadSeq = 0;
let secondaryEarlierInFlight = false;
let secondaryBackfillTimer: ReturnType<typeof setTimeout> | null = null;
let secondaryAutoBackfillGuard: (() => boolean) | null = null;
let secondaryBeforePrependListener: (() => void) | null = null;

export function registerSecondaryAutoBackfillGuard(guard: (() => boolean) | null): void {
  secondaryAutoBackfillGuard = guard;
}

export function registerSecondaryBeforePrependListener(listener: (() => void) | null): void {
  secondaryBeforePrependListener = listener;
}

function cancelPendingSecondaryBackfill(): void {
  if (secondaryBackfillTimer !== null) {
    clearTimeout(secondaryBackfillTimer);
    secondaryBackfillTimer = null;
  }
}

function secondaryRouteOptions(deviceId?: string): { target: string } | undefined {
  const device = deviceId ?? secondarySessionDevice();
  return fleetActive() && device ? { target: device } : undefined;
}

export const secondaryRunningTurnId = computed<string | null>(() => {
  const key = secondarySessionKey();
  return key ? (runningTurns()[key] ?? null) : null;
});

export const secondarySessionSummary = computed(() => {
  const id = secondarySessionId();
  if (!id) return null;
  return sessions().find(item => item.sessionId === id) ?? null;
});

export const secondaryWorkspaceRecord = computed<WorkspaceRecord | null>(() => {
  const wsId = secondaryWorkspaceId();
  if (!wsId) return null;
  const local = workspaces().find(item => item.id === wsId);
  if (local) return local;
  if (fleetActive()) {
    const dev = secondarySessionDevice() || deviceContext();
    const row = fleetWorkspaceByKey({ deviceId: dev, workspaceId: wsId });
    if (row) {
      return {
        id: row.workspaceId,
        name: row.name,
        rootPath: row.rootPath,
        workspaceKind: row.kind === "remote_ssh" ? "remote" : row.kind,
        ...(row.sshHost ? { sshHost: row.sshHost } : {}),
        ...(row.connectionId ? { connectionId: row.connectionId } : {}),
        ...(row.connectionName ? { connectionName: row.connectionName } : {}),
      };
    }
  }
  return null;
});

export const secondaryWorkspaceName = computed<string>(() => {
  const ws = secondaryWorkspaceRecord();
  if (ws?.name) return ws.name;
  const root = ws?.rootPath ?? "";
  if (root) {
    const parts = root.split(/[\\/]/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "";
});

export const secondaryWorkspaceRoot = computed<string>(() => secondaryWorkspaceRecord()?.rootPath ?? "");

export const secondarySessionTitle = computed<string>(() => {
  const id = secondarySessionId();
  if (!id) return tr("sessions.splitPickTitle");
  const local = secondarySessionSummary();
  if (local?.sessionName?.trim()) return local.sessionName.trim();
  const fleetRow = fleetSessionRow(secondarySessionDevice(), id);
  if (fleetRow?.title?.trim()) return fleetRow.title.trim();
  return id;
});

export const secondaryHasEarlierTurns = computed<boolean>(
  () => Boolean(secondarySessionId()) && secondaryTranscriptHasEarlier(),
);

export function addSecondaryImageAttachment(item: ImageAttachment): void {
  secondaryImageAttachments.update(current => [...current, item]);
}

export function removeSecondaryImageAttachment(id: string): void {
  secondaryImageAttachments.update(current => current.filter(item => item.id !== id));
}

export function addSecondaryFileAttachment(item: FileAttachment): void {
  secondaryFileAttachments.update(current => {
    const exists = current.some(existing => existing.path === item.path);
    return exists ? current : [...current, item];
  });
}

export function removeSecondaryFileAttachment(id: string): void {
  secondaryFileAttachments.update(current => current.filter(item => item.id !== id));
}

export function clearSecondaryAttachments(): void {
  secondaryImageAttachments.set([]);
  secondaryFileAttachments.set([]);
}

function matchesSecondaryPending(pending: PendingTurnState, sessionId: string, key?: string): boolean {
  const targetKey = key ?? secondarySessionKey() ?? sessionKey(sessionId);
  if (pending.sessionKey) return pending.sessionKey === targetKey;
  return pending.sessionId === sessionId;
}

export function setSecondaryPendingTurn(
  sessionId: string,
  userText: string,
  turnId?: string,
  images?: ImageAttachment[],
): void {
  const trimmed = userText.trim();
  if (!sessionId || !trimmed) return;
  const key = secondarySessionKey() ?? sessionKey(sessionId, secondarySessionDevice());
  secondaryPendingTurnState.set({
    sessionId,
    sessionKey: key,
    ...(turnId ? { turnId } : {}),
    userText: trimmed,
    ...(images && images.length > 0 ? { images: [...images] } : {}),
    createdAt: Date.now(),
    baselineTurnCount: secondaryTurns().length,
  });
}

export function bindSecondaryPendingTurnId(
  sessionId: string,
  turnId: string,
  userText?: string,
  images?: ImageAttachment[],
): void {
  const current = secondaryPendingTurnState();
  const key = secondarySessionKey() ?? sessionKey(sessionId, secondarySessionDevice());
  if (current && matchesSecondaryPending(current, sessionId, key)) {
    const mergedImages =
      current.images && current.images.length > 0
        ? current.images
        : images && images.length > 0
          ? [...images]
          : undefined;
    secondaryPendingTurnState.set({
      ...current,
      sessionKey: current.sessionKey ?? key,
      turnId,
      ...(userText && !current.userText ? { userText } : {}),
      ...(mergedImages ? { images: mergedImages } : {}),
    });
    return;
  }
  if (userText && userText.trim()) {
    setSecondaryPendingTurn(sessionId, userText, turnId, images);
  }
}

export function clearSecondaryPendingTurn(sessionId?: string, key?: string): void {
  const current = secondaryPendingTurnState();
  if (sessionId && current && !matchesSecondaryPending(current, sessionId, key)) return;
  secondaryPendingTurnState.set(null);
}

function reconcileSecondaryPendingWithPersisted(
  sessionId: string,
  turns: TranscriptTurnView[],
  key: string,
): void {
  const pending = secondaryPendingTurnState();
  if (!pending || !matchesSecondaryPending(pending, sessionId, key)) return;
  if (pending.turnId) {
    const matched = turns.find(turn => turn.turnId === pending.turnId);
    if (matched && matched.settled !== false) {
      clearSecondaryPendingTurn(sessionId, key);
    }
    return;
  }
  if (turns.length > pending.baselineTurnCount) {
    const latest = turns[turns.length - 1];
    const content = (latest?.user?.text ?? "").trim();
    if (latest?.settled !== false && (!content || content === pending.userText)) {
      clearSecondaryPendingTurn(sessionId, key);
    }
  }
}

function resetSecondaryRuntimeState(): void {
  cancelPendingSecondaryBackfill();
  secondaryTurnsLoadSeq += 1;
  secondaryEarlierLoadSeq += 1;
  secondaryEarlierInFlight = false;
  secondaryTranscriptCursor = null;
  secondaryTranscriptHasEarlier.set(false);
  secondaryTurns.set([]);
  secondaryTurnsLoading.set(false);
  secondaryTranscriptNotice.set("");
  secondaryTurnError.set("");
  secondarySendNotice.set("");
  secondaryPendingTurnState.set(null);
  secondaryComposerText.set("");
  clearSecondaryAttachments();
}

/** Picks the best default second session when opening split view without a target. */
function pickDefaultSecondarySession(): { sessionId: string; deviceId: string; workspaceId: string } | null {
  const primaryKey = activeSessionKey();
  const activeWs = activeWorkspaceId() ?? "";
  const activeDev = fleetActive() ? deviceContext() : "";

  for (const row of sessions()) {
    if (isSessionArchived(row)) continue;
    const rowDev = fleetActive() ? (row.deviceId ?? activeDev) : "";
    if (`${rowDev}/${row.sessionId}` === primaryKey) continue;
    return {
      sessionId: row.sessionId,
      deviceId: rowDev,
      workspaceId: row.workspaceId || activeWs,
    };
  }

  if (fleetActive()) {
    const device = fleetDeviceById(activeDev);
    for (const ws of device?.workspaces ?? []) {
      for (const row of ws.sessions) {
        if (`${row.deviceId}/${row.sessionId}` === primaryKey) continue;
        return {
          sessionId: row.sessionId,
          deviceId: row.deviceId,
          workspaceId: row.workspaceId || ws.workspaceId,
        };
      }
    }
  }
  return null;
}

/**
 * Selects a session into the secondary split pane (Pane 1). Opens split view if
 * closed. If the session is already open in Pane 0, focuses Pane 0 instead of
 * duplicating the same session in both panes.
 */
export function selectSecondarySession(
  sessionId: string,
  deviceId?: string,
  workspaceId?: string | null,
): void {
  const device = fleetActive() ? (deviceId ?? deviceOfSession(sessionId)) : "";
  const nextKey = `${device}/${sessionId}`;

  if (activeSessionKey() === nextKey) {
    focusPane(0);
    return;
  }

  const prevId = secondarySessionId();
  const prevKey = secondarySessionKey();
  const row = sessions().find(item => item.sessionId === sessionId);
  const fleetRow = fleetActive() ? fleetSessionRow(device, sessionId) : null;
  const resolvedWs =
    workspaceId ||
    row?.workspaceId ||
    fleetRow?.workspaceId ||
    activeWorkspaceId() ||
    null;

  if (sideQuestionOpen()) closeSideQuestion();
  batch(() => {
    splitPaneOpen.set(true);
    focusedPane.set(1);
    if (prevKey !== nextKey) {
      notifySecondarySessionSwitch("leave", prevId, prevKey);
      resetSecondaryRuntimeState();
      secondarySessionDevice.set(device);
      secondaryWorkspaceId.set(resolvedWs);
      secondarySessionId.set(sessionId);
      secondaryTurnsLoading.set(true);
      notifySecondarySessionSwitch("enter", sessionId, nextKey);
    } else if (resolvedWs && secondaryWorkspaceId() !== resolvedWs) {
      secondaryWorkspaceId.set(resolvedWs);
    }
  });

  markSessionSeen(sessionId, sessionLastActivityMs(row) ?? fleetRow?.lastActivityMs);
  const secondaryWs = secondaryWorkspaceRecord();
  if (secondaryWs) void ensureRemoteConnected(secondaryWs);
  void loadSecondaryTurns(sessionId, { silent: true });
  void loadQuestionMailbox(sessionId);
}

/**
 * Opens dual-session split view. When `target.sessionId` is omitted, opens the
 * next available non-archived session in Pane 1 (or the inline split session
 * picker if no second session exists yet).
 */
export function openSplitPane(target?: {
  sessionId?: string | null;
  deviceId?: string;
  workspaceId?: string | null;
}): void {
  if (target?.sessionId) {
    const dev = fleetActive() ? (target.deviceId ?? deviceOfSession(target.sessionId)) : "";
    if (`${dev}/${target.sessionId}` !== activeSessionKey()) {
      selectSecondarySession(target.sessionId, dev, target.workspaceId);
      return;
    }
  }
  if (splitPaneOpen() && secondarySessionId()) {
    focusPane(1);
    return;
  }
  const candidate = pickDefaultSecondarySession();
  if (candidate) {
    selectSecondarySession(candidate.sessionId, candidate.deviceId, candidate.workspaceId);
    return;
  }
  if (sideQuestionOpen()) closeSideQuestion();
  batch(() => {
    splitPaneOpen.set(true);
    focusedPane.set(1);
    resetSecondaryRuntimeState();
    secondarySessionDevice.set(fleetActive() ? deviceContext() : "");
    secondaryWorkspaceId.set(activeWorkspaceId());
    secondarySessionId.set(null);
  });
}

/**
 * Closes either Pane 0 or Pane 1 and immediately releases secondary state from
 * memory. Closing Pane 0 while Pane 1 holds a session promotes Pane 1 into the
 * primary pane so the user never loses their active conversation.
 */
export function closeSplitPane(paneToClose: 0 | 1 = 1): void {
  if (!splitPaneOpen()) return;
  const secId = secondarySessionId();
  const secDev = secondarySessionDevice();
  const secWs = secondaryWorkspaceId();
  const secKey = secondarySessionKey();

  batch(() => {
    notifySecondarySessionSwitch("close", secId, secKey);
    splitPaneOpen.set(false);
    focusedPane.set(0);
    secondarySessionId.set(null);
    secondarySessionDevice.set("");
    secondaryWorkspaceId.set(null);
    resetSecondaryRuntimeState();
  });

  if (paneToClose === 0 && secId) {
    selectSession(secId, secDev, secWs || undefined);
  }
}

/** Swaps the sessions displayed in Pane 0 and Pane 1. */
export function swapSplitPanes(): void {
  if (!splitPaneOpen()) return;
  const pId = activeSessionId();
  const pDev = activeSessionDevice();
  const pWs = activeWorkspaceId();
  const sId = secondarySessionId();
  const sDev = secondarySessionDevice();
  const sWs = secondaryWorkspaceId();
  if (!pId || !sId) return;

  // Clear Pane 1 first so `selectSession` + `selectSecondarySession` never collide on duplicate checks.
  batch(() => {
    notifySecondarySessionSwitch("leave", sId, secondarySessionKey());
    secondarySessionId.set(null);
    resetSecondaryRuntimeState();
  });
  selectSession(sId, sDev, sWs || undefined);
  selectSecondarySession(pId, pDev, pWs);
}

/** Clears Pane 1's session (falling back to the split picker) if it was deleted/archived. */
export function clearSecondarySession(): void {
  const prevId = secondarySessionId();
  const prevKey = secondarySessionKey();
  batch(() => {
    notifySecondarySessionSwitch("leave", prevId, prevKey);
    secondarySessionId.set(null);
    resetSecondaryRuntimeState();
  });
}

function scheduleSecondaryBackfill(sessionId: string, key: string, expectedLoadSeq: number): void {
  cancelPendingSecondaryBackfill();
  if (!secondaryTranscriptHasEarlier()) return;
  if (!shouldAutoBackfillTurns(secondaryTurns())) return;
  secondaryBackfillTimer = setTimeout(() => {
    secondaryBackfillTimer = null;
    if (!splitPaneOpen() || secondaryTurnsLoadSeq !== expectedLoadSeq || secondarySessionKey() !== key) return;
    if (secondaryEarlierInFlight || !secondaryTranscriptHasEarlier()) return;
    if (!shouldAutoBackfillTurns(secondaryTurns())) return;
    if (secondaryAutoBackfillGuard && !secondaryAutoBackfillGuard()) return;
    void fetchSecondaryEarlierPage(sessionId, key, BACKFILL_TURN_BATCH, {
      isAutoBackfill: true,
      expectedLoadSeq,
    });
  }, BACKFILL_DELAY_MS);
}

async function fetchSecondaryEarlierPage(
  sessionId: string,
  key: string,
  pageSize: number,
  options?: { isAutoBackfill?: boolean; expectedLoadSeq?: number },
): Promise<void> {
  if (!splitPaneOpen() || secondarySessionId() !== sessionId) return;
  const workspaceId = secondaryWorkspaceId() || activeWorkspaceId();
  if (!workspaceId || secondaryEarlierInFlight) return;
  const device = secondarySessionDevice();
  const earliest = earliestTurnIndexOf(secondaryTurns());
  if (earliest === undefined || earliest === 0) {
    secondaryTranscriptHasEarlier.set(false);
    return;
  }

  const reqSeq = ++secondaryEarlierLoadSeq;
  const loadSeqSnapshot = options?.expectedLoadSeq ?? secondaryTurnsLoadSeq;
  secondaryEarlierInFlight = true;
  try {
    const view = await invokeCommand<SessionTranscriptView>(
      "get_session_transcript_view",
      {
        session_id: sessionId,
        workspace_id: workspaceId,
        limit: pageSize,
        before_turn_index: earliest,
        tool_detail: "summary",
      },
      secondaryRouteOptions(device),
    );
    if (
      !splitPaneOpen() ||
      reqSeq !== secondaryEarlierLoadSeq ||
      secondaryTurnsLoadSeq !== loadSeqSnapshot ||
      secondarySessionKey() !== key
    ) {
      return;
    }
    if (view.mode !== "before") return;
    const older = Array.isArray(view.turns) ? view.turns : [];
    noteTranscriptSource(older, { sessionId, workspaceId, deviceId: device });
    const more = Boolean(view.hasEarlier);
    if (older.length > 0) {
      secondaryBeforePrependListener?.();
    }
    batch(() => {
      if (older.length > 0) {
        secondaryTurns.set(mergePrependedTurns(older, secondaryTurns()));
      }
      secondaryTranscriptHasEarlier.set(more);
    });
    if (
      options?.isAutoBackfill &&
      more &&
      older.length > 0 &&
      shouldAutoBackfillTurns(secondaryTurns())
    ) {
      scheduleSecondaryBackfill(sessionId, key, loadSeqSnapshot);
    }
  } catch (error) {
    if (!options?.isAutoBackfill) throw error;
  } finally {
    secondaryEarlierInFlight = false;
  }
}

export async function loadSecondaryTurns(
  sessionId: string,
  options?: { silent?: boolean },
): Promise<TranscriptTurnView[] | null> {
  if (!splitPaneOpen() || secondarySessionId() !== sessionId) return null;
  const workspaceId = secondaryWorkspaceId() || activeWorkspaceId();
  if (!workspaceId) return null;
  const key = secondarySessionKey();
  if (!key) return null;
  const device = secondarySessionDevice();
  const seq = ++secondaryTurnsLoadSeq;
  let loaded: TranscriptTurnView[] | null = null;

  await runStep(
    async () => {
      const held = secondaryTurns();
      const useCursor =
        Boolean(secondaryTranscriptCursor && secondaryTranscriptCursor.sessionKey === key) &&
        secondarySessionKey() === key &&
        held.length > 0;
      const cursor = useCursor ? secondaryTranscriptCursor!.cursor : undefined;
      const limit = useCursor
        ? Math.max(TAIL_REFRESH_MIN_LIMIT, INITIAL_FAST_TURN_COUNT)
        : INITIAL_FAST_TURN_COUNT;
      let view: SessionTranscriptView | null = null;
      try {
        view = await invokeCommand<SessionTranscriptView>(
          "get_session_transcript_view",
          {
            session_id: sessionId,
            workspace_id: workspaceId,
            ...(limit ? { limit } : {}),
            ...(cursor ? { cursor } : { tool_detail: "summary" }),
          },
          secondaryRouteOptions(device),
        );
        if (seq !== secondaryTurnsLoadSeq || secondarySessionKey() !== key) return;
        if (view.mode === "after" && !held.some(turn => turn.turnIndex === view!.keptThroughIndex)) {
          const fallbackLimit = Math.min(Math.max(held.length, INITIAL_FAST_TURN_COUNT), 30);
          view = await invokeCommand<SessionTranscriptView>(
            "get_session_transcript_view",
            {
              session_id: sessionId,
              workspace_id: workspaceId,
              limit: fallbackLimit,
              tool_detail: "summary",
            },
            secondaryRouteOptions(device),
          );
        }
      } catch (error) {
        if (isCommandUnavailable(error, "get_session_transcript_view")) {
          if (seq === secondaryTurnsLoadSeq && secondarySessionKey() === key) {
            secondaryTranscriptCursor = null;
            secondaryTranscriptHasEarlier.set(false);
            secondaryTranscriptNotice.set(tr("sessions.transcriptHostOutdated"));
            secondaryTurns.set([]);
          }
          loaded = [];
          return;
        }
        throw error;
      } finally {
        if (seq === secondaryTurnsLoadSeq && secondarySessionKey() === key) {
          secondaryTurnsLoading.set(false);
        }
      }
      if (seq !== secondaryTurnsLoadSeq || secondarySessionKey() !== key || !view) return;
      const unchanged =
        view.mode === "after" &&
        view.turns.length === 0 &&
        held.length > 0 &&
        held.every(turn => turn.turnIndex <= (view!.keptThroughIndex ?? -1));
      const list = unchanged
        ? held
        : view.mode === "after"
          ? [...held.filter(turn => turn.turnIndex <= (view!.keptThroughIndex ?? -1)), ...view.turns]
          : Array.isArray(view.turns)
            ? view.turns
            : [];
      noteTranscriptSource(view.turns, { sessionId, workspaceId, deviceId: device });
      secondaryTranscriptCursor = view.cursor ? { sessionKey: key, cursor: view.cursor } : null;
      batch(() => {
        secondaryTranscriptNotice.set("");
        secondaryTurnsLoading.set(false);
        if (view!.mode === "full") {
          secondaryTranscriptHasEarlier.set(Boolean(view!.hasEarlier));
        }
        if (!unchanged) secondaryTurns.set(list);
        reconcileSecondaryPendingWithPersisted(sessionId, list, key);
        hydratePromptSuggestionFromTranscript(
          sessionId,
          view.runningTurn?.activeTurnId ? null : view.promptSuggestion,
          list[list.length - 1],
          device,
        );
      });
      if (view.runningTurn?.activeTurnId) {
        notifySecondaryRunningTurn(sessionId, device, view.runningTurn);
      }
      if (view.mode === "full" && view.hasEarlier && shouldAutoBackfillTurns(list)) {
        scheduleSecondaryBackfill(sessionId, key, seq);
      }
      loaded = list;
    },
    options?.silent ? { trackBusy: false, clearError: false } : undefined,
  );
  return loaded;
}

export async function loadSecondaryEarlierTurns(): Promise<void> {
  const sessionId = secondarySessionId();
  const key = secondarySessionKey();
  if (!sessionId || !key) return;
  cancelPendingSecondaryBackfill();
  await fetchSecondaryEarlierPage(sessionId, key, earlierPageSizeFor(secondaryTurns()), { isAutoBackfill: false });
}

export async function sendSecondaryTurn(
  text: string,
  sendDuringTurn?: "immediate" | "queue",
): Promise<SubmitUserMessageResult["outcome"] | null> {
  const sessionId = secondarySessionId();
  if (!sessionId) return null;
  const rawBody = text.trim();
  const outgoingImages = [...secondaryImageAttachments()];
  const outgoingFiles = [...secondaryFileAttachments()];
  const body = composeMessageWithFileAttachments(rawBody, outgoingFiles);
  if (!body && outgoingImages.length === 0) return null;

  const device = secondarySessionDevice();
  const workspaceId = secondaryWorkspaceId() || activeWorkspaceId() || undefined;
  const savedDraft = secondaryComposerText();
  const fromComposer = savedDraft === text;
  const attachments = buildAttachmentContexts(outgoingImages);
  const running = Boolean(secondaryRunningTurnId());

  const restoreDraft = () => {
    batch(() => {
      if (fromComposer && !secondaryComposerText().trim()) {
        secondaryComposerText.set(savedDraft);
      }
      if (outgoingImages.length > 0 && secondaryImageAttachments().length === 0) {
        secondaryImageAttachments.set(outgoingImages);
      }
      if (outgoingFiles.length > 0 && secondaryFileAttachments().length === 0) {
        secondaryFileAttachments.set(outgoingFiles);
      }
    });
  };

  batch(() => {
    secondaryTurnError.set("");
    secondarySendNotice.set("");
    clearPromptSuggestion(sessionId, device);
    if (fromComposer) secondaryComposerText.set("");
    clearSecondaryAttachments();
    if (!running) {
      setSecondaryPendingTurn(sessionId, body, undefined, outgoingImages);
    }
  });

  let outcome: SubmitUserMessageResult["outcome"] | null = null;
  await runStep(async () => {
    try {
      const result = await invokeCommand<SubmitUserMessageResult>(
        "submit_user_message",
        {
          sessionId,
          ...(workspaceId ? { workspaceId } : {}),
          text: body,
          agentType: agentTypeOf(sessionId),
          ...(attachments.length ? { attachments } : {}),
          ...(running && sendDuringTurn ? { sendDuringTurn } : {}),
        },
        secondaryRouteOptions(device),
      );
      outcome = result.outcome;
      if (result.outcome === "started") {
        bindSecondaryPendingTurnId(sessionId, result.turnId, body, outgoingImages);
      } else {
        if (!running) clearSecondaryPendingTurn(sessionId);
        if (result.outcome === "steered") await loadSecondaryTurns(sessionId, { silent: true });
      }
    } catch (error) {
      if (isCommandUnavailable(error, "submit_user_message")) {
        if (running) {
          restoreDraft();
          secondarySendNotice.set(tr("chat.send.hostUpdateRequired"));
          return;
        }
        try {
          await startDialogTurn({
            sessionId,
            userInput: body,
            agentType: agentTypeOf(sessionId),
            workspaceId: workspaceId ?? "",
            ...(attachments.length ? { imageContexts: attachments } : {}),
          });
          outcome = "started";
        } catch (legacyError) {
          clearSecondaryPendingTurn(sessionId);
          restoreDraft();
          secondaryTurnError.set(legacyError instanceof Error ? legacyError.message : String(legacyError));
        }
        return;
      }
      if (!running) clearSecondaryPendingTurn(sessionId);
      restoreDraft();
      secondaryTurnError.set(error instanceof Error ? error.message : String(error));
    }
  });
  return outcome;
}

export async function stopSecondaryTurn(): Promise<void> {
  const sessionId = secondarySessionId();
  const turnId = secondaryRunningTurnId();
  const key = secondarySessionKey();
  if (!sessionId || !turnId || !key) return;
  const device = secondarySessionDevice();

  await runStep(async () => {
    try {
      await invokeCommand<{ turnId: string; method: string }>(
        "stop_dialog_turn",
        { sessionId, dialogTurnId: turnId },
        secondaryRouteOptions(device),
      );
    } catch (error) {
      if (!isCommandUnavailable(error, "stop_dialog_turn")) throw error;
      try {
        await interruptDialogTurn(sessionId, turnId);
      } catch {
        await cancelDialogTurn(sessionId, turnId);
      }
    }
    clearQuestionsForSession(sessionId, device);
    clearPermissionsForSession(sessionId, device);
    runningTurns.update(current => {
      if (current[key] !== turnId) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    await loadSecondaryTurns(sessionId, { silent: true });
    const pending = secondaryPendingTurnState();
    if (!pending?.turnId || pending.turnId === turnId) {
      clearSecondaryPendingTurn(sessionId, key);
    }
  });
}

export async function createSecondarySession(
  workspaceId?: string | null,
  deviceId?: string | null,
  agentType?: string | null,
): Promise<void> {
  const targetWs = workspaceId || secondaryWorkspaceId() || activeWorkspaceId();
  if (!targetWs) return;
  const targetWsRoot =
    workspaces().find(item => item.id === targetWs)?.rootPath ||
    secondaryWorkspaceRoot() ||
    activeWorkspaceRoot();
  const device = fleetActive() ? (deviceId || secondarySessionDevice() || deviceContext()) : "";

  await runStep(async () => {
    const created = await createSession({
      sessionName: tr("nav.newSession"),
      agentType: agentType || chosenAgentType(),
      workspaceId: targetWs,
      ...(targetWsRoot ? { workspacePath: targetWsRoot } : {}),
    });
    await loadSessions();
    if (created?.sessionId) {
      selectSecondarySession(created.sessionId, device, targetWs);
    }
  });
}

// Wire the bridge so `state.ts` and `agentEvents.ts` can coordinate with Pane 1
// without circular module imports.
registerSecondaryPaneBridge({
  loadTurns: loadSecondaryTurns,
  clearIfMatches: predicate => {
    if (!splitPaneOpen()) return;
    if (predicate.sessionId && secondarySessionId() === predicate.sessionId) {
      clearSecondarySession();
    } else if (predicate.workspaceId && secondaryWorkspaceId() === predicate.workspaceId) {
      clearSecondarySession();
    }
  },
  getTurns: () => secondaryTurns(),
  getPendingTurn: () => secondaryPendingTurnState(),
  setPendingTurn: setSecondaryPendingTurn,
  bindPendingTurnId: bindSecondaryPendingTurnId,
  clearPendingTurn: clearSecondaryPendingTurn,
  setTurnError: message => secondaryTurnError.set(message),
});

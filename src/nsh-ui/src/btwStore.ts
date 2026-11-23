// Side questions ("by the way", wave 22 P5). `btw_ask_stream` runs a question
// as an ephemeral child of the open session on the device that runs it: the
// child reuses the parent's context, streams through the normal agentic events
// under the child session id this client names, and never enters the parent's
// transcript or sidebar. `btw_cancel` stops it. Closing the side-question split
// pane immediately releases all ephemeral state.

import { batch, signal } from "nsh";
import { fleetActive, invokeCommand, listenEvent } from "./bridge";
import { isMissingCommand } from "./settingsMutations";

export type SideQuestionState = "idle" | "running" | "done" | "failed" | "cancelled";

export interface SideQuestion {
  requestId: string;
  childSessionId: string;
  parentSessionId: string;
  deviceId: string;
  question: string;
  answer: string;
  state: SideQuestionState;
  error?: string;
}

export const sideQuestionOpen = signal(false);
export const sideQuestionDraft = signal("");
export const sideQuestion = signal<SideQuestion | null>(null);
/** Multi-turn ephemeral messages inside the active BTW side-question pane. */
export const sideQuestionHistory = signal<SideQuestion[]>([]);
/** Active ephemeral child session ID reused for follow-up turns in this side pane. */
export const sideQuestionChildId = signal<string | null>(null);
/** Parent session that spawned the current ephemeral side thread. */
export const sideQuestionParentId = signal<string | null>(null);
/** Set when the session's host predates `btw_ask_stream`. */
export const sideQuestionUnsupported = signal(false);

function newId(prefix: string): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof random === "function") return `${prefix}_${random()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

export function openSideQuestion(prefill = ""): void {
  sideQuestionUnsupported.set(false);
  if (prefill) sideQuestionDraft.set(prefill);
  sideQuestionOpen.set(true);
}

/** Starts a fresh ephemeral side-question thread while keeping the split pane open. */
export function resetSideQuestionThread(): void {
  const current = sideQuestion();
  if (current?.state === "running") void cancelSideQuestion();
  batch(() => {
    sideQuestion.set(null);
    sideQuestionHistory.set([]);
    sideQuestionChildId.set(null);
    sideQuestionParentId.set(null);
    sideQuestionDraft.set("");
    sideQuestionUnsupported.set(false);
  });
}

/** Closes the side-question pane, cancels any running turn, and releases ephemeral state. */
export function closeSideQuestion(): void {
  const current = sideQuestion();
  if (current?.state === "running") void cancelSideQuestion();
  batch(() => {
    sideQuestionOpen.set(false);
    sideQuestion.set(null);
    sideQuestionHistory.set([]);
    sideQuestionChildId.set(null);
    sideQuestionParentId.set(null);
    sideQuestionDraft.set("");
  });
}

function updateTurnEntry(requestId: string, updater: (entry: SideQuestion) => SideQuestion): void {
  batch(() => {
    const current = sideQuestion();
    if (current && current.requestId === requestId) {
      sideQuestion.set(updater(current));
    }
    sideQuestionHistory.update(list =>
      list.map(item => (item.requestId === requestId ? updater(item) : item)),
    );
  });
}

/** Asks `question` beside `sessionId`; follow-ups reuse the ephemeral child session. */
export async function askSideQuestion(
  target: { sessionId: string; deviceId: string; workspaceId?: string | null; workspacePath?: string | null },
  question: string,
): Promise<void> {
  const text = question.trim();
  if (!text || !target.sessionId) return;
  const previous = sideQuestion();
  if (previous?.state === "running") await cancelSideQuestion();

  // Reuse the ephemeral child session when continuing under the same parent session;
  // start a clean thread if the user switched parent sessions.
  const sameParent = sideQuestionParentId() === target.sessionId && Boolean(sideQuestionChildId());
  const childSessionId = sameParent ? sideQuestionChildId()! : newId("btw_session");

  const entry: SideQuestion = {
    requestId: newId("btw"),
    childSessionId,
    parentSessionId: target.sessionId,
    deviceId: target.deviceId,
    question: text,
    answer: "",
    state: "running",
  };

  batch(() => {
    sideQuestionOpen.set(true);
    sideQuestionParentId.set(target.sessionId);
    sideQuestionChildId.set(childSessionId);
    sideQuestion.set(entry);
    sideQuestionHistory.set(sameParent ? [...sideQuestionHistory(), entry] : [entry]);
    sideQuestionDraft.set("");
    sideQuestionUnsupported.set(false);
  });

  try {
    await invokeCommand<{ ok?: boolean }>(
      "btw_ask_stream",
      {
        requestId: entry.requestId,
        sessionId: entry.parentSessionId,
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
        ...(target.workspacePath ? { workspacePath: target.workspacePath } : {}),
        question: text,
        childSessionId: entry.childSessionId,
        childSessionName: oneLine(text),
      },
      fleetActive() && target.deviceId ? { target: target.deviceId } : undefined,
    );
  } catch (error) {
    if (sideQuestion()?.requestId !== entry.requestId) return;
    if (isMissingCommand(error, "btw_ask_stream")) sideQuestionUnsupported.set(true);
    const message = error instanceof Error ? error.message : String(error ?? "");
    updateTurnEntry(entry.requestId, item => ({
      ...item,
      state: "failed",
      error: message,
    }));
  }
}

export async function cancelSideQuestion(): Promise<void> {
  const current = sideQuestion();
  if (!current || current.state !== "running") return;
  updateTurnEntry(current.requestId, item => ({ ...item, state: "cancelled" }));
  try {
    await invokeCommand<unknown>(
      "btw_cancel",
      { requestId: current.requestId },
      fleetActive() && current.deviceId ? { target: current.deviceId } : undefined,
    );
  } catch {
    // The turn may already have ended on its device; the pane says it stopped either way.
  }
}

function matches(payload: unknown, origin: string): SideQuestion | null {
  const current = sideQuestion();
  if (!current || !payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const sessionId = record.sessionId ?? record.session_id;
  if (sessionId !== current.childSessionId) return null;
  if (fleetActive() && current.deviceId && origin && origin !== current.deviceId) return null;
  return current;
}

let subscribed = false;

/** Follows the child session's stream; other sessions' events are not this store's. */
export function subscribeSideQuestionEvents(): void {
  if (subscribed) return;
  subscribed = true;
  listenEvent<Record<string, unknown>>("agentic://text-chunk", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (!current || current.state !== "running") return;
    if (payload.contentType === "thinking") return;
    const chunk = payload.text ?? payload.delta ?? payload.content ?? payload.chunk;
    if (typeof chunk !== "string" || !chunk) return;
    updateTurnEntry(current.requestId, item => ({ ...item, answer: item.answer + chunk }));
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-completed", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (current && current.state === "running") {
      updateTurnEntry(current.requestId, item => ({ ...item, state: "done" }));
    }
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-failed", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (!current || current.state !== "running") return;
    const error = typeof payload.error === "string" ? payload.error : "";
    updateTurnEntry(current.requestId, item => ({
      ...item,
      state: "failed",
      ...(error ? { error } : {}),
    }));
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-cancelled", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (current && current.state === "running") {
      updateTurnEntry(current.requestId, item => ({ ...item, state: "cancelled" }));
    }
  });
}

/** Test seam. */
export function resetSideQuestion(): void {
  batch(() => {
    sideQuestion.set(null);
    sideQuestionHistory.set([]);
    sideQuestionChildId.set(null);
    sideQuestionParentId.set(null);
    sideQuestionDraft.set("");
    sideQuestionOpen.set(false);
    sideQuestionUnsupported.set(false);
  });
}

// Side questions ("by the way", wave 22 P5). `btw_ask_stream` runs a question
// as an ephemeral child of the open session on the device that runs it: the
// child reuses the parent's context, streams through the normal agentic events
// under the child session id this client names, and never enters the parent's
// transcript. `btw_cancel` stops it. The store only keeps what the stream says.

import { signal } from "nsh";
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

/** Closes the sheet; a question still running is cancelled on its device. */
export function closeSideQuestion(): void {
  const current = sideQuestion();
  if (current?.state === "running") void cancelSideQuestion();
  sideQuestionOpen.set(false);
}

/** Asks `question` beside `sessionId`; the answer streams into `sideQuestion`. */
export async function askSideQuestion(target: { sessionId: string; deviceId: string }, question: string): Promise<void> {
  const text = question.trim();
  if (!text || !target.sessionId) return;
  const previous = sideQuestion();
  if (previous?.state === "running") await cancelSideQuestion();
  const entry: SideQuestion = {
    requestId: newId("btw"),
    childSessionId: newId("btw_session"),
    parentSessionId: target.sessionId,
    deviceId: target.deviceId,
    question: text,
    answer: "",
    state: "running",
  };
  sideQuestion.set(entry);
  sideQuestionDraft.set("");
  sideQuestionUnsupported.set(false);
  try {
    await invokeCommand<{ ok?: boolean }>(
      "btw_ask_stream",
      {
        requestId: entry.requestId,
        sessionId: entry.parentSessionId,
        question: text,
        childSessionId: entry.childSessionId,
        childSessionName: oneLine(text),
      },
      fleetActive() && target.deviceId ? { target: target.deviceId } : undefined,
    );
  } catch (error) {
    if (sideQuestion()?.requestId !== entry.requestId) return;
    if (isMissingCommand(error, "btw_ask_stream")) sideQuestionUnsupported.set(true);
    sideQuestion.set({
      ...entry,
      state: "failed",
      error: error instanceof Error ? error.message : String(error ?? ""),
    });
  }
}

export async function cancelSideQuestion(): Promise<void> {
  const current = sideQuestion();
  if (!current || current.state !== "running") return;
  sideQuestion.set({ ...current, state: "cancelled" });
  try {
    await invokeCommand<unknown>(
      "btw_cancel",
      { requestId: current.requestId },
      fleetActive() && current.deviceId ? { target: current.deviceId } : undefined,
    );
  } catch {
    // The turn may already have ended on its device; the sheet says it stopped either way.
  }
}

function matches(payload: unknown, origin: string): SideQuestion | null {
  const current = sideQuestion();
  if (!current || !payload || typeof payload !== "object") return null;
  const sessionId = (payload as Record<string, unknown>).sessionId;
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
    sideQuestion.set({ ...current, answer: current.answer + chunk });
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-completed", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (current && current.state === "running") sideQuestion.set({ ...current, state: "done" });
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-failed", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (!current || current.state !== "running") return;
    const error = typeof payload.error === "string" ? payload.error : "";
    sideQuestion.set({ ...current, state: "failed", ...(error ? { error } : {}) });
  });
  listenEvent<Record<string, unknown>>("agentic://dialog-turn-cancelled", (payload, meta) => {
    const current = matches(payload, meta.origin);
    if (current && current.state === "running") sideQuestion.set({ ...current, state: "cancelled" });
  });
}

/** Test seam. */
export function resetSideQuestion(): void {
  sideQuestion.set(null);
  sideQuestionDraft.set("");
  sideQuestionOpen.set(false);
  sideQuestionUnsupported.set(false);
}

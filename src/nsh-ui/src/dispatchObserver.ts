// Observing one detached dispatch job.
//
// The target owns the job: it holds the transcript, the session, the worktree
// and the approval mailbox. This module is the controller half — it replays the
// target's event log from a cursor, folds it into a readable transcript, and
// forwards the four things a distant user can still do: answer a permission,
// steer the running turn, start the next turn, and bring the result back.
//
// The fold is a reduced projection of the desktop's flow-chat renderer: it keeps
// the shape a reader needs (state changes, assistant text, thinking, tool calls,
// failures) and drops the parts that only a full dialog-turn store can carry
// (per-round metrics, subagent nesting, image analysis, deep-review queues).
// Everything it drops is visible in Settings-free form here as raw state; the
// reduction is listed in docs/architecture/nsh-frontend.md.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { tr } from "./i18n";
import type { DispatchJob } from "./dispatchStore";
import { refreshDispatchJobs } from "./dispatchStore";

/** One rendered line of the observed transcript. */
export interface DispatchRow {
  id: string;
  kind: "state" | "assistant" | "thinking" | "tool" | "user" | "error";
  text: string;
}

/** One permission the target is waiting on, as `dispatch_status` reports it. */
export interface ObservedPermission {
  requestId: string;
  title: string;
  detail: string;
}

interface DispatchEventRecord {
  type?: string;
  timestamp?: string;
  state?: string;
  message?: string;
  reason?: string;
  frontendEventName?: string;
  frontendPayload?: Record<string, unknown>;
  event?: Record<string, unknown>;
  auditAction?: string;
  action?: string;
}

interface DispatchStatusReply {
  state?: string;
  cursor?: number;
  events?: DispatchEventRecord[];
  pendingPermissions?: Array<Record<string, unknown>>;
  cursorReset?: boolean;
  historyTruncated?: boolean;
  eventLogComplete?: boolean;
  omittedEventCount?: number;
  lastError?: string;
}

/** How often the observer asks the target for new events while a job runs. */
const POLL_INTERVAL_MS = 1800;

/** The job this surface is observing, or `null` when no job is open. */
export const observedJobId = signal<string | null>(null);
export const observedJobTitle = signal("");
export const observedState = signal("");
export const observedRows = signal<DispatchRow[]>([]);
export const observedPending = signal<ObservedPermission[]>([]);
export const observedNotice = signal("");
export const observedBusy = signal(false);
export const observedTruncated = signal(false);
/** The message the composer sends to the observed job. */
export const observedDraft = signal("");

/**
 * The cursor the next poll must ask from: the last one the target handed back
 * after this surface applied that page. The host reads "cursor" as "everything
 * up to here is applied", so an unapplied page must never advance it.
 */
let cursor = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let rowSequence = 0;

/** Tool lifecycle events worth a row; the rest are assembly noise. */
const TOOL_ROW_EVENTS = new Set([
  "Queued",
  "Waiting",
  "Started",
  "ConfirmationNeeded",
  "Confirmed",
  "Rejected",
  "Completed",
  "Failed",
  "Cancelled",
]);

function terminal(state: string): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function readString(record: Record<string, unknown> | undefined, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function clipped(value: string, limit = 240): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function nextRowId(): string {
  rowSequence += 1;
  return `row-${rowSequence}`;
}

/** Appends text to the tail row when it is the same kind, so chunks stream in place. */
/** Appends to `rows` in place (the page's own copy): a chunk of the same kind joins the last row. */
function appendText(rows: DispatchRow[], kind: DispatchRow["kind"], text: string): void {
  const tail = rows[rows.length - 1];
  if (tail && tail.kind === kind) {
    rows[rows.length - 1] = { ...tail, text: tail.text + text };
    return;
  }
  rows.push({ id: nextRowId(), kind, text });
}

/**
 * Reads the event name and payload the way the desktop renderer does: a
 * projected `frontendEventName` wins, otherwise the raw agent event type is
 * mapped onto its `agentic://` name.
 */
function projectedEvent(event: DispatchEventRecord): { name: string; payload: Record<string, unknown> } | null {
  if (typeof event.frontendEventName === "string" && event.frontendEventName) {
    return {
      name: event.frontendEventName,
      payload: (event.frontendPayload ?? {}) as Record<string, unknown>,
    };
  }
  const raw = event.event;
  if (!raw || typeof raw !== "object") return null;
  const type = typeof raw.type === "string" ? raw.type : "";
  switch (type) {
    case "TextChunk": {
      const text = typeof raw.text === "string" ? raw.text : "";
      return text ? { name: "agentic://text-chunk", payload: { text } } : null;
    }
    case "ThinkingChunk": {
      const text = typeof raw.content === "string" ? raw.content : "";
      return text ? { name: "agentic://text-chunk", payload: { text, contentType: "thinking" } } : null;
    }
    case "ToolEvent": {
      const data = raw.tool_event;
      return data && typeof data === "object"
        ? { name: "agentic://tool-event", payload: { toolEvent: data as Record<string, unknown> } }
        : null;
    }
    case "DialogTurnStarted":
      return { name: "agentic://dialog-turn-started", payload: {} };
    case "DialogTurnCompleted":
      return { name: "agentic://dialog-turn-completed", payload: {} };
    case "DialogTurnFailed":
      return { name: "agentic://dialog-turn-failed", payload: { error: raw.error } };
    case "DialogTurnCancelled":
      return { name: "agentic://dialog-turn-cancelled", payload: {} };
    default:
      return null;
  }
}

/** One tool event as a row, or `null` for the frames a reader does not need. */
function toolRow(payload: Record<string, unknown>): DispatchRow | null {
  const data = (payload.toolEvent ?? {}) as Record<string, unknown>;
  const kind = readString(data, ["event_type", "eventType"]);
  if (!TOOL_ROW_EVENTS.has(kind)) return null;
  const name =
    readString(data, ["effective_tool_name", "effectiveToolName", "tool_name", "toolName"]) || "tool";
  const detail = readString(data, ["result", "error", "message", "reason"]);
  return {
    id: nextRowId(),
    kind: "tool",
    text: detail ? `${name} · ${kind} · ${clipped(detail, 160)}` : `${name} · ${kind}`,
  };
}

/** Folds one page of target events into the transcript. */
function applyEvents(rows: DispatchRow[], events: DispatchEventRecord[]): DispatchRow[] {
  // One copy per page: rows already shown keep their objects, new ones are pushed.
  const next = rows.slice();
  for (const event of events) {
    if (event.type === "jobState") {
      const state = event.state ?? "";
      const message = event.message ? ` · ${clipped(event.message, 200)}` : "";
      next.push({ id: nextRowId(), kind: "state", text: `${state}${message}` });
      continue;
    }
    if (event.type === "permissionRejected") {
      next.push({
        id: nextRowId(),
        kind: "error",
        text: `Permission rejected${event.reason ? ` · ${clipped(event.reason, 180)}` : ""}`,
      });
      continue;
    }
    if (event.type !== "agentEvent") continue;
    const projected = projectedEvent(event);
    if (!projected) continue;
    const { name, payload } = projected;
    if (name === "agentic://text-chunk") {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text) continue;
      // Thinking chunks carry `contentType: "thinking"` from the desktop mapping.
      appendText(next, payload.contentType === "thinking" ? "thinking" : "assistant", text);
      continue;
    }
    if (name === "agentic://tool-event") {
      const row = toolRow(payload);
      if (row) next.push(row);
      continue;
    }
    if (name === "agentic://dialog-turn-failed") {
      const error = typeof payload.error === "string" ? clipped(payload.error, 200) : "";
      next.push({ id: nextRowId(), kind: "error", text: `Turn failed${error ? ` · ${error}` : ""}` });
      continue;
    }
    // `dialog-turn-started` and `dialog-turn-completed` only bound a turn; the
    // text chunks inside it already read as one block.
  }
  return next.length === rows.length && next.every((row, index) => row === rows[index]) ? rows : next;
}

function readPermissions(list: Array<Record<string, unknown>> | undefined): ObservedPermission[] {
  if (!Array.isArray(list)) return [];
  const result: ObservedPermission[] = [];
  for (const entry of list) {
    const requestId = readString(entry, ["requestId", "request_id", "id"]);
    if (!requestId) continue;
    // A `PermissionRequest` carries the tool action and the resources it wants;
    // the display metadata is where the engine puts a human-readable title.
    const action = readString(entry, ["action", "toolName", "tool_name"]);
    const metadata = (entry.displayMetadata ?? entry.display_metadata ?? {}) as Record<string, unknown>;
    const title = readString(metadata, ["title", "summary"]) || (action ? tr("devices.store.permissionAction", { action }) : tr("devices.store.permissionNeeded"));
    const resources = Array.isArray(entry.resources) ? entry.resources.filter(value => typeof value === "string") : [];
    const detail = resources.length > 0 ? clipped(resources.join(" · "), 200) : clipped(readString(metadata, ["description", "detail"]), 200);
    result.push({ requestId, title, detail: detail || requestId });
  }
  return result;
}

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function startPolling(): void {
  stopPolling();
  timer = setInterval(() => {
    const jobId = observedJobId();
    if (!jobId) {
      stopPolling();
      return;
    }
    void pollObservedJob();
  }, POLL_INTERVAL_MS);
}

/** Folds the page and advances the cursor only after it is on screen. */
function applyPage(jobId: string, page: DispatchStatusReply): void {
  if (observedJobId() !== jobId) return;
  if (page.lastError) observedNotice.set(clipped(page.lastError, 200));
  const state = page.state ?? "";
  if (state) observedState.set(state);
  if (typeof page.historyTruncated === "boolean") observedTruncated.set(page.historyTruncated);
  observedPending.set(readPermissions(page.pendingPermissions));
  const applied = applyEvents(observedRows(), Array.isArray(page.events) ? page.events : []);
  if (applied !== observedRows()) observedRows.set(applied);
  cursor = typeof page.cursor === "number" ? page.cursor : cursor;
  const empty = !Array.isArray(page.events) || page.events.length === 0;
  if (terminal(state) && empty) stopPolling();
}

/** Reads the next page of a job's event log. */
export async function pollObservedJob(): Promise<void> {
  const jobId = observedJobId();
  if (!jobId) return;
  if (observedBusy()) return;
  observedBusy.set(true);
  try {
    const page = await invokeCommand<DispatchStatusReply>("dispatch_status", { jobId, cursor });
    if (observedJobId() !== jobId) return;
    if (page.cursorReset) {
      // The target rewrote its log (rotation, or a job it re-created): the
      // transcript this surface holds no longer belongs to that cursor.
      observedRows.set([]);
      cursor = 0;
      observedNotice.set(tr("devices.store.eventLogRewritten"));
      return;
    }
    applyPage(jobId, page);
  } catch (error) {
    observedNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    observedBusy.set(false);
  }
}

/** Opens a job for observation and starts polling it. */
export async function openObservedJob(job: DispatchJob): Promise<void> {
  stopPolling();
  rowSequence = 0;
  cursor = 0;
  observedJobId.set(job.jobId);
  observedJobTitle.set(job.title || job.promptPreview || job.jobId);
  observedState.set(job.state);
  observedRows.set([]);
  observedPending.set([]);
  observedNotice.set("");
  observedTruncated.set(false);
  observedDraft.set("");
  await pollObservedJob();
  if (!terminal(observedState())) startPolling();
}

/** Closes the observed job and releases the poll. */
export function closeObservedJob(): void {
  stopPolling();
  observedJobId.set(null);
  observedJobTitle.set("");
  observedState.set("");
  observedRows.set([]);
  observedPending.set([]);
  observedNotice.set("");
  observedDraft.set("");
}

/** Answers one permission the target is waiting on. */
export async function answerObservedPermission(
  requestId: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  const jobId = observedJobId();
  if (!jobId) return;
  observedBusy.set(true);
  try {
    // `dispatch_answer` takes the reply kind as the protocol's snake_case value.
    await invokeCommand<unknown>("dispatch_answer", { jobId, requestId, reply });
    observedNotice.set(reply === "reject" ? "Rejected" : "Approved");
  } catch (error) {
    observedNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    observedBusy.set(false);
  }
  await pollObservedJob();
}

/** Mints the turn id the target needs before it owns the next turn. */
function mintTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sends the composer message: a steer while the turn runs, the next turn once
 * it has finished. `dispatch_append` and `dispatch_continue` are different
 * commands on the target, so the state decides which one the button means.
 */
export async function sendToObservedJob(): Promise<void> {
  const jobId = observedJobId();
  const text = observedDraft().trim();
  if (!jobId) return;
  if (!text) {
    observedNotice.set(tr("devices.store.messageNeedsText"));
    return;
  }
  const steering = observedState() === "running" || observedState() === "queued";
  observedBusy.set(true);
  try {
    if (steering) {
      const messageId = `message-${Date.now().toString(36)}`;
      await invokeCommand<unknown>("dispatch_append", { jobId, messageId, content: text });
    } else {
      await invokeCommand<unknown>("dispatch_continue", { jobId, turnId: mintTurnId(), prompt: text });
    }
    observedRows.set([...observedRows(), { id: nextRowId(), kind: "user", text }]);
    observedDraft.set("");
    observedNotice.set(steering ? tr("devices.store.sentToTurn") : tr("devices.store.nextTurnStarted"));
    if (steering && observedState() === "queued") observedState.set("running");
  } catch (error) {
    observedNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    observedBusy.set(false);
  }
  await pollObservedJob();
  if (!terminal(observedState())) startPolling();
}

/**
 * Brings a finished job's work back into this controller's baseline worktree.
 * The target commits and bundles its branch; the controller fast-forwards a
 * separate baseline checkout, never the user's own.
 */
export async function syncObservedResult(): Promise<void> {
  const jobId = observedJobId();
  if (!jobId) return;
  observedBusy.set(true);
  try {
    const result = await invokeCommand<Record<string, unknown>>("dispatch_sync_result", { jobId });
    const head = readString(result, ["headCommit", "syncedHeadCommit", "commit"]);
    observedNotice.set(head ? tr("devices.store.syncedHead", { head: head.slice(0, 12) }) : tr("devices.store.resultSynced"));
    await refreshDispatchJobs();
  } catch (error) {
    observedNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    observedBusy.set(false);
  }
}

/** Asks the target to stop the job. */
export async function cancelObservedJob(): Promise<void> {
  const jobId = observedJobId();
  if (!jobId) return;
  observedBusy.set(true);
  try {
    await invokeCommand<unknown>("dispatch_cancel", { jobId });
    observedNotice.set(tr("devices.dispatchCancelRequested"));
  } catch (error) {
    observedNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    observedBusy.set(false);
  }
  await pollObservedJob();
  await refreshDispatchJobs();
}

/** Whether the observed job has finished, so the panel can say so. */
export function observedJobFinished(): boolean {
  return terminal(observedState());
}

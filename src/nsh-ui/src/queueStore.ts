// Messages written while a turn is running, kept until they are sent.
//
// The desktop surface has two mid-turn policies: send immediately (live
// steering, which this composer does by default) and queue until the turn
// finishes. The queue itself belongs to the host: `manage_dialog_queue` takes a
// client-chosen turn id, reports the queue it holds (`list`), and drains it when
// the running turn settles, so a queued message survives a reload of this
// surface and keeps its place next to whatever another surface queued.
//
// A host that does not answer `manage_dialog_queue` (older build, or a fixture
// without it) gets a local list instead: same rows, same actions, but the drain
// is driven by this surface from the turn-completion event and the list is
// stored under `openbitfun.nsh.pending-queue.v1`.

import { Storage, signal } from "nsh";
import { invokeCommand } from "./bridge";
import { peerScope, peerSupports } from "./peerState";
import { queuedCounts } from "./sessionStatusStore";
import { activeSessionId, agentTypeOf, runningTurnId, sendTurn } from "./state";

export interface QueuedMessage {
  id: string;
  content: string;
  /** `steered` and friends come from the host queue; a local row is only queued. */
  status: string;
  /** Why the host is holding the row back (`blocked` and friends). */
  reason: string;
  source: "host" | "local";
}

interface HostQueueItem {
  turnId?: string;
  displayContent?: string;
  status?: string;
  reason?: string | null;
  previewTruncated?: boolean;
  attachmentCount?: number;
}

interface HostQueueSnapshot {
  sessionId?: string;
  queueEpoch?: string;
  revision?: number;
  items?: HostQueueItem[];
  /** Absent on hosts that predate reorder; support is never inferred from a version. */
  supportsReorder?: boolean;
  capacity?: number;
  used?: number;
}

const STORAGE_KEY = "openbitfun.nsh.pending-queue.v1";
/** The React queue caps itself at 20; an unbounded list is a memory leak with a UI. */
const MAX_QUEUE_DEPTH = 20;

export const queuedMessages = signal<QueuedMessage[]>([]);
export const queueNotice = signal("");
/** Why this surface, not the host, is holding the queue; empty when the host does. */
export const queueFallbackReason = signal("");
/** `null` until the host has been asked; `false` means this surface keeps the list. */
export const hostQueueAvailable = signal<boolean | null>(null);
/**
 * Whether the host can move a row inside its own queue. `null` means the last
 * snapshot did not say, which is what a host predating reorder answers.
 */
export const hostQueueReorderSupported = signal<boolean | null>(null);

let nextId = 1;
let hostEpoch = "";
let hostSessionId = "";
/** The revision the last snapshot was issued at; a reorder has to name it. */
let hostRevision = 0;

/** The queue for one session, oldest first. */
export function queueForSession(sessionId: string | null): QueuedMessage[] {
  if (!sessionId) return [];
  return queuedMessages().filter(item => item.id.startsWith(`${sessionId}\u0000`))
    .map(item => ({ ...item, id: item.id.slice(sessionId.length + 1) }));
}

function idFor(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`;
}

async function callQueue(sessionId: string, request: Record<string, unknown>): Promise<HostQueueSnapshot> {
  return invokeCommand<HostQueueSnapshot>("manage_dialog_queue", {
    sessionId,
    ...(hostEpoch ? { queueEpoch: hostEpoch } : {}),
    ...request,
  });
}

/** Rows the host still holds for the next turn; a started one has left the queue. */
const HELD_STATUSES = ["queued", "blocked", "steering_pending"];

function adoptSnapshot(sessionId: string, snapshot: HostQueueSnapshot): void {
  hostEpoch = snapshot.queueEpoch ?? hostEpoch;
  hostSessionId = sessionId;
  hostRevision = snapshot.revision ?? hostRevision;
  hostQueueReorderSupported.set(snapshot.supportsReorder ?? null);
  const others = queuedMessages().filter(item => !item.id.startsWith(`${sessionId}\u0000`));
  const rows: QueuedMessage[] = [];
  for (const item of snapshot.items ?? []) {
    const turnId = item.turnId;
    if (!turnId) continue;
    if (!HELD_STATUSES.includes(item.status ?? "queued")) continue;
    rows.push({
      id: idFor(sessionId, turnId),
      content: item.displayContent ?? "",
      status: item.status ?? "queued",
      reason: item.reason ?? "",
      source: "host",
    });
  }
  queuedMessages.set([...others, ...rows]);
  queuedCounts.update(current => ({ ...current, [sessionId]: rows.length }));
}

/**
 * Asks the host what it holds for a session. Falls back to the local list once.
 * `force` re-reads a session already known, which is how the rows follow a drain.
 */
export async function loadQueueForSession(sessionId: string | null, force = false): Promise<void> {
  if (!sessionId) return;
  if (!force && sessionId === hostSessionId) return;
  // A peer that did not advertise its dialog queue keeps messages here, and says
  // so, instead of holding a row the host will never start.
  if (peerScope() && peerSupports("dialog_queue_v1") === false) {
    hostQueueAvailable.set(false);
    awaitingLocalFallback(sessionId);
    queueFallbackReason.set(`${peerScope()?.label ?? "That device"} does not keep a queue; messages wait here`);
    return;
  }
  try {
    adoptSnapshot(sessionId, await callQueue(sessionId, { action: "list" }));
    hostQueueAvailable.set(true);
    queueFallbackReason.set("");
  } catch {
    // A host without the queue keeps its messages here instead, and says which
    // machine refused so the user knows where the message is waiting.
    hostQueueAvailable.set(false);
    awaitingLocalFallback(sessionId);
    if (peerScope()) {
      queueFallbackReason.set(`${peerScope()?.label ?? "That device"} does not keep a queue; messages wait here`);
    }
  }
}

function awaitingLocalFallback(sessionId: string): void {
  const kept = queuedMessages().filter(item => item.id.startsWith(`${sessionId}\u0000`));
  queuedMessages.set(kept.map(item => ({ ...item, source: "local" as const })));
  hostSessionId = sessionId;
}

export async function loadQueue(): Promise<void> {
  try {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    const restored: QueuedMessage[] = [];
    for (const entry of items) {
      const item = entry as { id?: unknown; sessionId?: unknown; content?: unknown };
      if (typeof item?.sessionId !== "string" || typeof item?.content !== "string") continue;
      if (!item.content.trim()) continue;
      const turnId = typeof item.id === "string" && item.id ? item.id : `restored-${nextId++}`;
      restored.push({
        id: idFor(item.sessionId, turnId),
        content: item.content,
        status: "queued",
        reason: "",
        source: "local",
      });
    }
    queuedMessages.set(restored.slice(-MAX_QUEUE_DEPTH));
  } catch {
    // A queue that cannot be read starts empty; nothing else depends on it.
  }
}

function persistLocal(): void {
  const rows = queuedMessages()
    .filter(item => item.source === "local")
    .map(item => {
      const [sessionId, turnId] = item.id.split("\u0000");
      return { id: turnId, sessionId, content: item.content };
    });
  void Storage.setItem(STORAGE_KEY, JSON.stringify(rows)).catch(() => {
    // Storage is a convenience here: a full store keeps the queue for this run.
  });
}

/**
 * Queues the composer's text for the selected session. The host keeps it when it
 * has a queue; otherwise it waits here and starts when the turn settles.
 */
export async function enqueueMessage(text: string): Promise<boolean> {
  const sessionId = activeSessionId();
  const content = text.trim();
  if (!sessionId || !content) return false;
  if (queueForSession(sessionId).length >= MAX_QUEUE_DEPTH) {
    queueNotice.set(`The queue holds ${MAX_QUEUE_DEPTH} messages; send or delete one first`);
    return false;
  }
  const turnId = `nsh-${Date.now().toString(36)}-${nextId++}`;
  if (hostQueueAvailable() !== false) {
    try {
      const snapshot = await callQueue(sessionId, {
        action: "submit",
        message: {
          turnId,
          content,
          displayContent: content,
          // The queued turn runs as the agent its session runs as.
          agentType: agentTypeOf(sessionId),
          attachments: [],
          metadata: {},
        },
      });
      adoptSnapshot(sessionId, snapshot);
      hostQueueAvailable.set(true);
      queueNotice.set("");
      return true;
    } catch {
      // Fall through: the host refused, so this surface holds the message.
      hostQueueAvailable.set(false);
    }
  }
  queuedMessages.update(current => [
    ...current,
    { id: idFor(sessionId, turnId), content, status: "queued", reason: "", source: "local" },
  ]);
  queueNotice.set("");
  persistLocal();
  return true;
}

export async function removeQueued(id: string): Promise<void> {
  const row = queuedMessages().find(item => item.id === id || item.id.endsWith(`\u0000${id}`));
  if (!row) return;
  const sessionId = activeSessionId();
  if (row.source === "host" && sessionId) {
    const turnId = row.id.slice(row.id.indexOf("\u0000") + 1);
    try {
      adoptSnapshot(sessionId, await callQueue(sessionId, {
        action: "cancel",
        turnId,
        operationId: `cancel-${nextId++}`,
      }));
      return;
    } catch {
      // The host kept it; leave the row in place rather than lying about it.
      queueNotice.set("The host did not cancel that message");
      return;
    }
  }
  queuedMessages.update(current => current.filter(item => item.id !== row.id));
  persistLocal();
}

/** Hands a queued message back to the composer and drops it from the queue. */
export async function takeQueued(id: string): Promise<string> {
  const row = queuedMessages().find(item => item.id === id || item.id.endsWith(`\u0000${id}`));
  if (!row) return "";
  await removeQueued(row.id);
  return row.content;
}

/**
 * Sends one queued message now: a host row is promoted, which the host turns into
 * steering when a turn is running, and a local row goes through the composer's
 * own route.
 */
export async function sendQueuedNow(id: string): Promise<void> {
  const row = queuedMessages().find(item => item.id === id || item.id.endsWith(`\u0000${id}`));
  if (!row) return;
  const sessionId = activeSessionId();
  if (row.source === "host" && sessionId) {
    const turnId = row.id.slice(row.id.indexOf("\u0000") + 1);
    try {
      adoptSnapshot(sessionId, await callQueue(sessionId, {
        action: "promote",
        turnId,
        operationId: `promote-${nextId++}`,
        expectedActiveTurnId: runningTurnId(),
      }));
    } catch {
      queueNotice.set("The host did not promote that message");
    }
    return;
  }
  await removeQueued(row.id);
  await sendTurn(row.content);
}

/**
 * Moves one queued message up or down the queue (`direction` of -1 or 1).
 *
 * A host row is moved by the host, because the queue that drains may not be this
 * surface's: the snapshot is read again first — support is negotiated from a fresh
 * reply, never remembered from an older one — and the reorder names the revision
 * that read was issued at, so a queue another surface changed in between is refused
 * instead of being overwritten. A local row is simply swapped in place.
 */
export async function moveQueued(id: string, direction: -1 | 1): Promise<void> {
  const row = queuedMessages().find(item => item.id === id || item.id.endsWith(`\u0000${id}`));
  if (!row) return;
  const sessionId = activeSessionId();
  if (!sessionId) return;
  if (row.source === "local") {
    moveLocal(row, direction);
    return;
  }
  const turnId = row.id.slice(row.id.indexOf("\u0000") + 1);
  let snapshot: HostQueueSnapshot;
  try {
    snapshot = await callQueue(sessionId, { action: "list" });
  } catch {
    queueNotice.set("The host did not answer its queue");
    return;
  }
  adoptSnapshot(sessionId, snapshot);
  if (hostQueueReorderSupported() !== true) {
    queueNotice.set("This host does not reorder its queue");
    return;
  }
  const turnIds = queueForSession(sessionId)
    .filter(item => item.source === "host")
    .map(item => item.id);
  const index = turnIds.indexOf(turnId);
  const target = index + direction;
  // A row that left the queue, or an end already reached, has nothing to move.
  if (index < 0 || target < 0 || target >= turnIds.length) return;
  // "Move before" the row on the far side of the destination, so the moved row
  // lands where the press asked for; the end of the list is `null`.
  const beforeTurnId = direction < 0 ? turnIds[index - 1] : (turnIds[index + 2] ?? null);
  try {
    adoptSnapshot(sessionId, await callQueue(sessionId, {
      action: "reorder",
      turnId,
      beforeTurnId,
      operationId: `reorder-${nextId++}`,
      expectedRevision: hostRevision,
    }));
    queueNotice.set("");
  } catch {
    queueNotice.set("The host did not reorder that message");
  }
}

/** Swaps one surface-held row with its neighbour, keeping the rest in place. */
function moveLocal(row: QueuedMessage, direction: -1 | 1): void {
  const sessionId = activeSessionId();
  if (!sessionId) return;
  const prefix = `${sessionId}\u0000`;
  const all = queuedMessages();
  const isLocal = (item: QueuedMessage): boolean => item.id.startsWith(prefix) && item.source === "local";
  const own = all.filter(isLocal);
  const index = own.findIndex(item => item.id === row.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= own.length) return;
  const swapped = own.slice();
  swapped[index] = own[target];
  swapped[target] = own[index];
  // Only this session's local slots are rewritten, so a host row of another
  // session keeps its position in the same signal.
  let cursor = 0;
  const next = all.map(item => (isLocal(item) ? swapped[cursor++] : item));
  queuedMessages.set(next);
  persistLocal();
}

/**
 * Starts a turn with the oldest locally queued message for a session that just
 * went idle. A host queue drains itself, so this only runs for the fallback list.
 */
export async function drainQueue(sessionId: string): Promise<void> {
  if (sessionId !== activeSessionId()) return;
  const head = queueForSession(sessionId).find(item => item.source === "local");
  if (!head) return;
  await removeQueued(head.id);
  await sendTurn(head.content);
}

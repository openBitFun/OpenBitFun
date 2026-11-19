// What each session row states about itself.
//
// The desktop list marks a row that is running, waiting for approval, holding a
// queued message, or has something the user has not read yet. This surface knows
// the same facts from its own events: the turn events name their session, the
// permission prompts carry the session they block, and the queue is asked per
// session. The mark is derived, never stored per session on the host.

import { Storage, computed, signal } from "nsh";
import { pendingPermissions } from "./permissionStore";
import { runningTurns } from "./state";

export type SessionStatusKind = "running" | "approval" | "queued" | "unread" | "failed";

export interface SessionStatusMark {
  kind: SessionStatusKind;
  label: string;
}

/** Session id → the last message timestamp the user has already looked at. */
export const seenAt = signal<Record<string, number>>({});
/** Session id → the timestamp of the newest turn that failed in this run. */
export const failedAt = signal<Record<string, number>>({});
/** Sessions the host queue reported rows for, keyed by session id, with their count. */
export const queuedCounts = signal<Record<string, number>>({});

const STORAGE_KEY = "openbitfun.nsh.session-seen.v1";

export async function loadSeenSessions(): Promise<void> {
  try {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const restored: Record<string, number> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) restored[sessionId] = value;
    }
    seenAt.set(restored);
  } catch {
    // An unreadable record only means every row starts unread; nothing breaks.
  }
}

function persistSeen(): void {
  void Storage.setItem(STORAGE_KEY, JSON.stringify(seenAt())).catch(() => {
    // Without storage the marks work for this run and no other.
  });
}

/**
 * Records that the user is looking at a session now. Accepts either Rust
 * `lastActiveAt` or legacy `lastUpdated`, so a turn that finishes later shows
 * up as unread.
 */
export function markSessionSeen(sessionId: string, lastActivityMs?: number): void {
  const stamp = typeof lastActivityMs === "number" && Number.isFinite(lastActivityMs) ? lastActivityMs : Date.now();
  if ((seenAt()[sessionId] ?? 0) >= stamp) return;
  seenAt.update(current => ({ ...current, [sessionId]: stamp }));
  failedAt.update(current => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
  persistSeen();
}

export function markSessionFailed(sessionId: string): void {
  failedAt.update(current => ({ ...current, [sessionId]: Date.now() }));
}

/** The mark one row shows, in the order the desktop lists its own states. */
export const statusOfSession = computed<(sessionId: string, lastActivityMs?: number, messageCount?: number) => SessionStatusMark | null>(
  () => {
    // Reading these keeps the derived function live when any of them changes.
    const running = runningTurns();
    const approvals = pendingPermissions();
    const queued = queuedCounts();
    const failed = failedAt();
    const seen = seenAt();
    return (sessionId, lastActivityMs, messageCount) => {
      if (running[sessionId]) return { kind: "running", label: "Running" };
      if (approvals.some(request => request.sessionId === sessionId)) {
        return { kind: "approval", label: "Waiting for approval" };
      }
      if ((queued[sessionId] ?? 0) > 0) return { kind: "queued", label: "Queued" };
      if (failed[sessionId]) return { kind: "failed", label: "Last turn failed" };
      const newest = typeof lastActivityMs === "number" && Number.isFinite(lastActivityMs) ? lastActivityMs : 0;
      // A session never opened in this surface counts as unread once it has
      // messages; one opened before its newest turn does too.
      if ((messageCount ?? 0) > 0 && newest > (seen[sessionId] ?? 0)) {
        return { kind: "unread", label: "Not read yet" };
      }
      return null;
    };
  },
);

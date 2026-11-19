// What each session row states about itself.
//
// The desktop list marks a row that is running, waiting for approval, holding a
// queued message, or has something the user has not read yet. Running, approval
// and queued come from live events and the host queue. Unread and failed are the
// host's: it records an unread receipt when a turn settles and every client reads
// it from the session page (`unread` / `failed`), so two clients mark the same
// rows. Opening a session acknowledges that receipt on the host
// (`mark_session_seen`); nothing about it is kept in this surface's storage.
//
// Upgrade: earlier builds kept "seen" stamps under `openbitfun.nsh.session-seen.v1`.
// They are sent to the host once, per session, the first time a session list
// names that session (the host needs the row's workspace), then forgotten.

import { tr } from "./i18n";
import { Storage, computed, signal } from "nsh";
import { markSessionSeenOnHost, type SessionSummary } from "./api";
import { pendingPermissions } from "./permissionStore";
import { activeSessionId, runningTurns, sessions } from "./state";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";

export type SessionStatusKind = "running" | "approval" | "queued" | "unread" | "failed";

export interface SessionStatusMark {
  kind: SessionStatusKind;
  label: string;
}

/**
 * Session id → when this surface acknowledged the session on the host. A row the
 * list still reports as unread is read once its newest activity is not newer than
 * this, which covers a list read that raced the acknowledgement.
 */
export const acknowledgedAt = signal<Record<string, number>>({});
/** Session id → a failure a live turn event reported before the next list read. */
export const failedAt = signal<Record<string, number>>({});
/** Sessions the host queue reported rows for, keyed by session id, with their count. */
export const queuedCounts = signal<Record<string, number>>({});
/** Set when the host has no `mark_session_seen`, so reads are not acknowledged anywhere. */
export const seenUnsupported = signal(false);

const LEGACY_STORAGE_KEY = "openbitfun.nsh.session-seen.v1";
/** Legacy stamps still to hand to the host, by session id. */
let legacyMarks: Record<string, number> = {};

/** Reads the stamps an earlier build stored, so they can be migrated to the host. */
export async function loadSeenSessions(): Promise<void> {
  try {
    const raw = await Storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const restored: Record<string, number> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) restored[sessionId] = value;
    }
    legacyMarks = restored;
    migrateLegacyMarks(sessions());
  } catch {
    // An unreadable record migrates nothing; the host's own receipts still show.
  }
}

function persistLegacyMarks(): void {
  const remaining = Object.keys(legacyMarks).length;
  const write = remaining ? Storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyMarks)) : Storage.removeItem(LEGACY_STORAGE_KEY);
  void Promise.resolve(write).catch(() => {
    // The marks are sent again next run; the host acknowledgement is idempotent.
  });
}

/** Sends the legacy stamps of the sessions a list just named, once each. */
function migrateLegacyMarks(rows: ReadonlyArray<SessionSummary>): void {
  if (seenUnsupported()) return;
  for (const row of rows) {
    const stamp = legacyMarks[row.sessionId];
    if (stamp === undefined) continue;
    delete legacyMarks[row.sessionId];
    void markSessionSeenOnHost({
      sessionId: row.sessionId,
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      seenThroughMs: Math.floor(stamp),
    })
      .then(() => persistLegacyMarks())
      .catch(error => {
        if (isMissingCommand(error, "mark_session_seen")) {
          // An older host keeps the stamps for the build that can take them.
          legacyMarks[row.sessionId] = stamp;
          seenUnsupported.set(true);
        }
      });
  }
}

/**
 * Called after every session list read: migrates legacy stamps for the rows it
 * names, and acknowledges the session the user is looking at, whose result the
 * host may have recorded as unread while it was on screen.
 */
export function reconcileSessionReadState(rows: ReadonlyArray<SessionSummary>): void {
  if (Object.keys(legacyMarks).length) migrateLegacyMarks(rows);
  const open = activeSessionId();
  const row = open ? rows.find(item => item.sessionId === open) : undefined;
  if (row && (row.unread || row.failed) && !isAcknowledged(row, acknowledgedAt())) {
    markSessionSeen(row.sessionId);
  }
}

function isAcknowledged(row: SessionSummary, acknowledged: Record<string, number>): boolean {
  const at = acknowledged[row.sessionId];
  if (at === undefined) return false;
  const newest = row.lastActiveAt ?? row.lastUpdated ?? 0;
  return newest <= at;
}

/**
 * Acknowledges a session on the host for every client. The row is drawn as read
 * right away; the next list read carries the host's own answer.
 */
export function markSessionSeen(sessionId: string, _lastActivityMs?: number): void {
  const now = Date.now();
  acknowledgedAt.update(current => ({ ...current, [sessionId]: now }));
  failedAt.update(current => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
  if (seenUnsupported()) return;
  const workspaceId = sessions().find(row => row.sessionId === sessionId)?.workspaceId;
  void markSessionSeenOnHost({ sessionId, ...(workspaceId ? { workspaceId } : {}) }).catch(error => {
    if (isMissingCommand(error, "mark_session_seen")) seenUnsupported.set(true);
  });
}

/** A failure a live turn event reported, shown until the next list read says so too. */
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
    const acknowledged = acknowledgedAt();
    const rows = sessions();
    return sessionId => {
      if (running[sessionId]) return { kind: "running", label: tr("chat.status.running") };
      if (approvals.some(request => request.sessionId === sessionId)) {
        return { kind: "approval", label: tr("chat.status.approval") };
      }
      if ((queued[sessionId] ?? 0) > 0) return { kind: "queued", label: tr("chat.status.queued") };
      if (failed[sessionId]) return { kind: "failed", label: tr("chat.status.failed") };
      const row = rows.find(item => item.sessionId === sessionId);
      if (!row || isAcknowledged(row, acknowledged)) return null;
      if (row.failed) return { kind: "failed", label: tr("chat.status.failed") };
      if (row.unread) return { kind: "unread", label: tr("chat.status.unread") };
      return null;
    };
  },
);

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
import { fleetActive } from "./bridge";
import { fleetDevices } from "./fleetStore";
import { pendingPermissions } from "./permissionStore";
import { activeSessionDevice, activeSessionId, deviceContext, runningTurns, sessionKey, sessions } from "./state";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";

export type SessionStatusKind = "running" | "approval" | "queued" | "unread" | "failed";

export interface SessionStatusMark {
  kind: SessionStatusKind;
  label: string;
}

/**
 * `sessionKey` → when this surface acknowledged the session on the host. A row the
 * list still reports as unread is read once its newest activity is not newer than
 * this, which covers a list read that raced the acknowledgement.
 */
export const acknowledgedAt = signal<Record<string, number>>({});
/** `sessionKey` → a failure a live turn event reported before the next list read. */
export const failedAt = signal<Record<string, number>>({});
/** Sessions the host queue reported rows for, keyed by `sessionKey` or bare session id, with their count. */
export const queuedCounts = signal<Record<string, number>>({});
/** Per-device `mark_session_seen` unsupported flags (`deviceId` → `true`). */
const seenUnsupportedByDevice = signal<Record<string, boolean>>({});
/** Set when the current device context has no `mark_session_seen`. */
export const seenUnsupported = signal(false);

function isSeenUnsupported(deviceId: string = deviceContext()): boolean {
  const key = fleetActive() ? deviceId : "";
  return Boolean(seenUnsupportedByDevice()[key]) || (!fleetActive() && seenUnsupported());
}

function markSeenUnsupported(deviceId: string = deviceContext()): void {
  const key = fleetActive() ? deviceId : "";
  seenUnsupportedByDevice.update(current => (current[key] ? current : { ...current, [key]: true }));
  if (key === (fleetActive() ? deviceContext() : "")) seenUnsupported.set(true);
}

/** O(1) index of fleet session id → owning device id (rebuilt only when `fleetDevices()` changes). */
const fleetOwnerBySession = computed<Map<string, string>>(() => {
  const index = new Map<string, string>();
  if (!fleetActive()) return index;
  for (const device of fleetDevices()) {
    for (const workspace of device.workspaces) {
      for (const session of workspace.sessions) {
        index.set(session.sessionId, device.deviceId);
      }
    }
  }
  return index;
});

function resolveDeviceOf(sessionId: string, deviceId?: string): string {
  if (!fleetActive()) return "";
  if (deviceId !== undefined) return deviceId;
  if (sessionId === activeSessionId() && activeSessionDevice()) return activeSessionDevice();
  return fleetOwnerBySession().get(sessionId) ?? deviceContext();
}

function statusKeyOf(sessionId: string, deviceId?: string): string {
  return `${resolveDeviceOf(sessionId, deviceId)}/${sessionId}`;
}

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
  for (const row of rows) {
    const device = resolveDeviceOf(row.sessionId, row.deviceId);
    if (isSeenUnsupported(device)) continue;
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
          markSeenUnsupported(device);
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
  const openDevice = activeSessionDevice();
  const row = open
    ? rows.find(item => item.sessionId === open && (!fleetActive() || !item.deviceId || item.deviceId === openDevice))
    : undefined;
  if (row && (row.unread || row.failed) && !isAcknowledged(row, acknowledgedAt(), resolveDeviceOf(row.sessionId, row.deviceId))) {
    markSessionSeen(row.sessionId, undefined, row.deviceId);
  }
}

function isAcknowledged(row: SessionSummary, acknowledged: Record<string, number>, deviceId?: string): boolean {
  const key = statusKeyOf(row.sessionId, deviceId ?? row.deviceId);
  const at = acknowledged[key] ?? (!fleetActive() ? acknowledged[row.sessionId] : undefined);
  if (at === undefined) return false;
  const newest = row.lastActiveAt ?? row.lastUpdated ?? 0;
  return newest <= at;
}

/**
 * Acknowledges a session on the host for every client. The row is drawn as read
 * right away; the next list read carries the host's own answer.
 */
export function markSessionSeen(sessionId: string, _lastActivityMs?: number, deviceId?: string): void {
  const device = resolveDeviceOf(sessionId, deviceId);
  const key = `${device}/${sessionId}`;
  const now = Date.now();
  acknowledgedAt.update(current => ({ ...current, [key]: now }));
  failedAt.update(current => {
    if (!(key in current) && !(sessionId in current)) return current;
    const next = { ...current };
    delete next[key];
    if (!fleetActive()) delete next[sessionId];
    return next;
  });
  if (isSeenUnsupported(device)) return;
  const workspaceId = sessions().find(
    row => row.sessionId === sessionId && (!fleetActive() || !row.deviceId || row.deviceId === device),
  )?.workspaceId;
  void markSessionSeenOnHost({ sessionId, ...(workspaceId ? { workspaceId } : {}) }).catch(error => {
    if (isMissingCommand(error, "mark_session_seen")) markSeenUnsupported(device);
  });
}

/** A failure a live turn event reported, shown until the next list read says so too. */
export function markSessionFailed(sessionId: string, deviceId?: string): void {
  const key = statusKeyOf(sessionId, deviceId);
  failedAt.update(current => ({ ...current, [key]: Date.now() }));
}

/** O(1) index of sessions waiting for approval (`"<deviceId>/<sessionId>"`). */
const approvalSessionKeys = computed<Set<string>>(() => {
  const keys = new Set<string>();
  for (const request of pendingPermissions()) {
    if (!request.sessionId) continue;
    keys.add(`${fleetActive() ? request.deviceId : ""}/${request.sessionId}`);
  }
  return keys;
});

/** O(1) index of the active workspace's session rows by `"<deviceId>/<sessionId>"`, cached by array identity to avoid a module-init cycle with `state.ts`. */
let cachedRowsRef: ReadonlyArray<SessionSummary> | null = null;
let cachedRowsCtx = "";
let cachedRowsActive = false;
let cachedRowsMap = new Map<string, SessionSummary>();

function getSessionRowsByKey(
  rows: ReadonlyArray<SessionSummary>,
  active: boolean,
  ctx: string,
): Map<string, SessionSummary> {
  if (rows === cachedRowsRef && active === cachedRowsActive && ctx === cachedRowsCtx) {
    return cachedRowsMap;
  }
  const map = new Map<string, SessionSummary>();
  for (const row of rows) {
    const device = active ? (row.deviceId ?? ctx) : "";
    map.set(`${device}/${row.sessionId}`, row);
  }
  cachedRowsRef = rows;
  cachedRowsActive = active;
  cachedRowsCtx = ctx;
  cachedRowsMap = map;
  return map;
}

type StatusOfSessionFn = (
  sessionId: string,
  lastActivityMs?: number,
  messageCount?: number,
  deviceId?: string,
) => SessionStatusMark | null;

let statusOfSessionComputed: ReturnType<typeof computed<StatusOfSessionFn>> | null = null;

/**
 * The mark one row shows, matching backend fleet roll-up priority:
 * approval (`needs_you`) ranks above `running`, then queued, failed, unread.
 * Lazily initializes its `computed` on first read to avoid module-init cycles with `state.ts`.
 */
export function statusOfSession(): StatusOfSessionFn {
  if (!statusOfSessionComputed) {
    statusOfSessionComputed = computed<StatusOfSessionFn>(() => {
      // Reading these keeps the derived function live when any of them changes.
      const running = runningTurns();
      const approvals = approvalSessionKeys();
      const queued = queuedCounts();
      const failed = failedAt();
      const acknowledged = acknowledgedAt();
      const owners = fleetOwnerBySession();
      const active = fleetActive();
      const ctx = active ? deviceContext() : "";
      const rowsByKey = getSessionRowsByKey(sessions(), active, ctx);
      const openId = activeSessionId();
      const openDevice = activeSessionDevice();

      return (sessionId, _lastActivityMs, _messageCount, deviceId) => {
        const device = !active
          ? ""
          : deviceId !== undefined
            ? deviceId
            : sessionId === openId && openDevice
              ? openDevice
              : (owners.get(sessionId) ?? ctx);
        const key = `${device}/${sessionId}`;

        if (approvals.has(key)) return { kind: "approval", label: tr("chat.status.approval") };
        if (running[key] || (!active && running[sessionKey(sessionId, "")])) {
          return { kind: "running", label: tr("chat.status.running") };
        }
        const queuedCount = queued[key] ?? (!active || device === ctx ? queued[sessionId] : 0) ?? 0;
        if (queuedCount > 0) return { kind: "queued", label: tr("chat.status.queued") };
        if (failed[key] || (!active && failed[sessionId])) return { kind: "failed", label: tr("chat.status.failed") };
        const row = rowsByKey.get(key);
        if (!row || isAcknowledged(row, acknowledged, device)) return null;
        if (row.failed) return { kind: "failed", label: tr("chat.status.failed") };
        if (row.unread) return { kind: "unread", label: tr("chat.status.unread") };
        return null;
      };
    });
  }
  return statusOfSessionComputed();
}

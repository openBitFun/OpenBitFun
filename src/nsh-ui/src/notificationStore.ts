// In-app notification history, the tray's unread count, and the OS
// notifications the desktop sends while its window is in the background.
//
// The rules follow the React surface (`useDialogCompletionNotify`,
// `usePermissionRequestNotify`): a finished or failed turn of a session this
// surface lists, and an approval request, become one history row each; an OS
// notification goes out only while the window has no focus and the matching
// `app.notifications.*` switch is not off. `send_system_notification` is proxied
// in Peer Device Mode, so while another device is driven the notification would
// pop up on that device instead of here: the row is kept, the OS notification is
// not sent.

import { computed, effect, signal } from "nsh";
import { getConfig } from "./api";
import { isWindowFocused, listenEvent, nativeWindow, setTrayUnreadCount, showSystemNotification } from "./bridge";
import { tr } from "./i18n";
import { pendingPermissions } from "./permissionStore";
import { activeScene, activeSessionId, secondarySessionId, sessions, splitPaneOpen } from "./state";

export type NotificationKind = "permission" | "turn-completed" | "turn-failed";

export interface ShellNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  sessionId?: string;
  createdAt: number;
  read: boolean;
}

const HISTORY_LIMIT = 50;

export const notifications = signal<ShellNotification[]>([]);
export const unreadNotificationCount = computed(
  () => notifications().filter(item => !item.read).length,
);

let started = false;
let seq = 0;
const deliveredTurns = new Map<string, string>();
const seenPermissionIds = new Set<string>();

function addNotification(entry: Omit<ShellNotification, "id" | "createdAt" | "read">): void {
  seq += 1;
  const row: ShellNotification = { ...entry, id: `notification-${seq}`, createdAt: Date.now(), read: false };
  notifications.update(list => [row, ...list].slice(0, HISTORY_LIMIT));
}

/**
 * Sessions whose last turn ended while nobody was looking at them, as the
 * desktop's tray counts them (`trayUnreadService`): one per session, not per turn.
 */
export const unreadCompletionCount = computed(() => {
  const ids = new Set<string>();
  for (const item of notifications()) {
    if (!item.read && item.sessionId && item.kind !== "permission") ids.add(item.sessionId);
  }
  return ids.size;
});

function markSessionNotificationsRead(sessionId: string): void {
  if (!notifications().some(item => !item.read && item.sessionId === sessionId)) return;
  notifications.update(list =>
    list.map(item => (item.read || item.sessionId !== sessionId ? item : { ...item, read: true })),
  );
}

export function markAllNotificationsRead(): void {
  if (!notifications().some(item => !item.read)) return;
  notifications.update(list => list.map(item => (item.read ? item : { ...item, read: true })));
}

export function clearNotifications(): void {
  notifications.set([]);
}

async function switchEnabled(path: string): Promise<boolean> {
  try {
    const value = await getConfig(path, true);
    return value !== false;
  } catch {
    // A host that stores no switch uses its default, which is on.
    return true;
  }
}

async function sendSystemNotification(path: string, title: string, body: string): Promise<void> {
  if (await isWindowFocused()) return;
  if (!(await switchEnabled(path))) return;
  try {
    // The shell owns OS notifications: the desktop's command in the Tauri window,
    // `Notifications` in a native NSH window.
    await showSystemNotification(title, body);
  } catch (error) {
    console.warn("Failed to send system notification", error);
  }
}

interface TurnEndPayload {
  sessionId?: string;
  session_id?: string;
  turnId?: string;
  turn_id?: string;
}

function onTurnEnded(payload: TurnEndPayload | null | undefined, failed: boolean): void {
  const sessionId = payload?.sessionId ?? payload?.session_id ?? "";
  if (!sessionId) return;
  // Subagent and side sessions are not listed; their parents report the result.
  const session = sessions().find(item => item.sessionId === sessionId);
  if (!session) return;
  // A turn the user watched end in either visible session pane is not news.
  const watching =
    activeScene() === "sessions" &&
    (activeSessionId() === sessionId || (splitPaneOpen() && secondarySessionId() === sessionId));
  const turnId = payload?.turnId ?? payload?.turn_id ?? "";
  const receipt = `${turnId}:${failed ? "failed" : "completed"}`;
  if (deliveredTurns.get(sessionId) === receipt) return;
  deliveredTurns.set(sessionId, receipt);
  const sessionTitle = session.sessionName?.trim() ?? "";
  const title = failed ? tr("shell.notify.turnFailedTitle") : tr("shell.notify.turnDoneTitle");
  const body = sessionTitle
    ? tr(failed ? "shell.notify.turnFailedWithSession" : "shell.notify.turnDoneWithSession", {
        sessionTitle,
      })
    : tr(failed ? "shell.notify.turnFailedFallback" : "shell.notify.turnDoneFallback");
  addNotification({ kind: failed ? "turn-failed" : "turn-completed", title, body, sessionId });
  if (watching) markSessionNotificationsRead(sessionId);
  void sendSystemNotification("app.notifications.dialog_completion_notify", title, body);
}

/**
 * An approval raised while the focused window shows the session scene is answered
 * on screen; anything else is recorded and, in the background, announced.
 */
async function recordPermissionRequests(sessionIds: string[]): Promise<void> {
  const focused = await isWindowFocused();
  // In the focused window the session scene shows every pending approval itself.
  const unseen = focused && activeScene() === "sessions" ? [] : sessionIds;
  if (unseen.length === 0) return;
  const title = tr("shell.notify.permissionTitle");
  const body =
    unseen.length === 1
      ? tr("shell.notify.permissionBody")
      : tr("shell.notify.permissionBatchBody", { count: unseen.length });
  addNotification({ kind: "permission", title, body, sessionId: unseen[0] });
  if (!focused) void sendSystemNotification("app.notifications.permission_request_notify", title, body);
}

/** Starts the listeners once; the tray count follows the unread rows. */
export function startNotifications(): void {
  if (started) return;
  started = true;
  listenEvent<TurnEndPayload>("agentic://dialog-turn-completed", payload => onTurnEnded(payload, false));
  listenEvent<TurnEndPayload>("agentic://dialog-turn-failed", payload => onTurnEnded(payload, true));

  effect(() => {
    const fresh = pendingPermissions().filter(item => !seenPermissionIds.has(item.requestId));
    if (fresh.length === 0) return;
    for (const item of fresh) seenPermissionIds.add(item.requestId);
    void recordPermissionRequests(fresh.map(item => item.sessionId));
  });

  // Opening a session in either pane reads its results.
  effect(() => {
    const sessionId = activeSessionId();
    if (sessionId && activeScene() === "sessions") markSessionNotificationsRead(sessionId);
    const secondaryId = splitPaneOpen() ? secondarySessionId() : null;
    if (secondaryId && activeScene() === "sessions") markSessionNotificationsRead(secondaryId);
  });

  let lastTrayCount = -1;
  effect(() => {
    const count = unreadCompletionCount();
    if (!nativeWindow() || count === lastTrayCount) return;
    lastTrayCount = count;
    // The tray is this machine's even while a peer is driven (controller local).
    void setTrayUnreadCount(count).catch(error => {
      lastTrayCount = -1;
      console.warn("Failed to update tray unread count", error);
    });
  });
}

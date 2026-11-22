// The Inbox on a backend without the fleet layer (an older backend, or a
// desktop that is not a fleet entry). There is no `fleet_attention` there, so
// the Inbox shows what this window already knows, the same facts the old
// notification bell listed: approvals waiting in this backend's sessions
// (answerable in place, through `permissionStore`), and the turns that
// finished or stopped while nobody was watching (`notificationStore`'s
// history, newest first, as it was recorded). On a fleet entry the backend's
// groups win and nothing here is drawn.

import { computed } from "nsh";
import { attentionGroups, inboxBadge, markAllAttentionRead, type AttentionEntry, type AttentionGroup } from "./attentionStore";
import { fleetActive } from "./bridge";
import type { FleetPrompt } from "./fleetTypes";
import { tr } from "./i18n";
import {
  clearNotifications,
  markAllNotificationsRead,
  notifications,
  unreadNotificationCount,
} from "./notificationStore";
import { pendingPermissions, type PermissionRequestView } from "./permissionStore";
import { activeWorkspaceId, sessions } from "./state";
import { questionPrompts, type QuestionPrompt } from "./userQuestionStore";

/** Whether the Inbox draws this window's own history (no fleet layer). */
export const inboxIsLocal = computed<boolean>(() => !fleetActive());

function sessionTitle(sessionId: string): string {
  return sessions().find(row => row.sessionId === sessionId)?.sessionName?.trim() ?? "";
}

/** A pending request as the prompt the attention atoms draw; `permissionStore` keeps the request. */
export function localPermissionPrompt(request: PermissionRequestView): FleetPrompt {
  return {
    deviceId: request.deviceId,
    workspaceId: activeWorkspaceId() ?? "",
    sessionId: request.sessionId,
    kind: "permission",
    promptId: request.requestId,
    revision: 0,
    title: request.action,
    payload: { action: request.action, resources: request.resources },
    payloadTruncated: false,
    answerable: true,
  };
}

/** A pending AskUserQuestion prompt as the attention atoms draw it; `userQuestionStore` keeps the request. */
export function localQuestionPrompt(prompt: QuestionPrompt): FleetPrompt {
  const first = prompt.questions[0];
  return {
    deviceId: prompt.deviceId,
    workspaceId: activeWorkspaceId() ?? "",
    sessionId: prompt.sessionId,
    kind: "question",
    promptId: prompt.toolId,
    revision: 0,
    title: first?.question || first?.header || tr("inbox.needsYou"),
    toolName: "AskUserQuestion",
    payload: { questions: prompt.questions },
    payloadTruncated: false,
    answerable: true,
  };
}

function localGroups(): AttentionGroup[] {
  const groups: AttentionGroup[] = [];
  const waitingPermissions = pendingPermissions().map<AttentionEntry>(request => ({
    itemId: `local-permission/${request.requestId}`,
    kind: "permission",
    source: { deviceId: request.deviceId, sessionId: request.sessionId },
    title: sessionTitle(request.sessionId) || tr("inbox.approvalWaiting"),
    prompt: localPermissionPrompt(request),
    answerable: true,
  }));
  const waitingQuestions = questionPrompts().map<AttentionEntry>(prompt => ({
    itemId: `local-question/${prompt.deviceId}/${prompt.toolId}`,
    kind: "question",
    source: { deviceId: prompt.deviceId, sessionId: prompt.sessionId },
    title: sessionTitle(prompt.sessionId) || prompt.questions[0]?.header || tr("inbox.needsYou"),
    prompt: localQuestionPrompt(prompt),
    answerable: true,
  }));
  const waiting = [...waitingPermissions, ...waitingQuestions];
  if (waiting.length) groups.push({ id: "needs_you", items: waiting });
  const now = Date.now();
  const history = (kind: "turn-completed" | "turn-failed"): AttentionEntry[] =>
    notifications()
      .filter(item => item.kind === kind)
      .map(item => ({
        itemId: `local-${item.id}`,
        kind: kind === "turn-failed" ? "failure" : "done",
        source: { deviceId: "", sessionId: item.sessionId },
        title: (item.sessionId && sessionTitle(item.sessionId)) || item.title,
        detail: kind === "turn-failed" ? tr("inbox.turnFailed") : tr("inbox.turnDone"),
        ageMs: Math.max(0, now - item.createdAt),
        unread: !item.read,
      }));
  const done = history("turn-completed");
  if (done.length) groups.push({ id: "done", items: done });
  const failed = history("turn-failed");
  if (failed.length) groups.push({ id: "failed", items: failed });
  return groups;
}

/** The groups the Inbox draws: the backend's on a fleet entry, else this window's own. */
export const inboxGroups = computed<AttentionGroup[]>(() => (inboxIsLocal() ? localGroups() : attentionGroups()));

/** The sidebar pill and phone tab badge: the backend's count, else the approvals and questions waiting here. */
export const inboxBadgeCount = computed<number>(() =>
  inboxIsLocal() ? pendingPermissions().length + questionPrompts().length : inboxBadge(),
);

/** Whether "Mark all as read" has something to mark. */
export const inboxHasReadable = computed<boolean>(() =>
  inboxIsLocal()
    ? unreadNotificationCount() > 0
    : inboxGroups().some(group => group.id !== "needs_you" && group.items.length > 0),
);

/** Whether the local history can be cleared ("Clear" next to "Mark all as read"). */
export const inboxCanClear = computed<boolean>(() =>
  inboxIsLocal() && notifications().some(item => item.kind !== "permission"),
);

export async function markInboxRead(): Promise<void> {
  if (inboxIsLocal()) {
    markAllNotificationsRead();
    return;
  }
  await markAllAttentionRead();
}

export function clearInboxHistory(): void {
  if (inboxIsLocal()) clearNotifications();
}

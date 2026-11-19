// Permission prompts.
//
// A turn that asks for approval blocks until someone answers, and the answer may
// come from a remote controller. The prompt therefore lives in the session scene
// itself, fed by `permission://event`, instead of a native dialog only this window
// can show.

import { signal } from "nsh";
import { listPendingPermissionRequests, respondPermission, subscribePermissionRequests } from "./api";
import { invokeCommand, listenEvent } from "./bridge";
import { reportError } from "./state";

export interface PermissionRequestView {
  requestId: string;
  action: string;
  resources: string[];
  sessionId: string;
  agentId: string;
}

interface PermissionEventPayload {
  event?: "asked" | "replied" | "cancelled";
  request?: Record<string, unknown>;
  requestId?: string;
}

export const pendingPermissions = signal<PermissionRequestView[]>([]);
let started = false;

function toView(raw: Record<string, unknown> | undefined): PermissionRequestView | null {
  const requestId = typeof raw?.requestId === "string" ? raw.requestId : undefined;
  if (!requestId) return null;
  return {
    requestId,
    action: typeof raw?.action === "string" ? raw.action : "ask",
    resources: Array.isArray(raw?.resources) ? raw.resources.map(String) : [],
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : "",
    agentId: typeof raw?.agentId === "string" ? raw.agentId : "",
  };
}

function drop(requestId: string): void {
  pendingPermissions.update(current => current.filter(item => item.requestId !== requestId));
}

/** Subscribes once per app run and seeds the list with what is already waiting. */
export async function startPermissionPrompts(): Promise<void> {
  if (started) return;
  started = true;
  listenEvent<PermissionEventPayload>("permission://event", payload => {
    if (payload?.event === "asked") {
      const view = toView(payload.request);
      if (!view) return;
      pendingPermissions.update(current =>
        current.some(item => item.requestId === view.requestId) ? current : [...current, view],
      );
      return;
    }
    const requestId = payload?.requestId;
    if (requestId && (payload?.event === "replied" || payload?.event === "cancelled")) drop(requestId);
  });
  try {
    await subscribePermissionRequests();
    const pending = await listPendingPermissionRequests();
    const views = (Array.isArray(pending) ? pending : [])
      .map(item => toView((item ?? {}) as Record<string, unknown>))
      .filter((item): item is PermissionRequestView => item !== null);
    if (views.length > 0) pendingPermissions.set(views);
  } catch {
    // A host without permission plumbing still runs; it simply never asks. The
    // prompt area stays empty instead of claiming an error on every launch.
  }
}

/**
 * Drops prompts belonging to the machine this surface just left (e.g. Peer
 * Device Mode switch) and re-hydrates pending requests from the new host.
 */
export function resetPermissions(): void {
  pendingPermissions.set([]);
  void (async () => {
    try {
      await subscribePermissionRequests();
      const pending = await listPendingPermissionRequests();
      const views = (Array.isArray(pending) ? pending : [])
        .map(item => toView((item ?? {}) as Record<string, unknown>))
        .filter((item): item is PermissionRequestView => item !== null);
      pendingPermissions.set(views);
    } catch {
      // Host without permission plumbing stays empty.
    }
  })();
}

/** Pending permission prompts for one session (or unscoped host prompts). */
export function permissionsForSession(sessionId: string | null): PermissionRequestView[] {
  const all = pendingPermissions();
  if (!sessionId) return all;
  return all.filter(item => !item.sessionId || item.sessionId === sessionId);
}

export async function answerPermission(
  requestId: string,
  reply: "once" | "always" | "reject",
  feedback?: string,
): Promise<void> {
  answeringPermission.set({ requestId, reply });
  try {
    await respondPermission({ requestId, reply, ...(feedback ? { feedback } : {}) });
    drop(requestId);
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
  } finally {
    answeringPermission.set(null);
  }
}

/** The request being answered and how, so its button can show progress. */
export const answeringPermission = signal<{ requestId: string; reply: string } | null>(null);

/**
 * Answers a request and every request the host batched with it (one tool call
 * that touches several resources asks once per resource). The host returns the
 * ids it resolved; those leave the prompt together.
 */
export async function answerPermissionBatch(
  requestId: string,
  reply: "once" | "always" | "reject",
  feedback?: string,
): Promise<void> {
  answeringPermission.set({ requestId, reply: `batch-${reply}` });
  try {
    const resolved = await invokeCommand<unknown>("respond_permission_batch", {
      requestId,
      reply,
      ...(feedback ? { feedback } : {}),
    });
    const ids = Array.isArray(resolved) ? resolved.map(String) : [requestId];
    for (const id of ids.length ? ids : [requestId]) drop(id);
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
  } finally {
    answeringPermission.set(null);
  }
}

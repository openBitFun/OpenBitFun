// Permission prompts.
//
// A turn that asks for approval blocks until someone answers, and the answer may
// come from a remote controller. The prompt therefore lives in the session scene
// itself, fed by `permission://event`, instead of a native dialog only this window
// can show.

import { signal } from "nsh";
import { fleetActive, invokeCommand, listenEvent } from "./bridge";
import { activeSessionDevice, activeSessionId, deviceContext, reportError } from "./state";

export interface PermissionRequestView {
  requestId: string;
  action: string;
  resources: string[];
  sessionId: string;
  agentId: string;
  /** The device whose runtime asked (`EventMeta.origin`; `""` without the fleet layer). */
  deviceId: string;
}

interface PermissionEventPayload {
  event?: "asked" | "replied" | "cancelled";
  request?: Record<string, unknown>;
  requestId?: string;
}

export const pendingPermissions = signal<PermissionRequestView[]>([]);
let started = false;

function toView(raw: Record<string, unknown> | undefined, deviceId: string): PermissionRequestView | null {
  const requestId = typeof raw?.requestId === "string" ? raw.requestId : undefined;
  if (!requestId) return null;
  return {
    requestId,
    action: typeof raw?.action === "string" ? raw.action : "ask",
    resources: Array.isArray(raw?.resources) ? raw.resources.map(String) : [],
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : "",
    agentId: typeof raw?.agentId === "string" ? raw.agentId : "",
    deviceId,
  };
}

function drop(requestId: string, deviceId: string): void {
  pendingPermissions.update(current =>
    current.filter(item => !(item.requestId === requestId && item.deviceId === deviceId)),
  );
}

/** The device a request id was asked on (the first match), for answering it there. */
function deviceOfRequest(requestId: string): string {
  return pendingPermissions().find(item => item.requestId === requestId)?.deviceId ?? "";
}

/** The device whose pending list a read without an origin covers. */
function readDevice(): string {
  return fleetActive() ? deviceContext() : "";
}

/** Reads one device's pending requests (the device context's when `deviceId` is not given). */
async function readPending(deviceId: string): Promise<PermissionRequestView[]> {
  const target = deviceId ? { target: deviceId } : undefined;
  await invokeCommand<unknown>("subscribe_permission_requests", undefined, target);
  const pending = await invokeCommand<unknown[]>("list_pending_permission_requests", undefined, target);
  return (Array.isArray(pending) ? pending : [])
    .map(item => toView((item ?? {}) as Record<string, unknown>, deviceId))
    .filter((item): item is PermissionRequestView => item !== null);
}

/** Subscribes once per app run and seeds the list with what is already waiting. */
export async function startPermissionPrompts(): Promise<void> {
  if (started) return;
  started = true;
  listenEvent<PermissionEventPayload>("permission://event", (payload, meta) => {
    if (payload?.event === "asked") {
      const view = toView(payload.request, meta.origin);
      if (!view) return;
      pendingPermissions.update(current =>
        current.some(item => item.requestId === view.requestId && item.deviceId === view.deviceId)
          ? current
          : [...current, view],
      );
      return;
    }
    const requestId = payload?.requestId;
    if (requestId && (payload?.event === "replied" || payload?.event === "cancelled")) drop(requestId, meta.origin);
  });
  try {
    const device = readDevice();
    const views = await readPending(device);
    if (views.length > 0) {
      pendingPermissions.update(current => [...current.filter(item => item.deviceId !== device), ...views]);
    }
  } catch {
    // A host without permission plumbing still runs; it simply never asks. The
    // prompt area stays empty instead of claiming an error on every launch.
  }
}

/**
 * Re-hydrates pending requests. With an `origin` (a gap in that device's
 * events) only that device's prompts are dropped and re-read from it; without
 * one (the legacy Peer Device switch, or a gap in a plain stream) every prompt
 * is dropped and the device the surface reads is asked again.
 */
export function resetPermissions(origin?: string): void {
  const scoped = origin !== undefined && fleetActive();
  const device = scoped ? origin : readDevice();
  if (scoped) pendingPermissions.update(current => current.filter(item => item.deviceId !== origin));
  else pendingPermissions.set([]);
  void (async () => {
    try {
      const views = await readPending(device);
      pendingPermissions.update(current => [...current.filter(item => item.deviceId !== device), ...views]);
    } catch {
      // Host without permission plumbing stays empty.
    }
  })();
}

/** Pending permission prompts for one session (or unscoped host prompts) on the open session's device. */
export function permissionsForSession(sessionId: string | null): PermissionRequestView[] {
  const all = pendingPermissions();
  if (!sessionId) return all;
  const device = sessionId === activeSessionId() ? activeSessionDevice() : null;
  return all.filter(
    item => (!item.sessionId || item.sessionId === sessionId) && (device === null || item.deviceId === device),
  );
}

export async function answerPermission(
  requestId: string,
  reply: "once" | "always" | "reject",
  feedback?: string,
): Promise<void> {
  answeringPermission.set({ requestId, reply });
  const deviceId = deviceOfRequest(requestId);
  try {
    // The answer goes to the device whose runtime asked.
    await invokeCommand<unknown>(
      "respond_permission",
      { requestId, reply, ...(feedback ? { feedback } : {}) },
      deviceId ? { target: deviceId } : undefined,
    );
    drop(requestId, deviceId);
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
  const deviceId = deviceOfRequest(requestId);
  try {
    const resolved = await invokeCommand<unknown>(
      "respond_permission_batch",
      { requestId, reply, ...(feedback ? { feedback } : {}) },
      deviceId ? { target: deviceId } : undefined,
    );
    const ids = Array.isArray(resolved) ? resolved.map(String) : [requestId];
    for (const id of ids.length ? ids : [requestId]) drop(id, deviceId);
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
  } finally {
    answeringPermission.set(null);
  }
}

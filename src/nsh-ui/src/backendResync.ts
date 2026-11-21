// Re-hydration after a gap in the event stream.
//
// A connection that missed events the backend could not replay (its cursor
// fell out of the replay ring, the client was too slow, or the backend
// restarted) receives `backend://events-dropped`. Whatever the UI derived from
// the missed events is then re-read through ordinary commands: the session
// list, the open transcript, pending permission prompts and the open
// session's question mailbox. This module is transport-neutral; every
// connection that can drop events delivers the same event.

import { forgetFollowedTurns, settleLiveTurnFromView } from "./agentEvents";
import { fleetActive, listenEvent } from "./bridge";
import { refreshFleetNavigator, refreshFleetPrompts } from "./fleetStore";
import { resetPermissions } from "./permissionStore";
import { activeSessionDevice, activeSessionId, deviceContext, loadTurns, refreshSessionsSilently } from "./state";
import { resyncTerminal, terminalTabs } from "./terminalStore";
import { loadQuestionMailbox, resetQuestionPrompts } from "./userQuestionStore";

export const EVENTS_DROPPED = "backend://events-dropped";

let installed: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Origins with a pending re-hydration; `null` stands for the whole stream. */
let pendingOrigins = new Set<string | null>();

/**
 * Re-reads what events would have kept current. On a fleet stream a gap names
 * its origin, and only that device is re-read: its sessions (when it is the
 * device context), the open transcript and question mailbox (when the open
 * session is on it), its pending permissions, and its shells. A gap without an
 * origin (a plain stream, or the entry's own stream restarting) re-reads
 * everything, as before.
 */
export async function rehydrateAfterDroppedEvents(origin?: string | null): Promise<void> {
  const scoped = typeof origin === "string" && fleetActive();
  const sessionId = activeSessionId();
  const openHere = Boolean(sessionId) && (!scoped || activeSessionDevice() === origin);
  // A running turn may have lost events: the next read's snapshot replaces it.
  forgetFollowedTurns();
  const reads: Array<Promise<unknown>> = [];
  if (!scoped || deviceContext() === origin) reads.push(refreshSessionsSilently());
  if (openHere && sessionId) {
    reads.push(loadTurns(sessionId, { silent: true }), loadQuestionMailbox(sessionId));
  }
  // The index events of the gap may be lost too.
  if (fleetActive()) reads.push(refreshFleetNavigator(), refreshFleetPrompts());
  if (scoped) {
    resetQuestionPrompts(origin);
    for (const tab of terminalTabs()) if ((tab.deviceId ?? "") === origin) reads.push(resyncTerminal(tab.id));
  }
  await Promise.allSettled(reads);
  // A turn whose terminal events were lost settles from the view the host sent.
  if (openHere && sessionId) settleLiveTurnFromView(sessionId);
  resetPermissions(scoped ? origin : undefined);
}

function originOf(payload: unknown): string | null {
  const origin = (payload as { origin?: unknown } | null)?.origin;
  return typeof origin === "string" && origin ? origin : null;
}

/** Listens for `backend://events-dropped` once per app; returns the stopper. */
export function installBackendResync(): () => void {
  if (installed) return installed;
  const stop = listenEvent<unknown>(EVENTS_DROPPED, payload => {
    console.info(`Backend events were dropped; re-hydrating: ${JSON.stringify(payload ?? null)}`);
    pendingOrigins.add(fleetActive() ? originOf(payload) : null);
    // Several gaps in a row (a long stall) re-read once per origin.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const origins = pendingOrigins;
      pendingOrigins = new Set();
      if (origins.has(null)) {
        void rehydrateAfterDroppedEvents(null);
        return;
      }
      for (const origin of origins) void rehydrateAfterDroppedEvents(origin);
    }, 50);
  });
  installed = () => {
    stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingOrigins = new Set();
    installed = null;
  };
  return installed;
}

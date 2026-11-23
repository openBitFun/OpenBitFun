// Re-hydration after a gap in the event stream.
//
// A connection that missed events the backend could not replay (its cursor
// fell out of the replay ring, the client was too slow, or the backend
// restarted) receives `backend://events-dropped`. Whatever the UI derived from
// the missed events is then re-read through ordinary commands: the session
// list, the open transcript, pending permission prompts and the open
// session's question mailbox. This module is transport-neutral; every
// connection that can drop events delivers the same event.

import { forgetFollowedTurns, settleLiveTurnFromView, settleSecondaryLiveTurnFromView } from "./agentEvents";
import { refreshAttention } from "./attentionStore";
import { fleetActive, listenEvent } from "./bridge";
import { fleetDevices, refreshFleetNavigator, refreshFleetPrompts } from "./fleetStore";
import { resetPermissions } from "./permissionStore";
import {
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceId,
  deviceContext,
  getSecondaryPaneBridge,
  loadTurns,
  refreshSessionsSilently,
  secondarySessionDevice,
  secondarySessionId,
  splitPaneOpen,
} from "./state";
import {
  activeConversationId,
  conversationsLoaded,
  refreshConversation,
  refreshConversations,
  refreshSuperagentStatus,
  superagentPhase,
} from "./superagentStore";
import { resyncTerminal, terminalTabs } from "./terminalStore";
import { loadQuestionMailbox, resetQuestionPrompts } from "./userQuestionStore";

export const EVENTS_DROPPED = "backend://events-dropped";

let installed: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Origins with a pending re-hydration; `null` stands for the whole stream. */
let pendingOrigins = new Set<string | null>();

function cloudNodeDeviceId(): string | null {
  return fleetDevices().find(device => device.hostKind === "cloud")?.deviceId ?? null;
}

/**
 * Re-hydrates one batch of dropped origins in a single pass. When `origins`
 * is `null` (or off fleet), the whole stream is re-read: sessions, open
 * transcript, all question prompts, all terminals, Inbox and Super Agent.
 * When `origins` names specific fleet devices, the fleet navigator, prompts
 * and Inbox are each read once for the whole batch (never once per origin),
 * live turns are only cleared if the currently viewed session lives on a
 * dropped origin, and terminals/permissions/questions are scoped to those
 * origins.
 */
async function rehydrateDroppedBatch(origins: ReadonlySet<string> | null): Promise<void> {
  const fleet = fleetActive();
  const scoped = origins !== null && fleet;
  const sessionId = activeSessionId();
  const openHere = Boolean(sessionId) && (!scoped || origins.has(activeSessionDevice()));
  const secSessionId = splitPaneOpen() ? secondarySessionId() : null;
  const secOpenHere = Boolean(secSessionId) && (!scoped || origins.has(secondarySessionDevice()));
  // Only forget followed live turns when the gap affects a viewed session's device.
  if (!scoped || openHere || secOpenHere) forgetFollowedTurns();

  // Clear stale question prompts before re-reading the mailbox so fresh answers are kept.
  if (scoped) {
    for (const origin of origins) resetQuestionPrompts(origin);
  } else {
    resetQuestionPrompts();
  }

  const reads: Array<Promise<unknown>> = [];
  const contextAffected = !scoped || origins.has(deviceContext());
  if (fleet) {
    // In fleet mode `refreshSessionsSilently()` already calls `refreshFleetNavigator()`;
    // avoid firing two navigator reads back to back.
    if (contextAffected && activeWorkspaceId()) {
      reads.push(refreshSessionsSilently());
    } else {
      reads.push(refreshFleetNavigator());
    }
    reads.push(refreshFleetPrompts(), refreshAttention());
  } else if (contextAffected) {
    reads.push(refreshSessionsSilently());
  }

  if (openHere && sessionId) {
    reads.push(loadTurns(sessionId, { silent: true }), loadQuestionMailbox(sessionId));
  }
  if (secOpenHere && secSessionId) {
    const bridge = getSecondaryPaneBridge();
    if (bridge) reads.push(bridge.loadTurns(secSessionId, { silent: true }));
    reads.push(loadQuestionMailbox(secSessionId));
  }

  // Re-hydrate Super Agent when the gap is unscoped or names the cloud node.
  const cloudId = cloudNodeDeviceId();
  const cloudAffected = !scoped || (cloudId !== null && origins.has(cloudId));
  const superagentActive =
    superagentPhase() === "ready" || conversationsLoaded() || activeConversationId() !== null;
  if (cloudAffected && superagentActive) {
    reads.push(refreshSuperagentStatus(), refreshConversations());
    if (activeConversationId()) reads.push(refreshConversation());
  }

  // Resync terminals for matching origins (or every open terminal on an unscoped gap).
  for (const tab of terminalTabs()) {
    if (!scoped || origins.has(tab.deviceId ?? "")) {
      reads.push(resyncTerminal(tab.id));
    }
  }

  await Promise.allSettled(reads);
  // A turn whose terminal events were lost settles from the view the host sent.
  if (openHere && sessionId) settleLiveTurnFromView(sessionId);
  if (secOpenHere && secSessionId) settleSecondaryLiveTurnFromView(secSessionId);
  if (scoped) {
    for (const origin of origins) resetPermissions(origin);
  } else {
    resetPermissions();
  }
}

/**
 * Re-reads what events would have kept current. On a fleet stream a gap names
 * its origin, and only that device is re-read; a gap without an origin
 * re-reads everything.
 */
export async function rehydrateAfterDroppedEvents(origin?: string | null): Promise<void> {
  const scoped = typeof origin === "string" && origin.length > 0 && fleetActive();
  await rehydrateDroppedBatch(scoped ? new Set([origin]) : null);
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
    // Several gaps in a row (e.g. entry failover) coalesce into one batch pass.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const origins = pendingOrigins;
      pendingOrigins = new Set();
      if (origins.has(null)) {
        void rehydrateDroppedBatch(null);
        return;
      }
      const named = new Set<string>();
      for (const origin of origins) if (typeof origin === "string" && origin) named.add(origin);
      void rehydrateDroppedBatch(named.size > 0 ? named : null);
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

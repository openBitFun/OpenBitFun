// Re-hydration after a gap in the event stream.
//
// A connection that missed events the backend could not replay (its cursor
// fell out of the replay ring, the client was too slow, or the backend
// restarted) receives `backend://events-dropped`. Whatever the UI derived from
// the missed events is then re-read through ordinary commands: the session
// list, the open transcript, pending permission prompts and the open
// session's question mailbox. This module is transport-neutral; every
// connection that can drop events delivers the same event.

import { listenEvent } from "./bridge";
import { resetPermissions } from "./permissionStore";
import { activeSessionId, loadTurns, refreshSessionsSilently } from "./state";
import { loadQuestionMailbox } from "./userQuestionStore";

export const EVENTS_DROPPED = "backend://events-dropped";

let installed: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Re-reads what events would have kept current. */
export async function rehydrateAfterDroppedEvents(): Promise<void> {
  const sessionId = activeSessionId();
  await Promise.allSettled([
    refreshSessionsSilently(),
    sessionId ? loadTurns(sessionId, { silent: true }) : Promise.resolve(null),
    sessionId ? loadQuestionMailbox(sessionId) : Promise.resolve(),
  ]);
  resetPermissions();
}

/** Listens for `backend://events-dropped` once per app; returns the stopper. */
export function installBackendResync(): () => void {
  if (installed) return installed;
  const stop = listenEvent<unknown>(EVENTS_DROPPED, payload => {
    console.info(`Backend events were dropped; re-hydrating: ${JSON.stringify(payload ?? null)}`);
    // Several gaps in a row (a long stall) re-read once.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void rehydrateAfterDroppedEvents();
    }, 50);
  });
  installed = () => {
    stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    installed = null;
  };
  return installed;
}

// The fleet entry of a client without a backend of its own (a browser on the
// OpenBitFun domain, the NSH phone app).
//
// Any desktop or CLI host on the account can be the entry the client talks
// through; which one is a ranking the backend makes (the gateway's
// `entryCandidates`, the phone module's `rank_entry_candidates`), never this
// file. The walker connects to the first candidate with a hello that carries
// the vector cursor (`fleet {protocol, cursor}`). When that entry is lost, the
// calls in flight fail with `entry_lost` (they are not retried: a mutation may
// have run), and the next candidate is tried with the same cursor, so every
// origin resumes where it was; an origin the new entry cannot resume is
// re-hydrated alone (`backend://events-dropped {origin}`). The connection
// reports trouble only when every candidate failed: losing one entry is not
// the user's concern.

import { batch, effect, lifecycle, signal, untracked, wakeCount } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type BackendInfo,
  type ConnectionState,
  type InvokeOptions,
  type TransportKind,
} from "../backendConnection";
import {
  EVENTS_DROPPED_EVENT,
  FLEET_ENTRY_LOST,
  FLEET_PROTOCOL_VERSION,
  type FleetCursor,
  type FleetHello,
  type FleetHelloAnswer,
} from "../fleetTypes";
import type { ControllerConnection, ControllerPort } from "./controllerPort";

/** Reason of the `events-dropped` the walker reports for an origin the new entry dropped. */
export const ENTRY_CHANGED_REASON = "entry_changed";

const DEFAULT_MIN_RETRY_MS = 500;
const DEFAULT_MAX_RETRY_MS = 15_000;
const DEFAULT_MAX_AUTO_RETRIES = 6;

export interface FleetEntryOptions {
  /** Device ids to try, best first, as the backend ranked them. */
  candidates: readonly string[];
  /**
   * Opens a connection to one candidate whose hello carries `hello.fleet`
   * (the cursor object is shared: the connection advances it as it delivers).
   * Resolves once the device answered its hello.
   */
  connect(deviceId: string, hello: { fleet: FleetHello }): Promise<ControllerConnection>;
  /** A cursor to resume from (a page reload keeps none; a handoff may). */
  cursor?: FleetCursor;
  /** Re-reads ranked entry candidates on failover so newly online devices are tried. */
  refreshCandidates?: () => Promise<readonly string[] | null>;
  /** Initial backoff delay in ms when every candidate fails after a drop (500). */
  minRetryMs?: number;
  /** Maximum backoff delay in ms (15000). */
  maxRetryMs?: number;
  /** Bounded automatic retry passes after a drop before settling in `failed` (6). */
  maxAutoRetries?: number;
}

export interface FleetEntryConnection extends BackendConnection {
  /** The current entry's fleet answer (the last one's between entries). */
  fleet(): FleetHelloAnswer | null;
  /** The candidate the client talks through now; `null` between entries. */
  entryDeviceId(): string | null;
  /** The vector cursor the next hello carries. */
  cursor(): FleetCursor;
  /** True once every candidate failed; the error says why the last one did. */
  allFailed(): boolean;
  /** Tries the candidates again after every one failed. */
  retry(): void;
  /** Closes the entry for good. */
  close(): void;
}

interface InFlight {
  command: string;
  reject(error: Error): void;
}

function entryLost(command: string, entry: string | null, reason: string): Error {
  return new Error(
    `${FLEET_ENTRY_LOST}: the connection through ${entry ?? "the entry"} was lost before \`${command}\` answered${reason ? ` (${reason})` : ""}`,
  );
}

export function createFleetEntryConnection(options: FleetEntryOptions): FleetEntryConnection {
  const cursor: FleetCursor = options.cursor ?? {};
  let candidates = [...options.candidates];
  const minRetryMs = options.minRetryMs ?? DEFAULT_MIN_RETRY_MS;
  const maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const maxAutoRetries = options.maxAutoRetries ?? DEFAULT_MAX_AUTO_RETRIES;
  const state = signal<ConnectionState>("connecting");
  const error = signal("");
  const failedAll = signal(false);
  const current = signal<ControllerConnection | null>(null);
  /** The last entry's fleet answer, kept between entries so the UI stays in fleet mode. */
  const lastAnswer = signal<FleetHelloAnswer | null>(null);
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  const inFlight = new Set<InFlight>();
  const watched = new Set<string>();
  let waiters: Array<{ resolve(connection: ControllerConnection): void; reject(error: Error): void }> = [];
  let stopInner: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let walking = false;
  let everConnected = false;
  let autoRetries = 0;
  let retryDelayMs = minRetryMs;
  /** Where the next walk starts in `candidates`. */
  let nextIndex = 0;
  let lastLostDevice: string | null = null;

  let resolveReady: ((info: BackendInfo) => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<BackendInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => undefined);

  function cancelRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function deliver(batch: readonly BackendEvent[]): void {
    if (batch.length === 0) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(batch);
      } catch (reason) {
        console.error("An event subscriber failed", reason);
      }
    }
  }

  function settleWaiters(connection: ControllerConnection | null, failure: Error | null): void {
    const list = waiters;
    waiters = [];
    for (const waiter of list) {
      if (connection) waiter.resolve(connection);
      else waiter.reject(failure ?? new Error("The fleet entry is closed"));
    }
  }

  function connection(): Promise<ControllerConnection> {
    const live = current();
    if (live && live.state() === "connected") return Promise.resolve(live);
    if (closed) return Promise.reject(new Error("The fleet entry is closed"));
    if (failedAll()) return Promise.reject(new Error(error() || "No device could be reached"));
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  /** The new entry could not resume these origins: re-hydrate each alone. */
  function reportDroppedOrigins(answer: FleetHelloAnswer | null): void {
    const dropped = Object.entries(answer?.cursorState ?? {})
      .filter(([, value]) => value === "dropped")
      .map(([origin]) => origin);
    if (dropped.length === 0) return;
    deliver(
      dropped.map(origin => ({
        event: EVENTS_DROPPED_EVENT,
        payload: { origin, reason: ENTRY_CHANGED_REASON },
        origin,
      })),
    );
  }

  function loseEntry(lost: ControllerConnection, reason: string): void {
    if (current() !== lost) return;
    console.warn(`Fleet entry lost: device=${lost.deviceId}, reason=${reason || "closed"}`);
    stopInner?.();
    stopInner = null;
    current.set(null);
    lastLostDevice = lost.deviceId;
    const calls = [...inFlight];
    inFlight.clear();
    for (const call of calls) call.reject(entryLost(call.command, lost.deviceId, reason));
    lost.close();
    // Losing one entry is not the user's concern: move on quietly.
    if (state() === "connected") state.set("reconnecting");
    const index = candidates.indexOf(lost.deviceId);
    nextIndex = index >= 0 ? (index + 1) % Math.max(1, candidates.length) : 0;
    void walk();
  }

  function adopt(next: ControllerConnection): void {
    cancelRetryTimer();
    autoRetries = 0;
    retryDelayMs = minRetryMs;
    everConnected = true;
    lastLostDevice = null;
    stopInner = next.subscribe(deliver);
    for (const event of watched) next.watch?.(event);
    const answer = next.fleet?.() ?? null;
    // Update `state` and `current` in one batch so the reactive state watcher
    // sees `connected` immediately and never fires a duplicate drop/rehydrate pass.
    batch(() => {
      failedAll.set(false);
      error.set("");
      state.set("connected");
      lastAnswer.set(answer ? (answer.deviceId ? answer : { ...answer, deviceId: next.deviceId }) : null);
      current.set(next);
    });
    reportDroppedOrigins(answer);
    settleWaiters(next, null);
  }

  async function refreshCandidateList(): Promise<void> {
    if (!options.refreshCandidates) return;
    try {
      const fresh = await options.refreshCandidates();
      if (!fresh || fresh.length === 0) return;
      const deduped: string[] = [];
      for (const id of fresh) {
        if (id && !deduped.includes(id)) deduped.push(id);
      }
      if (deduped.length === 0) return;
      // Put the candidate we just lost at the back so another healthy candidate goes first.
      if (lastLostDevice && deduped.includes(lastLostDevice) && deduped.length > 1) {
        candidates = [...deduped.filter(id => id !== lastLostDevice), lastLostDevice];
        nextIndex = 0;
      } else {
        candidates = deduped;
        nextIndex = nextIndex % candidates.length;
      }
    } catch {
      // Keep the last known candidate list when refresh fails transiently.
    }
  }

  function scheduleBackoffRetry(): void {
    if (closed || retryTimer !== null) return;
    const delay = retryDelayMs;
    retryDelayMs = Math.min(maxRetryMs, retryDelayMs * 2);
    autoRetries += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (closed || walking || current()) return;
      nextIndex = 0;
      void walk();
    }, delay);
  }

  async function walk(): Promise<void> {
    if (walking || closed) return;
    walking = true;
    cancelRetryTimer();
    let lastError = "";
    try {
      if (everConnected) await refreshCandidateList();
      if (closed) return;
      for (let tried = 0; tried < candidates.length && !closed; tried += 1) {
        const deviceId = candidates[(nextIndex + tried) % candidates.length]!;
        let opened: ControllerConnection;
        try {
          opened = await options.connect(deviceId, { fleet: { protocol: FLEET_PROTOCOL_VERSION, cursor } });
        } catch (reason) {
          lastError = errorMessageOf(reason);
          console.warn(`Fleet entry candidate failed: device=${deviceId}, reason=${lastError}`);
          continue;
        }
        if (closed) {
          opened.close();
          return;
        }
        nextIndex = (nextIndex + tried) % candidates.length;
        let info: BackendInfo | null = null;
        try {
          info = await opened.ready();
        } catch (reason) {
          lastError = errorMessageOf(reason);
          opened.close();
          continue;
        }
        if (closed) {
          opened.close();
          return;
        }
        adopt(opened);
        resolveReady?.(info);
        return;
      }
      if (closed) return;
      const message = candidates.length === 0 ? "No device can be the entry now" : lastError || "No device answered";
      const failure = new Error(message);
      error.set(message);
      if (everConnected && autoRetries < maxAutoRetries) {
        // Transient drop across all candidates: stay in `reconnecting` with bounded backoff
        // instead of permanently bricking the client.
        failedAll.set(false);
        state.set("reconnecting");
        settleWaiters(null, failure);
        scheduleBackoffRetry();
        return;
      }
      failedAll.set(true);
      state.set("failed");
      rejectReady?.(failure);
      settleWaiters(null, failure);
    } finally {
      walking = false;
    }
  }

  // Event-driven reactive state watch on the active entry (replaces 40 Hz polling).
  // When only one candidate exists, a transient `reconnecting` state lets the
  // underlying connection (e.g. WebSocket) run its own reconnect backoff instead
  // of closing and killing it; multi-candidate entries fail over immediately.
  effect(() => {
    const live = current();
    if (!live || closed) return;
    const value = live.state();
    untracked(() => {
      if (closed || current() !== live) return;
      if (value === "connected") {
        if (state() !== "connected") {
          failedAll.set(false);
          error.set("");
          state.set("connected");
          const answer = live.fleet?.() ?? null;
          lastAnswer.set(answer ? (answer.deviceId ? answer : { ...answer, deviceId: live.deviceId }) : null);
          reportDroppedOrigins(answer);
          settleWaiters(live, null);
        }
        return;
      }
      if (value === "reconnecting") {
        if (candidates.length > 1) {
          loseEntry(live, live.error());
        } else {
          // Single candidate: preserve the underlying connection's own reconnect loop.
          const calls = [...inFlight];
          inFlight.clear();
          for (const call of calls) call.reject(entryLost(call.command, live.deviceId, live.error()));
          error.set(live.error());
          state.set("reconnecting");
        }
        return;
      }
      if (value === "failed") {
        loseEntry(live, live.error());
      }
    });
  });

  function wakeReconnect(): void {
    if (closed || walking) return;
    const live = current();
    if (live) {
      if (live.state() !== "connected") live.retry?.();
      return;
    }
    if (state() === "reconnecting" || state() === "failed") {
      entry.retry();
    }
  }

  // Wake immediately on OS foreground / system wake (mobile & desktop) and browser online / tab focus.
  let previousLifecycle = lifecycle();
  let previousWake = wakeCount();
  effect(() => {
    const nextLifecycle = lifecycle();
    const nextWake = wakeCount();
    const resumed =
      (nextLifecycle === "active" && previousLifecycle !== "active") || nextWake !== previousWake;
    previousLifecycle = nextLifecycle;
    previousWake = nextWake;
    if (resumed && !closed) untracked(() => wakeReconnect());
  });

  const cleanups: Array<() => void> = [];
  const win = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  if (typeof win.addEventListener === "function" && typeof win.removeEventListener === "function") {
    const onOnline = () => wakeReconnect();
    win.addEventListener("online", onOnline);
    cleanups.push(() => win.removeEventListener?.("online", onOnline));
  }
  const doc = (globalThis as {
    document?: {
      visibilityState?: string;
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
  }).document;
  if (doc && typeof doc.addEventListener === "function" && typeof doc.removeEventListener === "function") {
    const onVisible = () => {
      if (doc.visibilityState === "visible") wakeReconnect();
    };
    doc.addEventListener("visibilitychange", onVisible);
    cleanups.push(() => doc.removeEventListener?.("visibilitychange", onVisible));
  }

  void walk();

  const entry: FleetEntryConnection = {
    get kind(): TransportKind {
      return current()?.kind ?? "websocket";
    },
    get coalescesTextChunks() {
      return current()?.coalescesTextChunks === true;
    },
    invoke(command: string, args: Record<string, unknown> | undefined, invokeOptions?: InvokeOptions): Promise<unknown> {
      const dispatch = (live: ControllerConnection): Promise<unknown> => {
        if (current() !== live || live.state() !== "connected") {
          return Promise.reject(entryLost(command, live.deviceId, live.error()));
        }
        return new Promise<unknown>((resolve, reject) => {
          let settled = false;
          const call: InFlight = {
            command,
            reject: reason => {
              if (settled) return;
              settled = true;
              reject(reason);
            },
          };
          inFlight.add(call);
          live.invoke(command, args, invokeOptions).then(
            value => {
              inFlight.delete(call);
              if (settled) return;
              settled = true;
              resolve(value);
            },
            reason => {
              inFlight.delete(call);
              if (current() !== live || live.state() !== "connected") {
                // The entry went away under the call: say so, then move on.
                call.reject(entryLost(command, live.deviceId, errorMessageOf(reason)));
                if (candidates.length > 1 || live.state() === "failed") {
                  loseEntry(live, live.error() || errorMessageOf(reason));
                }
                return;
              }
              call.reject(reason instanceof Error ? reason : new Error(errorMessageOf(reason)));
            },
          );
        });
      };
      // Register in-flight calls synchronously when already connected so an
      // immediate drop on the same tick cannot race ahead of `inFlight.add`.
      const immediate = current();
      if (immediate && immediate.state() === "connected") return dispatch(immediate);
      return connection().then(dispatch);
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      return () => {
        subscribers.delete(onEvents);
      };
    },
    ready: () => readyPromise,
    state: () => state(),
    error: () => error(),
    lastSeq: () => current()?.lastSeq() ?? null,
    watch(event: string) {
      watched.add(event);
      current()?.watch?.(event);
    },
    unwatch(event: string) {
      watched.delete(event);
      current()?.unwatch?.(event);
    },
    fleet() {
      const live = current();
      if (!live) return lastAnswer();
      const answer = live.fleet?.() ?? null;
      if (!answer) return null;
      // The candidate is the entry when its hello does not name itself.
      return answer.deviceId ? answer : { ...answer, deviceId: live.deviceId };
    },
    entryDeviceId: () => current()?.deviceId ?? null,
    cursor: () => cursor,
    allFailed: () => failedAll(),
    retry() {
      if (closed || walking) return;
      cancelRetryTimer();
      autoRetries = 0;
      retryDelayMs = minRetryMs;
      const live = current();
      if (live) {
        if (live.state() !== "connected") live.retry?.();
        return;
      }
      failedAll.set(false);
      error.set("");
      state.set("reconnecting");
      nextIndex = 0;
      void walk();
    },
    close() {
      closed = true;
      cancelRetryTimer();
      for (const stop of cleanups.splice(0)) stop();
      stopInner?.();
      stopInner = null;
      const live = current();
      current.set(null);
      live?.close();
      const calls = [...inFlight];
      inFlight.clear();
      for (const call of calls) call.reject(new Error(`The fleet entry was closed before \`${call.command}\` answered`));
      settleWaiters(null, new Error("The fleet entry is closed"));
    },
  };
  return entry;
}

/**
 * The candidates a port offers (the gateway's `entryCandidates`, the phone
 * module's ranking); `null` when the port cannot rank (an older server or
 * module), and the client then keeps connecting to one device as before.
 */
export async function fleetEntryCandidates(port: ControllerPort): Promise<string[] | null> {
  if (!port.entryCandidates) return null;
  try {
    const list = await port.entryCandidates();
    return Array.isArray(list) ? list.filter(item => typeof item === "string" && item) : null;
  } catch (reason) {
    console.warn(`Fleet entry candidates unavailable: ${errorMessageOf(reason)}`);
    return null;
  }
}

/**
 * Opens the fleet entry through a port: candidates from the port, each tried
 * with the hello cursor. `null` when the port offers no candidates.
 */
export async function connectFleetEntry(port: ControllerPort): Promise<FleetEntryConnection | null> {
  const candidates = await fleetEntryCandidates(port);
  if (!candidates || candidates.length === 0) return null;
  return createFleetEntryConnection({
    candidates,
    refreshCandidates: () => fleetEntryCandidates(port),
    connect: (deviceId, hello) => port.connect(deviceId, { fleet: hello.fleet }),
  });
}

/**
 * Gives a connection the controller already opened (the device whose UI this
 * page runs) entry failover: when that device is a fleet entry and the port
 * ranks other candidates, the connection is wrapped in an entry walker that
 * starts with it and moves on with `cursor` (the cursor its hello carried).
 * Otherwise (an older device or server) the connection is returned as it is.
 */
export async function withFleetFailover(
  port: ControllerPort,
  deviceId: string,
  opened: ControllerConnection,
  cursor: FleetCursor,
  rankedCandidates?: readonly string[] | null,
): Promise<ControllerConnection> {
  if (!opened.fleet?.()) return opened;
  const ranked =
    rankedCandidates && rankedCandidates.length > 0 ? [...rankedCandidates] : await fleetEntryCandidates(port);
  if (!ranked || ranked.length === 0) return opened;
  let first: ControllerConnection | null = opened;
  const entry = createFleetEntryConnection({
    candidates: [deviceId, ...ranked.filter(id => id !== deviceId)],
    cursor,
    refreshCandidates: () => fleetEntryCandidates(port),
    connect: async (id, hello) => {
      if (first && id === deviceId) {
        const reused = first;
        first = null;
        return reused;
      }
      return port.connect(id, { fleet: hello.fleet });
    },
  });
  await entry.ready();
  return Object.defineProperty(entry, "deviceId", {
    get: () => entry.entryDeviceId() ?? deviceId,
    enumerable: true,
    configurable: true,
  }) as unknown as ControllerConnection;
}

// A backend connection over a JSON-string wire: `invoke(command, argsJson)`,
// a long-polled `nextEvents()` that answers seq-numbered batches, and
// `ready()`. The in-process native host (`openbitfun/native`'s `Backend`)
// speaks it; nothing here knows what carries the strings.

import { signal } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type BackendInfo,
  type ConnectionState,
  type TransportKind,
} from "./backendConnection";
import {
  advanceFleetCursor,
  EVENTS_DROPPED_EVENT,
  fleetCursorHasSeen,
  readFleetHelloAnswer,
  type FleetCursor,
  type FleetHelloAnswer,
} from "./fleetTypes";

/** The wire, as the native module exposes it. */
export interface JsonWireBackend {
  invoke(command: string, argsJson: string): Promise<string>;
  /** Resumes after `afterSeq` when given (the backend replays a bounded history). */
  nextEvents(afterSeq?: number): Promise<string>;
  ready(): Promise<string>;
}

export interface JsonWireConnectionOptions {
  kind: TransportKind;
  /** Longest pause between two failed polls, in ms (5000). */
  maxBackoffMs?: number;
  /**
   * Shared vector cursor for fleet frames (mutated in place as events arrive,
   * so an entry walker carries it to the next candidate on failover).
   */
  fleetCursor?: FleetCursor;
}

export interface JsonWireConnection extends BackendConnection {
  /** The fleet answer populated once `ready()` resolves, or `null` on a non-fleet host. */
  fleet(): FleetHelloAnswer | null;
  /** Closes the event poller cleanly without reporting a transient disconnect. */
  close(): void;
}

function parseJson(text: string): unknown {
  return text === "" ? null : JSON.parse(text);
}

function readInfo(text: string): BackendInfo {
  const value = (parseJson(text) ?? {}) as Record<string, unknown>;
  const read = (key: string) => (typeof value[key] === "string" && value[key] ? (value[key] as string) : null);
  const info: BackendInfo = { version: read("version"), platform: read("platform"), dataDir: read("dataDir") };
  // A fleet entry says so in its ready info (the native host) or hello (a Link stream).
  const fleet = readFleetHelloAnswer(value.fleet);
  if (fleet) info.fleet = fleet;
  return info;
}

function readBatch(text: string): BackendEvent[] {
  const value = parseJson(text);
  if (!Array.isArray(value)) throw new Error("an event batch is not an array");
  const out: BackendEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.event !== "string") continue;
    const event: BackendEvent = { event: record.event, payload: record.payload ?? null };
    if (typeof record.seq === "number") event.seq = record.seq;
    if (typeof record.origin === "string" && record.origin) event.origin = record.origin;
    if (typeof record.originInstance === "string" && record.originInstance) event.originInstance = record.originInstance;
    out.push(event);
  }
  return out;
}

export function createJsonWireConnection(
  backend: JsonWireBackend,
  options: JsonWireConnectionOptions,
): JsonWireConnection {
  const state = signal<ConnectionState>("connecting");
  const error = signal("");
  const fleetAnswer = signal<FleetHelloAnswer | null>(null);
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  const maxBackoffMs = options.maxBackoffMs ?? 5000;
  let lastSeq: number | null = null;
  /** Per-origin cursor for fleet frames, whose `seq` is the origin's own. */
  const originCursor: FleetCursor = options.fleetCursor ?? {};
  let polling = false;
  let closed = false;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeBackoff: (() => void) | null = null;
  let readyPromise: Promise<BackendInfo> | null = null;

  function ready(): Promise<BackendInfo> {
    if (!readyPromise) {
      readyPromise = backend.ready().then(
        text => {
          const info = readInfo(text);
          fleetAnswer.set(info.fleet ?? null);
          if (!closed && state() === "connecting") state.set("connected");
          return info;
        },
        reason => {
          const message = errorMessageOf(reason);
          if (!closed) {
            error.set(message);
            state.set("failed");
          }
          console.error(`The backend failed to start: ${message}`);
          throw new Error(message);
        },
      );
      readyPromise.catch(() => undefined);
    }
    return readyPromise;
  }

  function deliver(batch: BackendEvent[]): void {
    // A replay after a reconnect may repeat what was already delivered.
    const fresh = batch.filter(item => {
      if (item.seq === undefined) return true;
      if (item.origin) {
        const instance = item.originInstance ?? "";
        if (item.event === EVENTS_DROPPED_EVENT) {
          // The origin skipped ahead: its cursor restarts at the notice's own seq.
          originCursor[item.origin] = { instanceId: instance, seq: item.seq };
          return true;
        }
        if (fleetCursorHasSeen(originCursor, item.origin, instance, item.seq)) return false;
        advanceFleetCursor(originCursor, item.origin, instance, item.seq);
        return true;
      }
      if (item.event === EVENTS_DROPPED_EVENT) {
        // Plain stream restarted or skipped ahead: its cursor replaces ours so post-restart events pass.
        lastSeq = item.seq;
        return true;
      }
      if (lastSeq !== null && item.seq <= lastSeq) return false;
      lastSeq = item.seq;
      return true;
    });
    if (fresh.length === 0) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(fresh);
      } catch (reason) {
        console.error("An event subscriber failed", reason);
      }
    }
  }

  function sleepBackoff(ms: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        if (backoffTimer !== null) {
          clearTimeout(backoffTimer);
          backoffTimer = null;
        }
        if (wakeBackoff === done) wakeBackoff = null;
        resolve();
      };
      wakeBackoff = done;
      backoffTimer = setTimeout(done, ms);
    });
  }

  async function poll(): Promise<void> {
    let backoffMs = 250;
    while (!closed) {
      let text: string;
      try {
        // Resume after what this UI has seen, so a reconnect replays the gap.
        text = await (lastSeq === null ? backend.nextEvents() : backend.nextEvents(lastSeq));
      } catch (reason) {
        if (closed) break;
        const message = errorMessageOf(reason);
        if (state() !== "failed") state.set("reconnecting");
        error.set(message);
        console.warn(`Backend event stream interrupted: ${message}`);
        await sleepBackoff(backoffMs);
        if (closed) break;
        backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
        continue;
      }
      if (closed) break;
      backoffMs = 250;
      if (state() === "reconnecting") {
        state.set("connected");
        error.set("");
      }
      let batch: BackendEvent[];
      try {
        batch = readBatch(text);
      } catch (reason) {
        console.error(`Unreadable backend event batch: ${errorMessageOf(reason)}`);
        continue;
      }
      // An empty batch is the backend's shutdown: the stream ends here.
      if (batch.length === 0) {
        polling = false;
        if (!closed && state() !== "failed") {
          state.set("failed");
          error.set("The backend stopped");
        }
        return;
      }
      deliver(batch);
    }
    polling = false;
  }

  function startPolling(): void {
    if (polling || closed) return;
    polling = true;
    void poll();
  }

  return {
    kind: options.kind,
    async invoke(command: string, args: Record<string, unknown> | undefined) {
      // The UI starts with the backend (no blocking of the first frame); a
      // command waits for the bootstrap instead of racing it, and a backend
      // that failed to start answers every command with that failure.
      await ready();
      let text: string;
      try {
        text = await backend.invoke(command, JSON.stringify(args ?? {}));
      } catch (reason) {
        throw new Error(errorMessageOf(reason));
      }
      return parseJson(text);
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      startPolling();
      return () => {
        subscribers.delete(onEvents);
      };
    },
    ready,
    state: () => state(),
    error: () => error(),
    lastSeq: () => lastSeq,
    fleet: () => fleetAnswer(),
    retry() {
      if (closed) return;
      if (wakeBackoff) {
        wakeBackoff();
        return;
      }
      if (!polling && subscribers.size > 0 && state() !== "connected") {
        error.set("");
        state.set("reconnecting");
        startPolling();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      wakeBackoff?.();
    },
  };
}

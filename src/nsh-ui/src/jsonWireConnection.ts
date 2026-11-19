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
}

function parseJson(text: string): unknown {
  return text === "" ? null : JSON.parse(text);
}

function readInfo(text: string): BackendInfo {
  const value = (parseJson(text) ?? {}) as Record<string, unknown>;
  const read = (key: string) => (typeof value[key] === "string" && value[key] ? (value[key] as string) : null);
  return { version: read("version"), platform: read("platform"), dataDir: read("dataDir") };
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
    out.push(event);
  }
  return out;
}

export function createJsonWireConnection(
  backend: JsonWireBackend,
  options: JsonWireConnectionOptions,
): BackendConnection {
  const state = signal<ConnectionState>("connecting");
  const error = signal("");
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  const maxBackoffMs = options.maxBackoffMs ?? 5000;
  let lastSeq: number | null = null;
  let polling = false;
  let readyPromise: Promise<BackendInfo> | null = null;

  function ready(): Promise<BackendInfo> {
    if (!readyPromise) {
      readyPromise = backend.ready().then(
        text => {
          if (state() === "connecting") state.set("connected");
          return readInfo(text);
        },
        reason => {
          const message = errorMessageOf(reason);
          error.set(message);
          state.set("failed");
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
    const fresh = batch.filter(item => item.seq === undefined || lastSeq === null || item.seq > lastSeq);
    if (fresh.length === 0) return;
    for (const item of fresh) if (item.seq !== undefined) lastSeq = item.seq;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(fresh);
      } catch (reason) {
        console.error("An event subscriber failed", reason);
      }
    }
  }

  async function poll(): Promise<void> {
    let backoffMs = 250;
    for (;;) {
      let text: string;
      try {
        // Resume after what this UI has seen, so a reconnect replays the gap.
        text = await (lastSeq === null ? backend.nextEvents() : backend.nextEvents(lastSeq));
      } catch (reason) {
        const message = errorMessageOf(reason);
        if (state() !== "failed") state.set("reconnecting");
        error.set(message);
        console.warn(`Backend event stream interrupted: ${message}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
        continue;
      }
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
        if (state() !== "failed") {
          state.set("failed");
          error.set("The backend stopped");
        }
        return;
      }
      deliver(batch);
    }
  }

  function startPolling(): void {
    if (polling) return;
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
  };
}

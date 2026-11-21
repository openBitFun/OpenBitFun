// A backend connection over the backend protocol (OBP) on a WebSocket: the
// page served by an OpenBitFun backend (loopback or LAN) connects back to it.
//
// JSON-RPC 2.0 on one socket: `hello` (protocol version, resume cursor),
// `call` → the command's value, `ack` → event credit, and `event`
// notifications `{seq, event, payload}`. A dropped socket reconnects with
// backoff and resumes after the last `seq`; a gap the backend cannot replay
// arrives as `backend://events-dropped`, which the UI answers by re-hydrating
// through ordinary commands (`backendResync.ts`). Nothing here knows which
// machine the backend runs on.

import { signal } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type BackendInfo,
  type ConnectionState,
} from "./backendConnection";
import {
  advanceFleetCursor,
  FLEET_PROTOCOL_VERSION,
  fleetCursorHasSeen,
  readFleetHelloAnswer,
  type FleetCursor,
  type FleetHelloAnswer,
} from "./fleetTypes";

export const EVENTS_DROPPED_EVENT = "backend://events-dropped";
export const OBP_PROTOCOL_VERSION = 1;

/** The part of the WebSocket API this connection uses (browsers, NSH, test fakes). */
export interface ObpSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

export type ObpSocketFactory = (url: string) => ObpSocket;

export interface WebSocketConnectionOptions {
  /** `ws://…/obp` or `wss://…/obp`. */
  url: string;
  /** Makes the socket; defaults to the global `WebSocket`. */
  createSocket?: ObpSocketFactory;
  /**
   * Asks the server whether this page holds a session, to explain a refused
   * upgrade (browsers hide the HTTP answer of a failed upgrade).
   */
  probeSession?: () => Promise<{ authorized: boolean } | null>;
  /** Client name sent in `hello`. */
  client?: string;
  /** Event window in bytes the client asks for (1 MiB). */
  creditBytes?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** How long a command waits for a connection before failing (30 s). */
  connectWaitMs?: number;
  /**
   * Asks to be a fleet client: the hello carries `fleet {protocol, cursor}` and
   * frames tagged with an origin are de-duplicated per origin against this
   * vector cursor (shared, so a client moving to another entry resumes from
   * it). `false` sends a plain hello. An older backend ignores the member and
   * answers without `fleet`.
   */
  fleet?: { cursor: FleetCursor } | false;
}

/** What the backend answered to `hello`. */
export interface ObpHello {
  scope: string;
  capabilities: string[];
  registryDigest: string;
  lastSeq: number;
  creditBytes: number | null;
  backend: { version?: string; platform?: string; instanceId?: string; dataDir?: string };
  /** The fleet answer; `null` from a backend that is not a fleet entry. */
  fleet: FleetHelloAnswer | null;
}

export interface WebSocketConnection extends BackendConnection {
  /** The scope the backend granted (`owner`, `paired-client`); `null` before the first hello. */
  scope(): string | null;
  /** The last `hello` answer. */
  hello(): ObpHello | null;
  /** Closes the socket and stops reconnecting. */
  close(): void;
}

interface PendingCall {
  command: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const OPEN = 1;

function defaultSocketFactory(url: string): ObpSocket {
  const Constructor = (globalThis as { WebSocket?: new (url: string) => ObpSocket }).WebSocket;
  if (typeof Constructor !== "function") throw new Error("This platform has no WebSocket");
  return new Constructor(url);
}

function textOf(data: unknown): string | null {
  if (typeof data === "string") return data;
  return null;
}

export function createWebSocketConnection(options: WebSocketConnectionOptions): WebSocketConnection {
  const createSocket = options.createSocket ?? defaultSocketFactory;
  const minBackoffMs = options.minBackoffMs ?? 250;
  const maxBackoffMs = options.maxBackoffMs ?? 10_000;
  const connectWaitMs = options.connectWaitMs ?? 30_000;
  const creditBytes = options.creditBytes ?? 1024 * 1024;

  const state = signal<ConnectionState>("connecting");
  const error = signal("");
  const scope = signal<string | null>(null);
  const helloAnswer = signal<ObpHello | null>(null);
  const fleetCursor: FleetCursor | null = options.fleet === false ? null : (options.fleet?.cursor ?? {});
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();

  let socket: ObpSocket | null = null;
  let open = false;
  let closedByUser = false;
  let nextId = 1;
  let lastSeq: number | null = null;
  let instanceId: string | null = null;
  let backoffMs = minBackoffMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  let bytesSinceAck = 0;
  let fatal: string | null = null;
  const pending = new Map<number, PendingCall>();
  let waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];

  let resolveReady: ((info: BackendInfo) => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<BackendInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => undefined);

  function deliver(events: BackendEvent[]): void {
    if (events.length === 0) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(events);
      } catch (reason) {
        console.error("An event subscriber failed", reason);
      }
    }
  }

  function sendFrame(frame: Record<string, unknown>): boolean {
    if (!socket || !open || socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify({ jsonrpc: "2.0", ...frame }));
      return true;
    } catch (reason) {
      console.warn(`Backend socket send failed: ${errorMessageOf(reason)}`);
      return false;
    }
  }

  function sendAck(): void {
    if (ackTimer !== null) clearTimeout(ackTimer);
    ackTimer = null;
    bytesSinceAck = 0;
    if (lastSeq === null) return;
    const params: Record<string, unknown> = { seq: lastSeq };
    // A fleet stream numbers frames per origin; the vector says what was rendered.
    if (fleetCursor && helloAnswer()?.fleet) params.cursor = fleetCursor;
    sendFrame({ method: "ack", params });
  }

  function noteReceived(bytes: number): void {
    bytesSinceAck += bytes;
    // Return credit early when a quarter of the window is used, else soon.
    if (bytesSinceAck >= creditBytes / 4) {
      sendAck();
    } else if (ackTimer === null) {
      ackTimer = setTimeout(sendAck, 30);
    }
  }

  function settleWaiters(failure: Error | null): void {
    const list = waiters;
    waiters = [];
    for (const waiter of list) {
      if (failure) waiter.reject(failure);
      else waiter.resolve();
    }
  }

  function failPending(message: string): void {
    for (const [id, call] of pending) {
      pending.delete(id);
      call.reject(new Error(`${message} before \`${call.command}\` answered`));
    }
  }

  function handleEvent(params: Record<string, unknown>, bytes: number): void {
    if (typeof params.event !== "string") return;
    const seq = typeof params.seq === "number" ? params.seq : undefined;
    const item: BackendEvent = { event: params.event, payload: params.payload ?? null };
    if (seq !== undefined) item.seq = seq;
    const origin = typeof params.origin === "string" && params.origin ? params.origin : null;
    if (origin && fleetCursor) {
      // A fleet frame: `seq` is the origin's own, ordered within that origin only.
      const instance = typeof params.originInstance === "string" ? params.originInstance : "";
      item.origin = origin;
      if (instance) item.originInstance = instance;
      if (params.event === EVENTS_DROPPED_EVENT) {
        // The origin skipped ahead: its cursor restarts at the notice's own seq
        // (`resumeSeq - 1`), and the UI re-hydrates that origin.
        const resume = (params.payload as { resumeSeq?: unknown } | null)?.resumeSeq;
        const at = seq ?? (typeof resume === "number" ? resume - 1 : undefined);
        if (at !== undefined) fleetCursor[origin] = { instanceId: instance, seq: at };
      } else if (seq !== undefined) {
        if (fleetCursorHasSeen(fleetCursor, origin, instance, seq)) return;
        advanceFleetCursor(fleetCursor, origin, instance, seq);
      }
      if (seq !== undefined) lastSeq = seq;
      noteReceived(bytes);
      deliver([item]);
      return;
    }
    if (params.event === EVENTS_DROPPED_EVENT) {
      // The backend restarted or skipped ahead: its cursor replaces ours.
      if (seq !== undefined) lastSeq = seq;
      noteReceived(bytes);
      deliver([item]);
      return;
    }
    if (seq !== undefined) {
      if (lastSeq !== null && seq <= lastSeq) return;
      lastSeq = seq;
    }
    noteReceived(bytes);
    deliver([item]);
  }

  function handleHello(result: Record<string, unknown>): void {
    const backend = (result.backend ?? {}) as ObpHello["backend"];
    const answer: ObpHello = {
      scope: typeof result.scope === "string" ? result.scope : "",
      capabilities: Array.isArray(result.capabilities) ? (result.capabilities as string[]) : [],
      registryDigest: typeof result.registryDigest === "string" ? result.registryDigest : "",
      lastSeq: typeof result.lastSeq === "number" ? result.lastSeq : 0,
      creditBytes: typeof result.creditBytes === "number" ? result.creditBytes : null,
      backend,
      fleet: fleetCursor ? readFleetHelloAnswer(result.fleet) : null,
    };
    if (typeof backend.instanceId === "string") instanceId = backend.instanceId;
    // Without a cursor, the stream starts at the backend's newest event.
    if (lastSeq === null) lastSeq = answer.lastSeq;
    helloAnswer.set(answer);
    scope.set(answer.scope || null);
    backoffMs = minBackoffMs;
    error.set("");
    state.set("connected");
    resolveReady?.({
      version: typeof backend.version === "string" && backend.version ? backend.version : null,
      platform: typeof backend.platform === "string" && backend.platform ? backend.platform : null,
      dataDir: typeof backend.dataDir === "string" && backend.dataDir ? backend.dataDir : null,
      ...(answer.fleet ? { fleet: answer.fleet } : {}),
    });
    settleWaiters(null);
  }

  function handleMessage(text: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error("Unreadable backend frame");
      return;
    }
    if (frame.method === "event" && frame.params && typeof frame.params === "object") {
      handleEvent(frame.params as Record<string, unknown>, text.length);
      return;
    }
    if (frame.id === 0) {
      const failure = frame.error as { code?: number; message?: string } | undefined;
      if (failure) {
        const message = failure.message || "The backend refused the handshake";
        if (failure.code === -32005) {
          // No shared protocol version: reconnecting cannot fix it.
          fatal = message;
          error.set(message);
          state.set("failed");
          rejectReady?.(new Error(message));
          settleWaiters(new Error(message));
          socket?.close(1000, "protocol mismatch");
          return;
        }
        error.set(message);
        socket?.close(1000, "hello refused");
        return;
      }
      handleHello((frame.result ?? {}) as Record<string, unknown>);
      return;
    }
    if (typeof frame.id !== "number") {
      if (frame.error) console.warn(`Backend protocol error: ${errorMessageOf(frame.error)}`);
      return;
    }
    const call = pending.get(frame.id);
    if (!call) return;
    pending.delete(frame.id);
    if (frame.error) {
      const failure = frame.error as { message?: unknown };
      call.reject(new Error(typeof failure.message === "string" && failure.message ? failure.message : `${call.command} failed`));
    } else {
      call.resolve(frame.result ?? null);
    }
  }

  async function explainRefusal(): Promise<void> {
    if (!options.probeSession) return;
    try {
      const session = await options.probeSession();
      if (session && session.authorized === false && !open) {
        error.set("This page has no session with the backend. Open it again from OpenBitFun (Devices) or pair this device.");
        state.set("failed");
      }
    } catch {
      // The probe is advisory; the reconnect loop continues either way.
    }
  }

  function scheduleReconnect(): void {
    if (closedByUser || fatal !== null || reconnectTimer !== null) return;
    const delay = backoffMs;
    backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (closedByUser || fatal !== null) return;
    let next: ObpSocket;
    try {
      next = createSocket(options.url);
    } catch (reason) {
      error.set(errorMessageOf(reason));
      if (state() !== "failed") state.set("reconnecting");
      scheduleReconnect();
      return;
    }
    socket = next;
    let helloSent = false;
    next.onopen = () => {
      if (socket !== next) return;
      open = true;
      helloSent = true;
      const params: Record<string, unknown> = {
        protocol: OBP_PROTOCOL_VERSION,
        client: options.client ?? "openbitfun-nsh-web",
        ack: true,
        creditBytes,
      };
      if (lastSeq !== null) params.lastSeq = lastSeq;
      if (instanceId !== null) params.instanceId = instanceId;
      if (fleetCursor) params.fleet = { protocol: FLEET_PROTOCOL_VERSION, cursor: fleetCursor };
      sendFrame({ id: 0, method: "hello", params });
    };
    next.onmessage = event => {
      if (socket !== next) return;
      const text = textOf(event.data);
      if (text !== null) handleMessage(text);
    };
    next.onerror = () => undefined;
    next.onclose = event => {
      if (socket !== next) return;
      socket = null;
      const wasOpen = open;
      open = false;
      if (ackTimer !== null) clearTimeout(ackTimer);
      ackTimer = null;
      failPending("The connection to the backend closed");
      if (closedByUser || fatal !== null) return;
      const reason = event?.reason ? `${event.reason} (${event.code ?? "-"})` : `closed (${event?.code ?? "-"})`;
      if (event?.code === 4003) {
        error.set("This device's pairing was revoked on the desktop. Pair it again to reconnect.");
        state.set("failed");
        return;
      }
      if (!error() || wasOpen) error.set(`The backend connection ${reason}`);
      if (state() !== "failed") state.set("reconnecting");
      if (!helloSent) void explainRefusal();
      console.warn(`Backend socket closed: ${reason}`);
      scheduleReconnect();
    };
  }

  function whenConnected(): Promise<void> {
    if (fatal !== null) return Promise.reject(new Error(fatal));
    if (open && helloAnswer() !== null && state() === "connected") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (reason: Error) => {
          clearTimeout(timer);
          reject(reason);
        },
      };
      const timer = setTimeout(() => {
        waiters = waiters.filter(item => item !== waiter);
        reject(new Error(`The backend is not connected${error() ? `: ${error()}` : ""}`));
      }, connectWaitMs);
      waiters.push(waiter);
    });
  }

  connect();

  return {
    kind: "websocket",
    async invoke(command: string, args: Record<string, unknown> | undefined) {
      await whenConnected();
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { command, resolve, reject });
        if (!sendFrame({ id, method: "call", params: { command, args: args ?? {} } })) {
          pending.delete(id);
          reject(new Error(`The backend is not connected; \`${command}\` was not sent`));
        }
      });
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
    lastSeq: () => lastSeq,
    scope: () => scope(),
    hello: () => helloAnswer(),
    fleet: () => helloAnswer()?.fleet ?? null,
    close() {
      closedByUser = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close(1000, "client closed");
      socket = null;
      open = false;
      failPending("The connection was closed");
      settleWaiters(new Error("The connection was closed"));
    },
  };
}

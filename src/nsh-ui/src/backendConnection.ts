// The one interface between this UI and a backend.
//
// The UI only renders; everything it knows comes through a `BackendConnection`:
// commands go out as `invoke(command, args)` and the backend's events come back
// as seq-numbered batches. The same interface serves every client of the same
// backend protocol — the in-process native host today, a WebSocket (loopback,
// LAN, relay) tomorrow — so nothing here may assume where the backend runs or
// which shell draws the window. Window, menu and tray work is the shell's
// (`windowShell.ts`), never the connection's.

import type { FleetHelloAnswer } from "./fleetTypes";

/** Which wire a connection uses. `dev` answers from fixtures and proves nothing. */
export type TransportKind = "tauri" | "dev" | "native" | "websocket" | "mesh";

/** Where a connection stands. A failed connection keeps its last error. */
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

/**
 * One backend event as the protocol carries it. `seq` strictly increases per
 * backend process, so a reconnecting client resumes after the last one it saw;
 * a legacy host that numbers nothing leaves it out.
 */
export interface BackendEvent {
  seq?: number;
  event: string;
  payload: unknown;
  /**
   * On a fleet stream: the device the event comes from (`seq` is then that
   * origin's own) and its backend instance. Absent on a plain stream and for
   * the entry's own events on the native in-process stream.
   */
  origin?: string;
  originInstance?: string;
}

/** What the backend says about itself once it finished starting. */
export interface BackendInfo {
  version: string | null;
  platform: string | null;
  dataDir: string | null;
  /**
   * The `fleet` answer of the hello (or the native ready info): the backend is
   * a fleet entry. Absent on an older backend, which keeps the UI single-device.
   */
  fleet?: FleetHelloAnswer | null;
}

export interface InvokeOptions {
  /**
   * The command takes positional arguments rather than one `request` struct.
   * A wire that sends the Tauri args object as it is ignores this; the legacy
   * page host needs it to keep its two envelope shapes.
   */
  positional?: boolean;
}

export interface BackendConnection {
  readonly kind: TransportKind;
  /**
   * Runs one command. `args` is exactly the args object Tauri's
   * `core.invoke(command, args)` received (`{ request }` or the positional
   * arguments); `undefined` means no arguments. Resolves with the command's
   * value; rejects with an `Error` whose message is the backend's own.
   */
  invoke(command: string, args: Record<string, unknown> | undefined, options?: InvokeOptions): Promise<unknown>;
  /** Hands every event batch, in emission order, to `onEvents`; returns the unsubscriber. */
  subscribe(onEvents: (events: readonly BackendEvent[]) => void): () => void;
  /** Resolves once the backend is ready to answer; rejects with its fatal start error. */
  ready(): Promise<BackendInfo>;
  /** The connection's state now (a signal read, so a binding follows it). */
  state(): ConnectionState;
  /** Why the connection failed or is reconnecting; `""` otherwise. */
  error(): string;
  /** The last event `seq` delivered, for a reconnect to resume after; `null` before any. */
  lastSeq(): number | null;
  /**
   * Interest hints: the events the UI listens to now. A wire that streams every
   * event ignores them; one that must subscribe per event (the legacy page host)
   * uses them.
   */
  watch?(event: string): void;
  unwatch?(event: string): void;
  /**
   * True when the wire already merges `agentic://text-chunk` per frame (the
   * legacy page host does), so the bridge does not merge them twice.
   */
  readonly coalescesTextChunks?: boolean;
  /**
   * The fleet answer of the current handshake (a signal read), or `null` when
   * this backend is not a fleet entry. A connection that cannot tell leaves it
   * out and reports it through `ready()`'s `fleet` instead.
   */
  fleet?(): FleetHelloAnswer | null;
}

/** The message a rejected `invoke` carries, whatever the wire rejected with. */
export function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

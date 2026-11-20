// Peer Device Mode over OBP on the account mesh: the selected device's backend
// as a `BackendConnection`.
//
// This UI cannot open the mesh connection itself (the device handshake needs
// this device's key, which stays in the backend), so the local backend holds
// the authenticated OBP link and this connection drives it with four
// controller-local commands: `peer_link_call` runs a command on the peer with
// the exact Tauri args, `peer_link_events` long-polls the peer's own
// `{seq, event, payload}` stream (the peer's `seq`, resumed after the last one
// applied), `peer_link_connect` / `peer_link_disconnect` open and close it.
// Nothing is wrapped or re-projected on the way, and token chunks arrive as
// the peer emits them.
//
// It never touches the old relay transport (`account_device_rpc`, relay
// `rpc-call`, `machine-event`, `HostStream`); `test/peer-mesh.test.tsx` fails
// if it does.

import { signal } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type BackendInfo,
  type ConnectionState,
} from "./backendConnection";

/** What `peer_link_connect` answers. */
export interface PeerLinkInfo {
  deviceId: string;
  transport: "mesh";
  state: "connected" | "reconnecting" | "closed";
  scope?: string;
  capabilities: string[];
  /** The registry peer-host capabilities the peer serves (newer peers). */
  hostCapabilities?: string[];
  protocol?: number;
  backend?: { version?: string; platform?: string; instanceId?: string };
  registryDigest?: string;
  /** `p2p` or `relayed`. */
  meshPath?: string;
  latencyMs?: number;
}

interface PeerEventsBatch {
  instanceId?: string | null;
  state?: "connected" | "reconnecting" | "closed";
  error?: string | null;
  events?: unknown[];
}

export const PEER_LINK_CONNECT = "peer_link_connect";
export const PEER_LINK_CALL = "peer_link_call";
export const PEER_LINK_EVENTS = "peer_link_events";
export const PEER_LINK_DISCONNECT = "peer_link_disconnect";

export interface MeshPeerConnectionOptions {
  /** Longest pause between two failed polls, in ms (5000). */
  maxBackoffMs?: number;
  /** Long-poll wait the backend may hold a poll, in ms (25000). */
  waitMs?: number;
}

export interface MeshPeerConnection extends BackendConnection {
  readonly deviceId: string;
  /** Stops polling. The link itself is closed by `peer_link_disconnect`. */
  close(): void;
}

function readEvents(raw: unknown[]): BackendEvent[] {
  const out: BackendEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.event !== "string") continue;
    const event: BackendEvent = { event: record.event, payload: record.payload ?? null };
    if (typeof record.seq === "number") event.seq = record.seq;
    out.push(event);
  }
  return out;
}

/**
 * The peer `deviceId`'s backend, reached through `local` (this machine's
 * backend). `info` is what `peer_link_connect` answered.
 */
export function createMeshPeerConnection(
  local: BackendConnection,
  deviceId: string,
  info: PeerLinkInfo,
  options: MeshPeerConnectionOptions = {},
): MeshPeerConnection {
  const state = signal<ConnectionState>(info.state === "reconnecting" ? "reconnecting" : "connected");
  const error = signal("");
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  const maxBackoffMs = options.maxBackoffMs ?? 5000;
  const waitMs = options.waitMs ?? 25000;
  let lastSeq: number | null = null;
  let instanceId: string | null = info.backend?.instanceId ?? null;
  let polling = false;
  let closed = false;
  const backendInfo: BackendInfo = {
    version: info.backend?.version ?? null,
    platform: info.backend?.platform ?? null,
    dataDir: null,
  };

  function deliver(batch: BackendEvent[]): void {
    const fresh = batch.filter(item => item.seq === undefined || lastSeq === null || item.seq > lastSeq);
    if (fresh.length === 0) return;
    for (const item of fresh) if (item.seq !== undefined) lastSeq = item.seq;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(fresh);
      } catch (reason) {
        console.error("A peer event subscriber failed", reason);
      }
    }
  }

  async function poll(): Promise<void> {
    let backoffMs = 250;
    while (!closed) {
      let batch: PeerEventsBatch;
      try {
        const request: Record<string, unknown> = { deviceId, waitMs };
        if (lastSeq !== null) request.afterSeq = lastSeq;
        if (instanceId !== null) request.instanceId = instanceId;
        batch = ((await local.invoke(PEER_LINK_EVENTS, { request })) ?? {}) as PeerEventsBatch;
      } catch (reason) {
        if (closed) return;
        const message = errorMessageOf(reason);
        error.set(message);
        if (message.startsWith("peer_link_closed")) {
          state.set("failed");
          console.warn(`Peer link closed: device=${deviceId}`);
          polling = false;
          return;
        }
        state.set("reconnecting");
        console.warn(`Peer event stream interrupted: device=${deviceId}, error=${message}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
        continue;
      }
      if (closed) return;
      backoffMs = 250;
      const events = readEvents(Array.isArray(batch.events) ? batch.events : []);
      const restarted = typeof batch.instanceId === "string" && batch.instanceId !== instanceId;
      if (restarted) {
        // The peer backend restarted: its `seq` began again, so the cursor
        // follows the new instance (the batch leads with events-dropped).
        instanceId = batch.instanceId as string;
        lastSeq = null;
      } else if (events.length > 0 && events[0]!.seq === undefined) {
        // A synthetic events-dropped: the cursor fell out of the link's ring.
        lastSeq = null;
      }
      if (batch.state === "closed") {
        state.set("failed");
        error.set(batch.error || `The link to ${deviceId} closed`);
        deliver(events);
        polling = false;
        return;
      }
      if (batch.state === "reconnecting") {
        state.set("reconnecting");
        error.set(batch.error || "");
      } else if (state() !== "connected") {
        state.set("connected");
        error.set("");
      }
      deliver(events);
    }
    polling = false;
  }

  function startPolling(): void {
    if (polling || closed) return;
    polling = true;
    void poll();
  }

  return {
    kind: "mesh",
    deviceId,
    async invoke(command, args) {
      if (closed) throw new Error(`peer_link_closed: the link to ${deviceId} is closed`);
      return local.invoke(PEER_LINK_CALL, { request: { deviceId, command, args: args ?? {} } });
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      startPolling();
      return () => {
        subscribers.delete(onEvents);
      };
    },
    ready: () => Promise.resolve(backendInfo),
    state: () => state(),
    error: () => error(),
    lastSeq: () => lastSeq,
    close() {
      closed = true;
      subscribers.clear();
    },
  };
}

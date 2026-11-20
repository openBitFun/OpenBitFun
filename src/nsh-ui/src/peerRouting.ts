// Peer Device Mode routing, kept in one module so it can be swapped out.
//
// Two transports, negotiated per device (`peerStore.ts`):
// - `mesh` (devices advertising `obp_v1` + `mesh_v1`): this UI's backend
//   connection is the peer's backend over OBP (`meshPeerConnection.ts`).
//   Registry-`Proxied` commands go to the peer and `ControllerLocal` ones stay
//   here; owner-only events (account, window, mesh, updater, shell) come from
//   this machine and every other event from the peer. Both sets are generated
//   from the Product Operation Registry (`generated/peerSurface.ts`).
// - `relay` (older devices): the legacy path wraps a product command in a
//   HostInvoke envelope sent through this machine's `account_device_rpc`, and
//   filters the peer's re-emitted events by their source tag. It stays until no
//   supported peer needs it. Keep it thin: only the envelope and the tag.

import {
  PEER_CONTROLLER_LOCAL_COMMANDS,
  PEER_OWNER_ONLY_EVENT_PREFIXES,
} from "./generated/peerSurface";
import type { PeerScope } from "./peerState";

/**
 * The old relay transport's data-plane commands. A mesh peer never needs them;
 * `test/peer-mesh.test.tsx` fails if a mesh session invokes one.
 */
export const LEGACY_RELAY_TRANSPORT_COMMANDS: ReadonlySet<string> = new Set([
  "account_device_rpc",
  "account_execute_on_device",
  "account_subscribe_session",
  "account_unsubscribe_session",
  "account_load_older_session",
]);

/** Whether a command stays on this machine while a peer is driven (registry `ControllerLocal`). */
export function staysOnController(command: string): boolean {
  return PEER_CONTROLLER_LOCAL_COMMANDS.has(command);
}

/** Whether an event belongs to the backend owner's machine (registry event stance). */
export function isOwnerOnlyEvent(event: string): boolean {
  return PEER_OWNER_ONLY_EVENT_PREFIXES.some(prefix => event.startsWith(prefix));
}

/** Payload key injected by the Rust controller on re-emitted Peer DeviceEvents. */
export const PEER_EVENT_SOURCE_KEY = "__openbitfunSourceDeviceId";
/** Wrapper key used when a peer payload is not a JSON object. */
export const PEER_EVENT_WRAPPED_PAYLOAD_KEY = "__openbitfunSourcePayload";

/** The command that carries a proxied command to a peer (positional Tauri arguments). */
export const PEER_RPC_COMMAND = "account_device_rpc";

export interface PeerRoute {
  command: string;
  args: Record<string, unknown>;
}

/**
 * The route a command takes while `peer` is driven, or `null` when it stays on
 * this machine (no peer, or the Product Operation Registry keeps it controller
 * local). `positional` commands carry their arguments at `args`' top level; a
 * `request` command carries `{ request }`, as the peer host reads either.
 */
export function peerRouteFor(
  peer: PeerScope | null,
  command: string,
  args: Record<string, unknown> | undefined,
  positional: boolean,
): PeerRoute | null {
  if (!peer || peer.transport === "mesh" || PEER_CONTROLLER_LOCAL_COMMANDS.has(command)) return null;
  const forwarded = positional ? (args ?? null) : { request: args?.request ?? null };
  return {
    command: PEER_RPC_COMMAND,
    args: {
      targetDeviceId: peer.deviceId,
      commandJson: JSON.stringify({ cmd: "host_invoke", command, args: forwarded }),
      timeoutMs: null,
    },
  };
}

/**
 * Reads one `host_invoke_result` envelope a peer host returned. The transport
 * failure and the host's own refusal stay distinct messages.
 */
export function decodePeerReply<T>(action: string, raw: unknown): T {
  let envelope: { resp?: string; ok?: boolean; value?: unknown; error?: string; message?: string };
  try {
    envelope =
      typeof raw === "string"
        ? (JSON.parse(raw) as typeof envelope)
        : ((raw ?? {}) as typeof envelope);
  } catch {
    throw new Error(`The peer sent an unreadable reply to ${action}`);
  }
  if (envelope.resp === "error") {
    throw new Error(envelope.message || `The peer refused ${action}`);
  }
  if (envelope.resp !== "host_invoke_result") {
    throw new Error(`The peer answered ${action} with ${envelope.resp ?? "no envelope"}`);
  }
  if (envelope.ok !== true) {
    throw new Error(envelope.error || `The peer refused ${action}`);
  }
  return envelope.value as T;
}

const SURFACE_SCOPED_EVENTS = new Set<string>([
  "terminal_event",
  "terminal-output",
  "terminal-exit",
  "terminal-closed",
  "relay://session-gap",
  "relay://session-ready",
  "session-record",
  "session-state",
  "file-system-changed",
  "file-watch-status-changed",
  "git://status-changed",
  "permission://event",
  "account://settings-applied",
  "ai://model-catalog-updated",
  "session_title_generated",
  "workspace-catalog-changed",
  "host-catalog-changed",
  "cron://jobs-changed",
]);

function isSurfaceScopedEvent(event: string): boolean {
  return (
    SURFACE_SCOPED_EVENTS.has(event) ||
    event.startsWith("agentic://") ||
    event.startsWith("backend-event-")
  );
}

function readSourceDeviceId(payload: unknown, fallback?: string): string | null {
  if (payload && typeof payload === "object") {
    const tagged = (payload as Record<string, unknown>)[PEER_EVENT_SOURCE_KEY];
    if (typeof tagged === "string" && tagged.length > 0) return tagged;
  }
  return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
}

function unwrapSurfacePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if (!(PEER_EVENT_SOURCE_KEY in record)) return payload;
  if (PEER_EVENT_WRAPPED_PAYLOAD_KEY in record) {
    return record[PEER_EVENT_WRAPPED_PAYLOAD_KEY];
  }
  const { [PEER_EVENT_SOURCE_KEY]: _source, ...rest } = record;
  return rest;
}

/** Marks an event the surface must not see. */
export const DROP_EVENT: unique symbol = Symbol("drop-event");

/**
 * Keeps local and peer streams apart. The real Rust controller tags every
 * re-emitted peer event with `__openbitfunSourceDeviceId` and leaves local host
 * events untagged, so a real backend (`strict`) is matched exactly; the
 * development fixtures have no tagger, so only a present tag is enforced there.
 * Returns the payload the listeners get, or `DROP_EVENT`.
 */
export function scopeEventToSurface(
  event: string,
  payload: unknown,
  peerDeviceId: string | undefined,
  activePeerId: string | null,
  strict: boolean,
): unknown {
  if (!isSurfaceScopedEvent(event)) return payload;
  const sourceDeviceId = readSourceDeviceId(payload, peerDeviceId);
  if (strict) {
    if (sourceDeviceId !== activePeerId) return DROP_EVENT;
  } else if (sourceDeviceId !== null && sourceDeviceId !== activePeerId) {
    return DROP_EVENT;
  }
  return unwrapSurfacePayload(payload);
}
